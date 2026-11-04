// A paper region: diorama + inhabitants + stations + the challenge chain from content/regions/<id>.json.
import * as THREE from 'three';
import { buildDiorama, ANCHORS, DOOR_POS } from '../../engine/diorama.js';
import { buildVillager } from '../../engine/villagers.js';
import { createPlayer } from '../player.js';
import { createWalkScene, dioramaCamera } from '../walkscene.js';
import { buildStation } from '../stations.js';
import { buildArtefact, theName } from '../artefacts.js';
import { getSave, updateSave, regionState, isLearned, learn } from '../save.js';
import { say, ask, askValue, banner, toast, itemGet } from '../dialogue.js';
import { confetti } from '../fx.js';
import { sfx } from '../sfx.js';
import { setHud, pulseHud } from '../hud.js';
import { openModal, closeModal } from '../../ui/modal.js';
import { api } from '../../api.js';

const STATION_ICONS = { terminal: '⌨️', board: '📌', mailbox: '✉️', sign: '🪧', machine: '⚙️' };
const hashSeed = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) || 11;

export async function createRegionScene(ctx, regionId) {
  const region = await api.region(regionId);
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
    const mesh = buildStation(s.kind, {});
    mesh.position.set(a[0], a[1], a[2]);
    mesh.rotation.y = 0.1;
    ws.scene.add(mesh); ws.extras.push(mesh);
    stations.set(s.id, { data: s, mesh });
    world.colliders.push({ type: 'circle', x: a[0], z: a[2], r: 0.85 });
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
        const lines = next.type !== 'explain' ? [].concat(next.retry)
          : explainFeedback ? [].concat(next.retry).filter((l) => !explainFeedback.includes(String(l).trim())) : [];
        if (lines.length) await speak(id, lines);
      }
      return;
    }
    const pending = mine.find((c) => !isSolved(c));
    if (rec) {
      const lines = (!pending && mine.length) || (allSolved() && st.artefact) ? (rec.data.lines?.afterSolved || rec.data.lines?.default) : rec.data.lines?.default;
      await speak(id, lines || ['...']);
    } else {
      const label = nameOf(id);
      const kind = stations.get(id)?.data.kind;
      if (kind === 'sign') await say([`“${label}”`], { style: 'narration' });
      else if (stations.get(id)?.data.lines) await say(stations.get(id).data.lines, { style: 'narration' });
      else await say([pending ? 'Locked. Something else comes first.' : 'Nothing to do here now.'], { style: 'narration' });
    }
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
        const res = await ex.open({ challenge: c, regionId, speaker: { name: nameOf(c.giver) } });
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
      const n = Number(String(v).replace(/[, ]/g, '').replace(/%$/, ''));
      if (!Number.isFinite(n)) return false;
      const tol = chk.tolerance ?? Math.max(1e-9, Math.abs(chk.answer) * 1e-3);
      return Math.abs(n - chk.answer) <= tol;
    }
    if (chk.kind === 'explain') {
      try {
        const ex = await import('../../ui/explain.js');
        const res = await ex.open({ challenge: { id: f.id, type: 'explain', title: f.title, question: chk.question, rubric: chk.rubric, offline: chk.offline }, regionId, speaker: { name: nameOf(giverId) } });
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
    try { handle?.destroy?.(); } catch (e) { console.error(e); }
    closeModal(host); host.remove();
    return result;
  }

  // a villager's questions: every answer must be right (a wrong one ends the round; ask again later)
  async function runQuiz(c, giverId) {
    const speaker = people.get(giverId) ? { speaker: { name: nameOf(giverId), color: colorOf(giverId) } } : { style: 'narration' };
    for (const q of c.questions || []) {
      let ok;
      if (q.kind === 'number') {
        const v = await askValue(q.question, { ...speaker, placeholder: q.placeholder || 'a number' });
        if (v === null) return false;
        const n = Number(String(v).replace(/[, ]/g, '').replace(/%$/, ''));
        ok = Number.isFinite(n) && Math.abs(n - q.answer) <= (q.tolerance ?? Math.max(1e-9, Math.abs(q.answer) * 1e-3));
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
  function refreshTask() {
    setHud({ task: st.artefact && !st.returned ? `Bring ${theName(region.artefact?.name)} to Becancourt` : (region.scientist?.taskTitle || '') });
  }

  async function runPuzzle(c) {
    let mod;
    try { mod = await import(`../../puzzles/${c.puzzle}.js`); }
    catch (e) { console.error(e); await say(['This puzzle is missing.'], { style: 'narration' }); return false; }
    const host = document.createElement('div');
    host.className = 'puzzle-host';
    document.getElementById('ui-root').appendChild(host);
    let handle = null;
    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      openModal(host, { onEscape: () => finish(false) });
      try {
        handle = (mod.default || mod).mount(host, c.spec || {}, { onSolved: () => finish(true), onClose: () => finish(false), sfx });
      } catch (e) { console.error(e); finish(false); }
    });
    try { handle?.destroy?.(); } catch (e) { console.error(e); }
    closeModal(host); host.remove();
    return result;
  }

  async function onSolved(c) {
    updateSave(() => { regionState(regionId).solved[c.id] = true; });
    confetti();
    await speak(c.giver, c.success || ['You did it!']);
    applyStages();
    if (c.worldEffect) await say([c.worldEffect], { style: 'narration' });
    if (allSolved() && !st.artefact) {
      await say(region.story?.resolution || ['The region is at peace.'], { style: 'narration' });
      spawnArtefact(c.giver);
    }
  }

  // ---------- visible progress: bunting, lanterns, the artefact, the gate ----------
  const stageGroup = new THREE.Group(); ws.scene.add(stageGroup);
  let stagesShown = 0;
  function applyStages() {
    const n = challenges.filter(isSolved).length;
    for (let i = stagesShown; i < n; i++) {
      if (i === 0) addBunting();
      else if (i === 1) addLanterns();
    }
    stagesShown = n;
    if (st.artefact || allSolved()) world.setGateOpen(true);
  }
  function addBunting() {
    const cols = [0xff7ab8, 0xffd35a, 0x3ec7b5, 0x8fd3ff, 0xb39cff];
    for (const [x0, x1] of [[-30, -16], [-14, 2], [14, 30]]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x0, 3.6, 0.2), new THREE.Vector3((x0 + x1) / 2, 2.9, 0.2), new THREE.Vector3(x1, 3.6, 0.2)]);
      stageGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.02, 4), new THREE.MeshLambertMaterial({ color: 0x6a4a2a })));
      for (let t = 0.03; t < 0.98; t += 0.05) {
        const p = curve.getPoint(t); const tri = new THREE.Shape(); tri.moveTo(-0.2, 0); tri.lineTo(0.2, 0); tri.lineTo(0, -0.45);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshLambertMaterial({ color: cols[Math.round(t * 20) % cols.length], side: THREE.DoubleSide }));
        m.position.copy(p); stageGroup.add(m);
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
  function spawnArtefact(nearId) {
    if (st.artefact) return;
    const anchorName = people.get(nearId)?.data.anchor || stations.get(nearId)?.data.anchor || 'lane-mid';
    const a = ANCHORS[anchorName] || ANCHORS['lane-mid'];
    const x = a[0] + 1.6, z = a[2] + 0.6;
    const mesh = buildArtefact(regionId);
    mesh.position.set(x, a[1], z);
    ws.scene.add(mesh); ws.extras.push(mesh);
    artefactItem = ws.addInteractable({
      label: region.artefact?.name || 'artefact', icon: '✦', pos: { x, y: a[1], z }, radius: 2.2,
      onInteract: async () => {
        ws.scene.remove(mesh); ws.extras.splice(ws.extras.indexOf(mesh), 1); ws.removeInteractable(artefactItem);
        updateSave((s) => { regionState(regionId).artefact = true; if (!s.artefacts.includes(regionId)) s.artefacts.push(regionId); });
        confetti(140);
        await itemGet(region.artefact?.name || 'Artefact', region.artefact?.description || '');
        world.setGateOpen(true);
        setHud({ task: `Bring ${theName(region.artefact?.name)} to Becancourt`, artefacts: getSave().artefacts });
        toast('Bring it to Becancourt: the little door, far left', 3600); pulseHud('map');
      },
    });
  }

  async function leave() {
    const choice = await ask('Back to the lab?', ['Go', 'Stay']);
    if (choice !== 0) return;
    // walk to the little door, it opens, through you go
    world.door?.userData.setOpen(true);
    await glide(DOOR_POS.x + 0.3, DOOR_POS.z + 1.2, 450);
    await glide(DOOR_POS.x + 0.3, DOOR_POS.z - 0.2, 450);
    ctx.goto('lab');
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
    dispose() { for (const h of activeEnv.values()) { try { h?.destroy?.(); } catch (e) { console.error(e); } } activeEnv.clear(); envUpdaters.clear(); ws.dispose(); },
    async onEnter() {
      world.door?.userData.openNow(true); // you just came through it
      setTimeout(() => world.door?.userData.setOpen(false), 500);
      setHud({ place: region.region.name, task: st.artefact && !st.returned ? `Bring ${theName(region.artefact?.name)} to Becancourt` : (region.scientist?.taskTitle || ''), artefacts: getSave().artefacts, mapLabel: 'Leave' });
      ws.snapCamera();
    },
    async start() {
      await banner(region.region.name, region.paper?.title || '');
      if (!st.arrived) {
        updateSave(() => { regionState(regionId).arrived = true; });
        await ws.run(() => say(region.story?.arrival || [], { style: 'narration' }));
        pulseHud('book');
        toast('📖 The paper is in the Cursed Book (B)', 3600);
      }
    },
  };
}
