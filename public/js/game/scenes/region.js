// A paper region: diorama + inhabitants + stations + the challenge chain from content/regions/<id>.json.
import * as THREE from 'three';
import { buildDiorama, ANCHORS } from '../../engine/diorama.js';
import { buildVillager } from '../../engine/villagers.js';
import { createPlayer } from '../player.js';
import { createWalkScene, dioramaCamera } from '../walkscene.js';
import { buildStation } from '../stations.js';
import { buildArtefact } from '../artefacts.js';
import { getSave, updateSave, regionState, isLearned, learn } from '../save.js';
import { say, ask, askValue, banner, toast, itemGet } from '../dialogue.js';
import { confetti } from '../fx.js';
import { setHud } from '../hud.js';
import { openModal, closeModal } from '../../ui/modal.js';
import { api } from '../../api.js';

const hashSeed = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) || 11;

export async function createRegionScene(ctx, regionId) {
  const region = await api.region(regionId);
  const save = getSave();
  const world = buildDiorama(region.region.biome, { seed: hashSeed(regionId) });
  const player = await createPlayer(save.character);
  const st = regionState(regionId);
  const arrival = ANCHORS.arrival;
  player.place(arrival[0], arrival[1], arrival[2]);

  const ws = createWalkScene({
    engine: ctx.engine, world, player, light: world.biome.light, fog: world.biome.fog, camera: dioramaCamera,
    actions: {
      book: () => ctx.openBook({ arxivId: region.paper.arxivId, title: region.paper.title }, regionId),
      map: () => leave(),
      menu: () => ctx.pauseMenu(),
    },
  });

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
    ws.addInteractable({ label: `Talk to ${inh.name}`, pos: { x: a[0], y: a[1], z: a[2] }, onInteract: () => talkTo(inh.id) });
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
    ws.addInteractable({ label: s.label || 'Look', pos: { x: a[0], y: a[1], z: a[2] + 0.6 }, radius: 2.2, onInteract: () => talkTo(s.id) });
  }
  ws.addInteractable({ label: 'Travel back to the lab', pos: { x: world.signpost.x, y: 0, z: world.signpost.z }, onInteract: () => leave() });

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
      await speak(id, f.known || [`Oh! Your book already knows about ${f.title}. Never mind, then.`]);
    }
    const mine = chain.filter((c) => c.giver === id);
    const next = mine.find(ready);
    if (next && next.type === 'fundamental') {
      await speak(id, next.intro || [`${nameOf(id)} has a question about ${next.title}.`]);
      const ok = await runFundamental(next, id);
      if (ok === true) await onFundamental(next, id);
      else if (ok === false) await speak(id, next.wrong || ['Hmm, no, that\'s not it.']);
      return;
    }
    if (next) {
      await speak(id, next.intro || [`${nameOf(id)} needs your help.`]);
      const go = await ask('Take on the challenge?', ['Let\'s do it', 'Not yet'], rec ? { speaker: { name: rec.data.name, color: colorOf(id) } } : { style: 'narration' });
      if (go !== 0) return;
      const ok = await runChallenge(next);
      if (ok) await onSolved(next);
      else if (next.type === 'explain' && next.retry) await speak(id, next.retry);
      return;
    }
    const pending = mine.find((c) => !isSolved(c));
    if (rec) {
      const lines = (!pending && mine.length) || (allSolved() && st.artefact) ? (rec.data.lines?.afterSolved || rec.data.lines?.default) : rec.data.lines?.default;
      await speak(id, lines || ['...']);
    } else {
      const label = nameOf(id);
      const kind = stations.get(id)?.data.kind;
      if (kind === 'sign') await say([`The sign reads: "${label}"`], { style: 'narration' });
      else if (stations.get(id)?.data.lines) await say(stations.get(id).data.lines, { style: 'narration' });
      else await say(pending ? [`The ${label} won't respond yet. Something else must come first.`] : [`The ${label} hums quietly.`], { style: 'narration' });
    }
  }

  async function runChallenge(c) {
    try {
      if (c.type === 'puzzle') return await runPuzzle(c);
      if (c.type === 'code') {
        const term = await import('../../ui/terminal.js');
        const res = await term.open({ challenge: c, regionId });
        return !!res?.solved;
      }
      if (c.type === 'explain') {
        const ex = await import('../../ui/explain.js');
        const res = await ex.open({ challenge: c, regionId, speaker: { name: nameOf(c.giver) } });
        return !!res?.pass;
      }
    } catch (e) {
      console.error('challenge failed to open', e);
      await say(['(Something in the paper folds jammed. This challenge could not open.)'], { style: 'narration' });
    }
    return false;
  }

  // returns true (right), false (wrong) or null (player backed out)
  async function runFundamental(f, giverId) {
    const chk = f.check || {};
    const speaker = people.get(giverId) ? { speaker: { name: nameOf(giverId), color: colorOf(giverId) } } : { style: 'narration' };
    if (chk.kind === 'choice') {
      const opts = [...(chk.options || []), 'Let me think about it'];
      const i = await ask(chk.question, opts, { ...speaker, neutral: true });
      if (i === opts.length - 1) return null;
      return i === chk.answer;
    }
    if (chk.kind === 'number') {
      const v = await askValue(chk.question, { ...speaker, placeholder: 'A number' });
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
    toast(`📖 The Umbral Book wrote down: ${f.title}`, 3200);
  }

  async function runPuzzle(c) {
    let mod;
    try { mod = await import(`../../puzzles/${c.puzzle}.js`); }
    catch (e) { console.error(e); await say([`(The puzzle "${c.title}" isn't built yet.)`], { style: 'narration' }); return false; }
    const host = document.createElement('div');
    host.className = 'puzzle-host';
    document.getElementById('ui-root').appendChild(host);
    let handle = null;
    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      openModal(host, { onEscape: () => finish(false) });
      try {
        handle = (mod.default || mod).mount(host, c.spec || {}, { onSolved: () => finish(true), onClose: () => finish(false), sfx: () => {} });
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
      label: `Take the ${region.artefact?.name || 'artefact'}`, pos: { x, y: a[1], z }, radius: 2.2,
      onInteract: async () => {
        ws.scene.remove(mesh); ws.extras.splice(ws.extras.indexOf(mesh), 1); ws.removeInteractable(artefactItem);
        updateSave((s) => { regionState(regionId).artefact = true; if (!s.artefacts.includes(regionId)) s.artefacts.push(regionId); });
        confetti(140);
        await itemGet(region.artefact?.name || 'Artefact', region.artefact?.description || '');
        world.setGateOpen(true);
        setHud({ task: `Bring the ${region.artefact?.name || 'artefact'} to Grumm`, artefacts: getSave().artefacts });
        toast('Use the signpost on the far left to travel back to Grumm.');
      },
    });
  }

  async function leave() {
    const choice = await ask(`Leave ${region.region.name} and travel back to Professor Grumm's lab?`, ['Travel back', 'Stay']);
    if (choice === 0) ctx.goto('lab');
  }

  applyStages();
  if (allSolved() && !st.artefact) spawnArtefact(challenges[challenges.length - 1]?.giver);

  return {
    scene: ws.scene, camera: ws.camera, update: ws.update, dispose: ws.dispose,
    async onEnter() {
      setHud({ place: region.region.name, task: st.artefact ? `Bring the ${region.artefact?.name} to Grumm` : (region.scientist?.taskTitle || ''), artefacts: getSave().artefacts, mapLabel: 'Leave' });
      ws.snapCamera();
    },
    async start() {
      await banner(region.region.name, region.paper ? `${region.paper.title} · ${region.paper.year}` : '');
      if (!st.arrived) {
        updateSave(() => { regionState(regionId).arrived = true; });
        await ws.run(() => say(region.story?.arrival || [], { style: 'narration' }));
        toast('Press B to open the Umbral Book. The paper is inside.', 4200);
      }
    },
  };
}
