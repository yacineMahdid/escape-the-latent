// A paper region: diorama + inhabitants + stations + the challenge chain from content/regions/<id>.json.
import * as THREE from 'three';
import { buildDiorama, ANCHORS, DOOR_POS } from '../../engine/diorama.js';
import { buildVillager } from '../../engine/villagers.js';
import { sampleHeight } from '../../engine/walk.js';
import { createPlayer } from '../player.js';
import { createWalkScene, dioramaCamera } from '../walkscene.js';
import { buildStation } from '../stations.js';
import { buildLandmark } from '../../engine/landmarks.js';
import { buildArtefact, theName } from '../artefacts.js';
import { getSave, updateSave, regionState, isLearned, learn, deliveredArtefacts } from '../save.js';
import { say, ask, askValue, banner, toast, itemGet } from '../dialogue.js';
import { confetti } from '../fx.js';
import { sfx } from '../sfx.js';
import { setHud, pulseHud } from '../hud.js';
import { openModal, closeModal, topModal } from '../../ui/modal.js';
import { api } from '../../api.js';

const STATION_ICONS = { terminal: '⌨️', board: '📌', mailbox: '✉️', sign: '🪧', machine: '⚙️' };

// What a typed number may mean: '0.96', '0,96' (decimal comma), '1,000' (thousands), '48/50', '96%' (0.96 or
// 96), '4 shots' (the first number, units ignored), '1 million', 'four', 'twenty-four', 'a million'.
const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, half: 0.5,
  hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 };
const SCALE_WORDS = { hundred: 100, thousand: 1e3, k: 1e3, million: 1e6, billion: 1e9 };
export function numberCandidates(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[−–]/g, '-');
  const num = (t) => {
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
    if (/^-?\d*,\d+$/.test(t)) return Number(t.replace(',', '.'));
    return t === '' ? NaN : Number(t);
  };
  const parse = (t) => {
    const pct = t.endsWith('%'); if (pct) t = t.slice(0, -1);
    const frac = t.match(/^(-?[\d.,]+)\/([\d.,]+)$/);
    const n = frac ? num(frac[1]) / num(frac[2]) : num(t);
    return !Number.isFinite(n) ? [] : pct ? [n / 100, n] : [n];
  };
  const whole = parse(text.replace(/\s+/g, ''));
  if (whole.length) return whole;
  // the first number in the text, with a scale word right after it ('1 million', '2k')
  const m = text.match(/-?\d[\d.,]*(?:\/\d[\d.,]*)?%?/);
  if (m) {
    const after = text.slice(m.index + m[0].length).match(/^\s*([a-z]+)/);
    const k = after ? SCALE_WORDS[after[1]] ?? 1 : 1;
    return parse(m[0].replace(/[.,]$/, '')).map((n) => n * k);
  }
  // number words
  let total = 0, cur = 0, any = false;
  for (const w of text.split(/[^a-z]+/).filter(Boolean)) {
    if ((w === 'a' || w === 'an') && !any) { cur = 1; continue; }
    const v = NUMBER_WORDS[w];
    if (v === undefined) continue;
    any = true;
    if (v === 100) cur = (cur || 1) * 100;
    else if (v >= 1e3) { total += (cur || 1) * v; cur = 0; }
    else cur += v;
  }
  return any ? [total + cur] : [];
}
const closeTo = (raw, answer, tolerance) => {
  const tol = tolerance ?? Math.max(1e-9, Math.abs(answer) * 1e-3);
  return numberCandidates(raw).some((n) => Math.abs(n - answer) <= tol);
};
const hashSeed = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) || 11;

export async function createRegionScene(ctx, regionId) {
  // a shallow copy: api.region() caches the parsed file, and the extra pack below must not pile up on it per visit
  const region = { ...(await api.region(regionId)) };
  // optional extra content pack (more challenges, villagers, stations): content/extra/<regionId>.json
  // (dev: localStorage 'etl-extra-draft' = '1' loads content/extra-draft/ instead, for unfinished packs)
  let draft = false; try { draft = localStorage.getItem('etl-extra-draft') === '1'; } catch { /* storage blocked */ }
  const extra = await fetch(`/content/${draft ? 'extra-draft' : 'extra'}/${regionId}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (extra) for (const key of ['challenges', 'inhabitants', 'stations']) if (Array.isArray(extra[key])) region[key] = [...(region[key] || []), ...extra[key]];
  const save = getSave();
  const world = buildDiorama(region.region.biome, { seed: hashSeed(regionId) });
  const player = await createPlayer(save.character);
  const st = regionState(regionId);
  // you step out of the little door at the far left
  player.place(DOOR_POS.x + 0.3, 0, DOOR_POS.z + 1.6);

  const ws = createWalkScene({
    engine: ctx.engine, world, player, light: world.biome.light, fog: world.biome.fog, camera: dioramaCamera,
    actions: {
      book: () => ctx.openBook({ arxivId: region.paper.arxivId, title: region.paper.title }, regionId),
      map: () => leave(),
      menu: () => ctx.pauseMenu(),
      tick: (dt, t) => { for (const fn of envUpdaters) fn(dt, t); },
    },
  });
  const envUpdaters = new Set(); // per-frame hooks of running environmental puzzles
  let disposed = false;

  // ---------- who stands where ----------
  const people = new Map(); // id -> { data, mesh, talking }
  const usedAnchors = new Set(['arrival']);
  const anchorPos = (name) => {
    const a = ANCHORS[name];
    if (a && !usedAnchors.has(name)) { usedAnchors.add(name); return a; }
    const free = Object.keys(ANCHORS).find((k) => !usedAnchors.has(k));
    usedAnchors.add(free);
    return ANCHORS[free];
  };
  const faceCamera = (mesh, x) => { mesh.rotation.y = Math.max(-0.5, Math.min(0.5, -x * 0.01)) + 0.15; };

  for (const inh of region.inhabitants || []) {
    const a = anchorPos(inh.anchor);
    const mesh = buildVillager(inh);
    mesh.position.set(a[0], a[1], a[2]);
    faceCamera(mesh, a[0]);
    ws.scene.add(mesh);
    const rec = { data: inh, mesh, talking: false, baseRot: mesh.rotation.y };
    people.set(inh.id, rec);
    mesh.userData.update = (dt) => {
      mesh.userData.animate?.(dt, { talking: rec.talking });
      const target = rec.talking ? Math.atan2(player.pos.x - mesh.position.x, player.pos.z - mesh.position.z) * 0.6 : rec.baseRot;
      mesh.rotation.y += (target - mesh.rotation.y) * Math.min(1, dt * 6);
    };
    ws.extras.push(mesh);
    world.colliders.push({ type: 'circle', x: a[0], z: a[2], r: 0.55 });
    ws.addInteractable({ label: inh.name, icon: '💬', pos: { x: a[0], y: a[1], z: a[2] }, onInteract: () => talkTo(inh.id) });
  }
  const stations = new Map();
  for (const s of region.stations || []) {
    const a = anchorPos(s.anchor);
    // the world's landmark machine has its own model (engine/landmarks.js); everything else is generic
    const mesh = buildLandmark(regionId, s.id) || buildStation(s.kind, {});
    mesh.position.set(a[0], a[1], a[2]);
    mesh.rotation.y = 0.1;
    ws.scene.add(mesh); ws.extras.push(mesh);
    stations.set(s.id, { data: s, mesh });
    world.colliders.push({ type: 'circle', x: a[0], z: a[2], r: mesh.userData.radius ?? 0.85 });
    ws.addInteractable({ label: s.label || 'Look', icon: STATION_ICONS[s.kind] || '⚙️', pos: { x: a[0], y: a[1], z: a[2] + 0.6 }, radius: 2.2, onInteract: () => talkTo(s.id) });
  }
  ws.addInteractable({ label: 'Little door', icon: '🚪', pos: { x: world.signpost.x, y: 0, z: world.signpost.z }, radius: 2.0, promptHeight: 3.8, onInteract: () => leave() });

  // ---------- the challenge chain ----------
  const challenges = region.challenges || [];
  const fundamentals = (region.fundamentals || []).map((f) => ({ ...f, type: 'fundamental' }));
  const byId = new Map([...fundamentals, ...challenges].map((c) => [c.id, c]));
  const solved = () => st.solved || {};
  // a fundamental is satisfied if passed here OR its concept is already on the book's Learned pages
  const satisfied = (id) => { const c = byId.get(id); if (!c) return true; return !!solved()[id] || (c.type === 'fundamental' && isLearned(c.concept)); };
  const isSolved = (c) => satisfied(c.id);
  const ready = (c) => !isSolved(c) && (c.requires || []).every(satisfied);
  const allSolved = () => challenges.every(isSolved);
  const chain = [...fundamentals, ...challenges];
  const nameOf = (id) => people.get(id)?.data.name || stations.get(id)?.data.label || id;
  const colorOf = (id) => people.get(id)?.data.colors?.shirt || '#ff7ab8';

  async function speak(id, lines) {
    const rec = people.get(id);
    if (rec) { rec.talking = true; try { await say(lines, { speaker: { name: rec.data.name, color: colorOf(id) } }); } finally { rec.talking = false; } }
    else await say(lines, { style: 'narration' });
  }

  async function talkTo(id) {
    updateSave(() => { regionState(regionId).talked[id] = true; });
    const rec = people.get(id);
    // concepts the book already knows: acknowledge once, never ask again
    for (const f of fundamentals.filter((x) => x.giver === id && !solved()[x.id] && isLearned(x.concept))) {
      updateSave(() => { regionState(regionId).solved[f.id] = true; });
      await speak(id, f.known || [`The Cursed Book already knows ${f.title}.`]);
    }
    const mine = chain.filter((c) => c.giver === id);
    const next = mine.find(ready);
    if (next && next.type === 'fundamental') {
      await speak(id, next.intro || ['…?']);
      const ok = await runFundamental(next, id);
      if (ok === true) await onFundamental(next, id);
      else if (ok === false) await speak(id, next.wrong || ['Hmm… no.']);
      return;
    }
    if (next && next.type === 'environment') {
      if (activeEnv.has(next.id)) { await speak(id, next.reminder || next.spec?.reminder || ['Still at it?']); return; }
      await speak(id, next.intro || ['…!']);
      await startEnvironment(next);
      return;
    }
    if (next) {
      await speak(id, next.intro || ['…!']);
      const ok = next.type === 'quiz' ? await runQuiz(next, id) : await runChallenge(next);
      if (ok) await onSolved(next);
      else if ((next.type === 'explain' || next.type === 'minigame' || next.type === 'quiz') && next.retry) {
        // after an explain bubble: nothing if it closed before any grade, and never the reply it just showed
        const lines = next.type === 'minigame' ? (minigamePlayed ? [].concat(next.retry) : [])
          : next.type !== 'explain' ? [].concat(next.retry)
            : explainFeedback ? [].concat(next.retry).filter((l) => !explainFeedback.includes(String(l).trim())) : [];
        if (lines.length) await speak(id, lines);
      }
      return;
    }
    const pending = mine.find((c) => !isSolved(c));
    // a challenge can say what its giver tells you while it is still locked (content: "locked": [lines])
    const lockedOne = mine.find((c) => !isSolved(c) && c.locked);
    if (lockedOne) { await speak(id, [].concat(lockedOne.locked)); return; }
    if (rec) {
      const lines = (!pending && mine.length) || allSolved() ? (rec.data.lines?.afterSolved || rec.data.lines?.default) : rec.data.lines?.default;
      await speak(id, lines || ['...']);
    } else {
      const label = nameOf(id);
      const kind = stations.get(id)?.data.kind;
      if (kind === 'sign') await say([`“${label}”`], { style: 'narration' });
      else if (stations.get(id)?.data.lines) await say(stations.get(id).data.lines, { style: 'narration' });
      else if (pending) { const who = blockerOf(pending); await say([who ? `Locked. ${who} first.` : 'Locked. Something else comes first.'], { style: 'narration' }); }
      else await say(['Nothing to do here now.'], { style: 'narration' });
    }
  }
  // who to see before challenge c opens: the giver of its first unmet requirement (searching down the chain)
  function blockerOf(c, seen = new Set()) {
    for (const rid of c.requires || []) {
      const r = byId.get(rid);
      if (!r || satisfied(rid) || seen.has(rid)) continue;
      seen.add(rid);
      if (ready(r)) return r.giver === c.giver ? null : nameOf(r.giver);
      const deeper = blockerOf(r, seen);
      if (deeper) return deeper;
    }
    return null;
  }

  let explainFeedback = '';   // the reply the last explain bubble showed ('' if it closed before any grade)
  async function runChallenge(c) {
    try {
      if (c.type === 'puzzle') return await runPuzzle(c);
      if (c.type === 'minigame') return await runMinigame(c);
      if (c.type === 'code') {
        const term = await import('../../ui/terminal.js');
        const res = await term.open({ challenge: c, regionId });
        return !!res?.solved;
      }
      if (c.type === 'explain') {
        explainFeedback = '';
        const ex = await import('../../ui/explain.js');
        const res = await ex.open({ challenge: c, regionId, speaker: { name: nameOf(c.giver), color: people.has(c.giver) ? colorOf(c.giver) : undefined } });
        explainFeedback = String(res?.feedback || '');
        return !!res?.pass;
      }
    } catch (e) {
      console.error('challenge failed to open', e);
      await say(['This challenge failed to open.'], { style: 'narration' });
    }
    return false;
  }

  // returns true (right), false (wrong) or null (player backed out)
  async function runFundamental(f, giverId) {
    const chk = f.check || {};
    const speaker = people.get(giverId) ? { speaker: { name: nameOf(giverId), color: colorOf(giverId) } } : { style: 'narration' };
    if (chk.kind === 'choice') {
      const opts = [...(chk.options || []), 'Not sure yet'];
      const i = await ask(chk.question, opts, { ...speaker, neutral: true });
      if (i === opts.length - 1) return null;
      return i === chk.answer;
    }
    if (chk.kind === 'number') {
      const v = await askValue(chk.question, { ...speaker, placeholder: 'a number' });
      if (v === null) return null;
      return closeTo(v, chk.answer, chk.tolerance);
    }
    if (chk.kind === 'explain') {
      try {
        const ex = await import('../../ui/explain.js');
        const res = await ex.open({ challenge: { id: f.id, type: 'explain', title: f.title, question: chk.question, rubric: chk.rubric, offline: chk.offline }, regionId, speaker: { name: nameOf(giverId), color: people.has(giverId) ? colorOf(giverId) : undefined } });
        return res?.pass ? true : (res ? false : null);
      } catch (e) { console.error(e); return null; }
    }
    return null;
  }

  async function onFundamental(f, giverId) {
    updateSave(() => { regionState(regionId).solved[f.id] = true; });
    learn(f.concept, { title: f.title, record: f.record || '', region: region.region.name });
    confetti(50);
    await speak(giverId, f.success || ['Yes! Exactly.']);
    toast(`📖 Learned: ${f.title}`, 2800); pulseHud('book');
  }

  // Mario Party-style mini-game: public/js/minigames/<c.minigame>.js, same overlay host as puzzles
  async function runMinigame(c) {
    let mod;
    try { mod = await import(`../../minigames/${c.minigame}.js`); }
    catch (e) { console.error(e); await say(['This mini-game is missing.'], { style: 'narration' }); return false; }
    const host = document.createElement('div');
    host.className = 'puzzle-host';
    document.getElementById('ui-root').appendChild(host);
    let handle = null;
    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      openModal(host, { onEscape: () => finish(false) });
      try { handle = (mod.default || mod).mount(host, { title: c.title, ...(c.spec || {}) }, { onWin: () => finish(true), onClose: () => finish(false), sfx }); }
      catch (e) { console.error(e); finish(false); }
    });
    minigamePlayed = host.__mg?.outcome != null; // a round reached FINISH (won or lost)
    try { handle?.destroy?.(); } catch (e) { console.error(e); }
    closeModal(host); host.remove();
    return result;
  }
  let minigamePlayed = false;

  // a villager's questions: every answer must be right (a wrong one ends the round; ask again later)
  async function runQuiz(c, giverId) {
    const speaker = people.get(giverId) ? { speaker: { name: nameOf(giverId), color: colorOf(giverId) } } : { style: 'narration' };
    for (const q of c.questions || []) {
      let ok;
      if (q.kind === 'number') {
        const v = await askValue(q.question, { ...speaker, placeholder: q.placeholder || 'a number' });
        if (v === null) return false;
        ok = closeTo(v, q.answer, q.tolerance);
      } else {
        const opts = [...(q.options || []), 'Not sure yet'];
        const i = await ask(q.question, opts, { ...speaker, neutral: true });
        if (i === opts.length - 1) return false;
        ok = i === q.answer;
      }
      if (!ok) { await speak(giverId, q.wrong || c.wrong || ['Hmm… not quite.']); return false; }
      if (q.right) await speak(giverId, q.right);
    }
    return true;
  }

  // Environmental puzzle: public/js/envpuzzles/<c.environment>.js lives in the 3D world until solved.
  const activeEnv = new Map(); // challenge id -> handle
  function envApi(c) {
    const speakerOf = (id) => (people.get(id) ? { name: nameOf(id), color: colorOf(id) } : null);
    return {
      THREE, scene: ws.scene, world, anchors: ANCHORS, regionId, biome: world.biome,
      player: { get pos() { return player.pos; }, place: (x, y, z) => player.place(x, y, z) },
      villager: (id) => people.get(id)?.mesh || null,
      station: (id) => stations.get(id)?.mesh || null,
      addInteractable: (it) => ws.addInteractable(it),
      removeInteractable: (it) => ws.removeInteractable(it),
      addCollider: (col) => { world.colliders.push(col); return col; },
      removeCollider: (col) => { const i = world.colliders.indexOf(col); if (i >= 0) world.colliders.splice(i, 1); },
      onUpdate: (fn) => { envUpdaters.add(fn); return () => envUpdaters.delete(fn); },
      speak: (id, lines) => speak(id, lines),
      say: (lines, opts) => say(lines, opts),
      ask: (q, opts, o = {}) => ask(q, opts, o),
      askValue: (q, o = {}) => askValue(q, o),
      speakerOf, toast, confetti, sfx,
      setTask: (text) => setHud({ task: text }),
    };
  }
  async function startEnvironment(c) {
    let mod;
    try { mod = await import(`../../envpuzzles/${c.environment}.js`); }
    catch (e) { console.error(e); await say(['This puzzle is missing.'], { style: 'narration' }); return; }
    let handle = null;
    const solve = () => {
      if (!activeEnv.has(c.id)) return;
      activeEnv.delete(c.id);
      const go = () => { if (ws.busy) { setTimeout(go, 150); return; } ws.run(async () => { try { handle?.destroy?.(); } catch (e) { console.error(e); } await onSolved(c); refreshTask(); }); };
      go();
    };
    try { handle = (mod.default || mod).mount(envApi(c), c.spec || {}, { onSolved: solve, onProgress: (text) => setHud({ task: text }) }); }
    catch (e) { console.error(e); await say(['This puzzle failed to start.'], { style: 'narration' }); return; }
    activeEnv.set(c.id, handle);
    setHud({ task: c.spec?.goal || c.title || '' });
  }
  function refreshTask() { setHud({ task: taskLine() }); }
  // the HUD task line: carry the artefact home; in a world already done, the errand Becancourt gave next
  function taskLine() {
    if (st.artefact && !st.returned) return `Bring ${theName(region.artefact?.name)} to Becancourt`;
    if (!st.returned) return region.scientist?.taskTitle || '';
    const cur = getSave().currentTask;
    if (cur && cur !== regionId) api.region(cur).then((r) => { if (!disposed) setHud({ task: r?.scientist?.taskTitle || '' }); }).catch(() => {});
    return '';
  }

  async function runPuzzle(c) {
    let mod;
    try { mod = await import(`../../puzzles/${c.puzzle}.js`); }
    catch (e) { console.error(e); await say(['This puzzle is missing.'], { style: 'narration' }); return false; }
    const host = document.createElement('div');
    host.className = 'puzzle-host';
    document.getElementById('ui-root').appendChild(host);
    window.addEventListener('keydown', onBookKey);
    let handle = null;
    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      openModal(host, { onEscape: () => finish(false) });
      try {
        handle = (mod.default || mod).mount(host, c.spec || {}, { onSolved: () => finish(true), onClose: () => finish(false), sfx, openBook });
      } catch (e) { console.error(e); finish(false); }
    });
    window.removeEventListener('keydown', onBookKey);
    try { handle?.destroy?.(); } catch (e) { console.error(e); }
    closeModal(host); host.remove();
    return result;
    // B opens the book over the board; the board stays as it was underneath
    function openBook() { if (!bookOpen) { bookOpen = true; Promise.resolve(ctx.openBook({ arxivId: region.paper.arxivId, title: region.paper.title }, regionId)).finally(() => { bookOpen = false; }); } }
    function onBookKey(e) { if (e.code === 'KeyB' && topModal() === host && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) { e.preventDefault(); openBook(); } }
  }
  let bookOpen = false;

  async function onSolved(c) {
    updateSave(() => { regionState(regionId).solved[c.id] = true; });
    confetti();
    await speak(c.giver, c.success || ['You did it!']);
    applyStages(true);
    if (c.worldEffect) await say([c.worldEffect], { style: 'narration' });
    if (allSolved() && !st.artefact) {
      for (const { mesh } of stations.values()) mesh.userData.celebrate?.();
      sfx('ding');
      await say(region.story?.resolution || ['The region is at peace.'], { style: 'narration' });
      spawnArtefact(null); // the resolution hands it to you, so it appears by your feet
    }
  }

  // ---------- visible progress: bunting, lanterns, the artefact, the gate ----------
  const stageGroup = new THREE.Group(); ws.scene.add(stageGroup);
  let stagesShown = 0;
  function applyStages(animate = false) {
    const n = challenges.filter(isSolved).length;
    for (let i = stagesShown; i < n; i++) {
      if (i === 0) addBunting();
      else if (i === 1) addLanterns();
    }
    stagesShown = n;
    for (const [sid, { mesh }] of stations) {
      const own = challenges.filter((c) => c.giver === sid);
      if (own.length) mesh.userData.setAwake?.(own.every(isSolved), !animate);
    }
    if (st.artefact || allSolved()) world.setGateOpen(true);
  }
  // after the first challenge: decorations strung over the main path, in the world's own style
  //   attention: flags printed with a sine wave · clip: postcards, a photo pegged next to its words · mamba: bead strings
  function addBunting() {
    const cols = [0xff7ab8, 0xffd35a, 0x3ec7b5, 0x8fd3ff, 0xb39cff];
    const L = (o) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...o });
    const tex = (draw) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const wave = (ink) => tex((g) => { g.fillStyle = '#fff6dc'; g.fillRect(0, 0, 64, 64); g.strokeStyle = ink; g.lineWidth = 6; g.beginPath(); for (let x = 4; x <= 60; x += 2) g.lineTo(x, 22 + Math.sin((x - 4) / 56 * Math.PI * 2) * 9); g.stroke(); });
    const photo = tex((g) => { g.fillStyle = '#7fe0e6'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff1a0'; g.beginPath(); g.arc(44, 20, 9, 0, 7); g.fill(); g.fillStyle = '#2aa5ba'; g.fillRect(0, 40, 64, 24); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(0, 0, 64, 64); });
    const words = tex((g) => { g.fillStyle = '#fff3cf'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#4a3b55'; g.lineCap = 'round'; g.lineWidth = 6; for (const [y, x1] of [[20, 52], [32, 44], [44, 36]]) { g.beginPath(); g.moveTo(12, y); g.lineTo(x1, y); g.stroke(); } });
    const style = { attention: 'waves', clip: 'postcards', mamba: 'beads' }[regionId] || 'flags';
    const waveMats = [wave('#ff7ab8'), wave('#4fa8e8')].map((map) => L({ map }));
    for (const [x0, x1] of [[-30, -16], [-14, 2], [14, 30]]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x0, 3.6, 0.2), new THREE.Vector3((x0 + x1) / 2, 2.9, 0.2), new THREE.Vector3(x1, 3.6, 0.2)]);
      stageGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.02, 4), new THREE.MeshLambertMaterial({ color: 0x6a4a2a })));
      if (style === 'postcards') {
        for (let t = 0.06, i = 0; t < 0.95; t += 0.11, i++) {
          for (const [dx, map] of [[-0.24, photo], [0.24, words]]) {
            const p = curve.getPoint(t + dx / 40);
            const card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.34), L({ map }));
            card.position.set(p.x + dx, p.y - 0.2, p.z); card.rotation.z = (i % 2 ? 0.06 : -0.06); stageGroup.add(card);
            const peg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), new THREE.MeshLambertMaterial({ color: 0xc8956a })); peg.position.set(p.x + dx, p.y - 0.02, p.z + 0.02); stageGroup.add(peg);
          }
        }
      } else if (style === 'beads') {
        const beads = [0xd6304a, 0x3a68d6, 0x2fae5a, 0xf0a830];
        for (let t = 0.02, i = 0; t < 0.99; t += 0.025, i++) {
          const p = curve.getPoint(t);
          const b = new THREE.Mesh(new THREE.SphereGeometry(i % 3 ? 0.09 : 0.14, 10, 8), new THREE.MeshLambertMaterial({ color: i % 3 ? 0xf3cf88 : beads[(i / 3) % beads.length], emissive: i % 3 ? 0x000000 : beads[(i / 3) % beads.length], emissiveIntensity: 0.25 }));
          b.position.copy(p); stageGroup.add(b);
        }
      } else {
        for (let t = 0.03, i = 0; t < 0.98; t += 0.05, i++) {
          const p = curve.getPoint(t); const tri = new THREE.Shape(); tri.moveTo(-0.2, 0); tri.lineTo(0.2, 0); tri.lineTo(0, -0.45);
          const geo = new THREE.ShapeGeometry(tri);
          const m = new THREE.Mesh(geo, style === 'waves' ? waveMats[i % 2] : L({ color: cols[i % cols.length] }));
          if (style === 'waves') { // map the flag's shape onto the printed square
            const uv = geo.attributes.uv, pos = geo.attributes.position;
            for (let k = 0; k < uv.count; k++) uv.setXY(k, (pos.getX(k) + 0.2) / 0.4, 1 + pos.getY(k) / 0.45 * 0.9);
          }
          m.position.copy(p); stageGroup.add(m);
        }
      }
    }
  }
  function addLanterns() {
    for (const x of [-26, -18, -2, 6, 18, 26]) {
      const g = new THREE.Group(); g.position.set(x, 0, 2.9);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0x6a4a2a })); pole.position.y = 1.1; g.add(pole);
      const lan = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshLambertMaterial({ color: 0xffd35a, emissive: 0xffb030, emissiveIntensity: 0.9 })); lan.position.y = 2.35; lan.scale.y = 1.25; g.add(lan);
      stageGroup.add(g);
      world.colliders.push({ type: 'circle', x, z: 2.9, r: 0.2 });
    }
  }
  let artefactItem = null;
  function spawnSpot(a) {
    const clear = (x, z) => !world.colliders.some((c) => (c.type === 'circle' ? Math.hypot(x - c.x, z - c.z) < c.r + 0.5
      : x > c.x0 - 0.5 && x < c.x1 + 0.5 && z > c.z0 - 0.5 && z < c.z1 + 0.5));
    for (const [dx, dz] of [[1.6, 0.6], [-1.6, 0.6], [1.5, -0.7], [-1.5, -0.7], [0.3, 1.5], [2.5, 0], [-2.5, 0]]) {
      const x = a[0] + dx, z = a[2] + dz, y = sampleHeight(world.zones, x, z, a[1]);
      if (y === null || Math.abs(y - a[1]) > 0.05 || Math.hypot(x - player.pos.x, z - player.pos.z) < 1.4 || !clear(x, z)) continue;
      return [x, y, z];
    }
    return [a[0] + 1.6, a[1], a[2] + 0.6];
  }
  function spawnArtefact(nearId) {
    if (st.artefact) return;
    const anchorName = people.get(nearId)?.data.anchor || stations.get(nearId)?.data.anchor || 'lane-mid';
    const a = nearId === null ? [player.pos.x, player.pos.y, player.pos.z] : (ANCHORS[anchorName] || ANCHORS['lane-mid']);
    const [x, y, z] = spawnSpot(a);
    const mesh = buildArtefact(regionId);
    mesh.position.set(x, y, z);
    ws.scene.add(mesh); ws.extras.push(mesh);
    artefactItem = ws.addInteractable({
      label: region.artefact?.name || 'artefact', icon: '✦', pos: { x, y, z }, radius: 2.2,
      onInteract: async () => {
        ws.scene.remove(mesh); ws.extras.splice(ws.extras.indexOf(mesh), 1); ws.removeInteractable(artefactItem);
        updateSave((s) => { regionState(regionId).artefact = true; if (!s.artefacts.includes(regionId)) s.artefacts.push(regionId); });
        confetti(140);
        await itemGet(region.artefact?.name || 'Artefact', region.artefact?.description || '');
        world.setGateOpen(true);
        setHud({ task: taskLine(), artefacts: deliveredArtefacts() });
        toast('🚪 The little door: far left', 3600); pulseHud('map');
      },
    });
  }

  async function leave() {
    const choice = await ask('Back to the lab?', ['Go', 'Stay'], { neutral: true });
    if (choice !== 0) return;
    // walk to the little door, it opens, through you go
    world.door?.userData.setOpen(true);
    await glide(DOOR_POS.x + 0.3, DOOR_POS.z + 1.2, 450);
    await glide(DOOR_POS.x + 0.3, DOOR_POS.z - 0.2, 450);
    ctx.goto('lab');
  }
  // ws.run() skips fn while something else is running; this waits its turn instead
  async function runWhenFree(fn) {
    while (ws.busy && !disposed) await new Promise((r) => setTimeout(r, 120));
    if (!disposed) await ws.run(fn);
  }
  function glide(x, z, ms) {
    const x0 = player.pos.x, z0 = player.pos.z, t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        player.place(x0 + (x - x0) * u, 0, z0 + (z - z0) * u);
        if (u < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  applyStages();
  if (allSolved() && !st.artefact) spawnArtefact(challenges[challenges.length - 1]?.giver);

  return {
    scene: ws.scene, camera: ws.camera, update: ws.update,
    dispose() { disposed = true; for (const h of activeEnv.values()) { try { h?.destroy?.(); } catch (e) { console.error(e); } } activeEnv.clear(); envUpdaters.clear(); ws.dispose(); },
    async onEnter() {
      world.door?.userData.openNow(true); // you just came through it
      setTimeout(() => world.door?.userData.setOpen(false), 500);
      setHud({ place: region.region.name, task: taskLine(), artefacts: deliveredArtefacts(), mapLabel: 'Leave' });
      ws.snapCamera();
    },
    async start() {
      if (st.arrived) { await banner(region.region.name, region.paper?.title || ''); return; }
      await runWhenFree(async () => {
        await banner(region.region.name, region.paper?.title || '');
        await say(region.story?.arrival || [], { style: 'narration' });
        updateSave(() => { regionState(regionId).arrived = true; });
      });
      if (disposed) return;
      pulseHud('book');
      toast('📖 The paper is in the Cursed Book (B)', 3600);
    },
  };
}
