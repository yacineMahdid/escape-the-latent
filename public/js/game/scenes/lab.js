// Professor Grumm's lab: the hub. The Speck stands on his desk. Talk to Grumm, deliver artefacts, open the map.
import * as THREE from 'three';
import { createPlayer, loadHumans } from '../player.js';
import { createWalkScene } from '../walkscene.js';
import { buildArtefact, theName } from '../artefacts.js';
import { getSave, updateSave, regionState } from '../save.js';
import { say, ask, toast } from '../dialogue.js';
import { confetti } from '../fx.js';
import { setHud, pulseHud } from '../hud.js';
import { api } from '../../api.js';
import { rbox, createRng } from '../../engine/geo.js';
import { createKit } from '../../engine/kit.js';

export const REGION_ORDER = ['attention', 'clip', 'mamba'];

const GRUMM = { name: 'Professor Grumm', color: '#6a5acd' };

const INTRO = [
  'Oh. It\'s awake. I\'m Professor Grumm. Normal size. YOU are a Speck.',
  'Perfect size for the Latent: tiny worlds folded from famous papers.',
  'Go in. Bring back REAL knowledge. Not vibes.',
  'Take this book. It whispers. It helps BARELY.',
];
const FINALE = [
  'Three. THREE. From a Speck.',
  'Fine. You may call yourself my assistant. Very junior.',
  '…Good work. Now GO HOME.',
];

function scientistStandIn() {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const coat = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 3.4, 8, 16), m(0xf6f6f2)); coat.position.y = 3.6; g.add(coat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 18), m(0xf0c4a0)); head.position.y = 7.6; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(2.0, 20, 14), m(0xf2f2f2)); hair.position.set(0, 8.2, -0.4); hair.scale.set(1.2, 0.8, 1); g.add(hair);
  for (const sx of [-0.6, 0.6]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), m(0x1e1824)); e.position.set(sx, 7.8, 1.65); g.add(e); const brow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.3), m(0xe8e8e8)); brow.position.set(sx, 8.35, 1.6); brow.rotation.z = sx > 0 ? 0.35 : -0.35; g.add(brow); }
  const stache = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), m(0xf2f2f2)); stache.position.set(0, 7.0, 1.6); stache.scale.set(1.4, 0.4, 0.6); g.add(stache);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  let t = 0; g.userData.setExpression = () => {}; g.userData.animate = (dt) => { t += dt; g.position.y = Math.sin(t * 1.5) * 0.04; };
  return g;
}

export async function createLabScene(ctx) {
  const save = getSave();
  const r = createRng(42);
  const K = createKit(r);
  const root = new THREE.Group();
  const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const add = (geo, mat, x, y, z, par = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
  // Scale: Grumm is a normal man; the Speck is tiny (about the height of his mug).
  // The Speck walks on his desk top (y = 0); the lab floor is far below.
  const S = 2.42;          // humans.buildScientist() is ~9.5 units tall -> ~23 units, ~12x the Speck
  const FLOOR = -9.5;      // a desk is ~0.75 m tall

  // ---------- the desk (the Speck's world) ----------
  const deskTex = K.mkTex(512, 256, (g, w, h) => {
    g.fillStyle = '#c08a52'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { g.fillStyle = `rgba(110,60,25,${0.05 + r() * 0.12})`; g.fillRect(0, y, w, 1 + r() * 2); }
    for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(90,50,20,.25)'; g.lineWidth = 2; g.beginPath(); const cy = r() * h; g.ellipse(r() * w, cy, 30 + r() * 40, 6 + r() * 6, 0, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(60,30,10,.35)'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
  });
  const wood = L(0xffffff, { map: K.wood });
  // rbox bevels outward by ~0.9*r, so sink it 0.11 to put the top at y = 0
  add(rbox(21, 1.0, 10.6, 0.12), L(0xffffff, { map: K.rep(deskTex, 2, 1) }), 0, -0.61, 0);
  for (const x of [-9.8, 9.8]) for (const z of [-4.6, 4.6]) add(rbox(0.9, 9.0, 0.9, 0.1), wood, x, FLOOR + 4.5, z);
  add(rbox(8.5, 2.1, 0.35, 0.1), wood, -4.6, -2.2, 5.2);
  add(new THREE.SphereGeometry(0.22, 12, 10), L(0xf0c040), -4.6, -2.2, 5.45);

  // ---------- the room, at Grumm's scale ----------
  const planks = K.mkTex(256, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { const v = 150 + r() * 30 | 0; g.fillStyle = `rgb(${v + 40},${v - 10},${v - 60})`; g.fillRect(0, i * 32, w, 32); g.fillStyle = 'rgba(60,30,10,.5)'; g.fillRect(0, i * 32, w, 2); g.fillRect((r() * w) | 0, i * 32, 2, 32); } });
  add(new THREE.PlaneGeometry(140, 90), L(0xffffff, { map: K.rep(planks, 10, 6) }), 0, FLOOR, -10).rotation.x = -Math.PI / 2;
  const paper = K.mkTex(256, 256, (g, w, h) => { g.fillStyle = '#e9dcc0'; g.fillRect(0, 0, w, h); g.fillStyle = '#dccba8'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 12, h); g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(r() * w, r() * h, 3, 0, 7); g.fill(); } });
  add(new THREE.PlaneGeometry(140, 70), L(0xffffff, { map: K.rep(paper, 12, 6) }), 0, FLOOR + 35, -24);
  add(new THREE.BoxGeometry(140, 2.4, 0.8), L(0x8a5a36), 0, FLOOR + 1.2, -23.6);
  // chalkboard behind Grumm
  const chalk = K.mkTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#2f4a3c'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(r() * w, r() * h); g.lineTo(r() * w, r() * h); g.stroke(); }
    g.fillStyle = 'rgba(245,245,235,.9)'; g.font = 'italic 44px Georgia';
    g.fillText('Attention(Q,K,V) = softmax(QKᵀ/√dₖ) V', 60, 100);
    g.fillText('L = ½ [CE(logits) + CE(logitsᵀ)]', 120, 210);
    g.fillText('hₜ = Āhₜ₋₁ + B̄xₜ ,  yₜ = Chₜ', 80, 320);
    g.font = 'bold 40px Georgia'; g.fillText('?!', 860, 420); g.font = '32px Georgia'; g.fillText('(do NOT erase  — G.)', 520, 460);
    g.strokeStyle = 'rgba(245,245,235,.8)'; g.lineWidth = 4; g.beginPath(); g.arc(780, 160, 60, 0, 6.28); g.stroke();
  }, 4);
  add(rbox(34, 16, 0.6, 0.4), L(0x8a5a36), -2, 15, -23.4);
  add(new THREE.PlaneGeometry(32.5, 14.5), L(0xffffff, { map: chalk }), -2, 15, -23.0);
  // window with sky on the right
  add(rbox(13, 15, 0.5, 0.3), L(0xfff6e6), 25, 15, -23.5);
  add(new THREE.PlaneGeometry(11.5, 13.5), new THREE.MeshBasicMaterial({ color: 0x8fd3ff }), 25, 15, -23.0);
  add(new THREE.BoxGeometry(0.4, 13.5, 0.3), L(0xfff6e6), 25, 15, -22.7); add(new THREE.BoxGeometry(11.5, 0.4, 0.3), L(0xfff6e6), 25, 15, -22.7);
  // a tall bookshelf on the left
  add(rbox(14, 30, 4, 0.3), wood, -30, FLOOR + 15, -21);
  for (let row = 0; row < 5; row++) {
    add(new THREE.BoxGeometry(13, 0.5, 3.6), L(0x7a4a26), -30, FLOOR + 3 + row * 5.8, -20.4);
    let x = -36;
    while (x < -24) { const bw = 0.8 + r() * 1.1; const bh = 3.2 + r() * 1.6; add(new THREE.BoxGeometry(bw, bh, 2.6), L([0xe8566a, 0x4f86d8, 0xffd35a, 0x3ec7b5, 0xb39cff, 0xff9a45][(r() * 6) | 0]), x + bw / 2, FLOOR + 3.25 + row * 5.8 + bh / 2, -20.2); x += bw + 0.08; }
  }

  // ---------- things on the desk (all Grumm-sized, so huge to the Speck) ----------
  const colliders = [];
  // his pen pot, stuffed with pencils (he already holds his coffee)
  const pot = add(new THREE.CylinderGeometry(0.95, 0.85, 2.1, 28, 1, true), L(0x4f86d8, { side: THREE.DoubleSide }), 6.6, 1.05, -2.6);
  add(new THREE.CylinderGeometry(0.86, 0.86, 0.06, 28), L(0x2f5aa0), 6.6, 0.05, -2.6);
  add(new THREE.TorusGeometry(0.95, 0.07, 6, 28), L(0xffd35a), 6.6, 2.08, -2.6).rotation.x = Math.PI / 2;
  [[0xffc83a, -0.35, 0.2, 0.18], [0xe8566a, 0.3, -0.25, -0.14], [0x3ec7b5, 0.05, 0.35, 0.05], [0xffc83a, 0.4, 0.25, -0.22]].forEach(([c, dx, dz, tilt]) => {
    const pen = add(new THREE.CylinderGeometry(0.12, 0.12, 3.0, 6), L(c), 6.6 + dx, 2.2, -2.6 + dz); pen.rotation.z = tilt; pen.rotation.x = dz * 0.4;
    const nib = add(new THREE.ConeGeometry(0.12, 0.35, 6), L(0xf3d9b0), 0, 1.67, 0, pen); nib.rotation.x = 0;
  });
  pot.castShadow = true;
  colliders.push({ type: 'circle', x: 6.6, z: -2.6, r: 1.15 });
  // a stack of books
  const bookCols = [0xe8566a, 0x4f86d8, 0xffd35a, 0x3ec7b5];
  for (let i = 0; i < 4; i++) { const b = add(rbox(3.4 - i * 0.15, 0.42, 2.5, 0.06), L(bookCols[i]), -7.2 + (i % 2) * 0.15, 0.21 + i * 0.43, -2.6); b.rotation.y = (r() - 0.5) * 0.25; add(new THREE.BoxGeometry(3.2 - i * 0.15, 0.3, 0.06), L(0xfffdf6), b.position.x, b.position.y, -1.33); }
  colliders.push({ type: 'rect', x0: -9.2, x1: -5.2, z0: -4.0, z1: -1.2 });
  // the three papers, printed, lying on the desk
  const titles = ['Attention Is All You Need', 'Learning Transferable Visual Models From Natural Language Supervision', 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces'];
  titles.forEach((title, i) => {
    const tex = K.mkTex(256, 360, (g, w, h) => {
      g.fillStyle = '#fffdf6'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b2233'; g.font = 'bold 20px Georgia'; g.textAlign = 'center';
      const words = title.split(' '); let line = '', y = 44;
      for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > 210) { g.fillText(line, w / 2, y); y += 24; line = wd; } else line = t; }
      g.fillText(line, w / 2, y);
      g.fillStyle = '#b9b2c6'; for (let yy = y + 30; yy < h - 20; yy += 12) g.fillRect(24, yy, 120 + ((yy * 7) % 90), 5);
    }, 4);
    const sheet = add(new THREE.PlaneGeometry(2.7, 3.8), L(0xffffff, { map: tex }), [-2.2, 0.9, 3.4][i], 0.012 + i * 0.004, [-1.4, -2.3, -0.9][i]);
    sheet.rotation.x = -Math.PI / 2; sheet.rotation.z = [0.22, -0.12, 0.36][i];
  });
  // a pencil, an eraser and a paperclip
  const pencil = new THREE.Group(); pencil.position.set(3.6, 0.14, 3.5); pencil.rotation.y = 0.45; root.add(pencil);
  const pb = add(new THREE.CylinderGeometry(0.14, 0.14, 2.3, 6), L(0xffc83a), 0, 0, 0, pencil); pb.rotation.z = Math.PI / 2;
  const tip = add(new THREE.ConeGeometry(0.14, 0.45, 6), L(0xf3d9b0), 1.37, 0, 0, pencil); tip.rotation.z = -Math.PI / 2;
  const lead = add(new THREE.ConeGeometry(0.05, 0.16, 6), L(0x2b2233), 1.6, 0, 0, pencil); lead.rotation.z = -Math.PI / 2;
  const er = add(new THREE.CylinderGeometry(0.14, 0.14, 0.25, 12), L(0xff8aa8), -1.27, 0, 0, pencil); er.rotation.z = Math.PI / 2;
  add(rbox(1.0, 0.42, 0.6, 0.12), L(0xff8aa8), -4.0, 0.21, 3.7).rotation.y = 0.3;
  colliders.push({ type: 'circle', x: -4.0, z: 3.7, r: 0.6 });
  const clip = add(new THREE.TorusGeometry(0.3, 0.03, 6, 20), L(0xb9bcc6), 0.9, 0.03, 4.0); clip.rotation.x = Math.PI / 2; clip.scale.set(1.6, 1, 1);
  // desk lamp
  const lampG = new THREE.Group(); lampG.position.set(8.8, 0, -3.8); root.add(lampG);
  add(new THREE.CylinderGeometry(0.9, 1.0, 0.25, 24), L(0x3e4a5e), 0, 0.12, 0, lampG);
  const arm1 = add(new THREE.CylinderGeometry(0.09, 0.09, 3.2, 8), L(0x3e4a5e), 0, 1.7, 0, lampG); arm1.rotation.z = 0.25;
  const arm2 = add(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 8), L(0x3e4a5e), -1.0, 3.6, 0.3, lampG); arm2.rotation.z = 1.1;
  const shade = add(new THREE.ConeGeometry(0.9, 1.2, 24, 1, true), L(0x3e4a5e, { side: THREE.DoubleSide }), -2.2, 3.3, 0.6, lampG); shade.rotation.z = 0.7;
  add(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff1c0 }), -2.35, 3.0, 0.6, lampG);
  const lampLight = new THREE.PointLight(0xffe2a8, 18, 16, 1.4); lampLight.position.set(6.4, 2.6, -3.2); root.add(lampLight);
  colliders.push({ type: 'circle', x: 8.8, z: -3.8, r: 1.1 });
  // the folded paper map: walk to it to travel into the Latent
  const mapTex = K.mkTex(256, 192, (g, w, h) => { g.fillStyle = '#f6e7c3'; g.fillRect(0, 0, w, h); g.fillStyle = '#7bcd5d'; g.beginPath(); g.ellipse(70, 80, 40, 28, 0, 0, 7); g.fill(); g.fillStyle = '#22cfd8'; g.beginPath(); g.ellipse(170, 60, 36, 24, 0, 0, 7); g.fill(); g.fillStyle = '#f3cf88'; g.beginPath(); g.ellipse(150, 140, 50, 26, 0, 0, 7); g.fill(); g.fillStyle = '#e8566a'; for (const [x, y] of [[70, 80], [170, 60], [150, 140]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); } g.strokeStyle = '#8a5a36'; g.setLineDash([6, 6]); g.lineWidth = 3; g.beginPath(); g.moveTo(70, 80); g.lineTo(170, 60); g.lineTo(150, 140); g.stroke(); });
  const tent = new THREE.Group(); tent.position.set(7.8, 0, 1.8); tent.rotation.y = -0.5; root.add(tent);
  for (const side of [-1, 1]) { const pl = add(new THREE.PlaneGeometry(2.6, 1.9), L(0xffffff, { map: mapTex, side: THREE.DoubleSide }), 0, 0.82, side * 0.42, tent); pl.rotation.x = side * 0.45; }
  colliders.push({ type: 'rect', x0: 6.5, x1: 9.1, z0: 0.9, z1: 2.7 });
  // pedestals for the artefacts Grumm keeps
  const shelfSlots = [[-8.3, 0.9], [-6.6, 0.9], [-4.9, 0.9]];
  const CAP_H = 0.36;
  const capCols = [[0xe8566a, 0xffd0d8], [0x4f86d8, 0xd6e6ff], [0xffc83a, 0xfff1c0]];
  shelfSlots.forEach(([x, z], i) => {
    // bottle caps: crimped rim, flat top
    add(new THREE.CylinderGeometry(0.62, 0.66, CAP_H, 21), L(capCols[i][0], { flatShading: true }), x, CAP_H / 2, z);
    add(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 24), L(capCols[i][1]), x, CAP_H + 0.01, z);
    colliders.push({ type: 'circle', x, z, r: 0.6 });
  });

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const world = {
    root,
    zones: [{ x0: -9.9, x1: 9.9, z0: -3.3, z1: 4.8, y: 0 }],
    colliders,
    update() {},
  };

  // Grumm: a normal-sized man standing behind his desk
  const humans = await loadHumans();
  const grumm = humans && humans.buildScientist ? humans.buildScientist() : scientistStandIn();
  grumm.scale.setScalar(S);
  grumm.position.set(0, FLOOR, -10.5);
  root.add(grumm);
  let grummTalking = false;
  const setExpr = (e) => grumm.userData.setExpression?.(e);
  setExpr('grumpy');

  const player = await createPlayer(save.character);
  player.place(0, 0, 2.6);

  const ws = createWalkScene({
    engine: ctx.engine, world, player,
    light: { sky: 0xfff4e0, ground: 0x9a7a5a, hi: 1.45, sun: 0xffe8cc, si: 1.7, dir: [16, 24, 14] },
    background: 0xe9dcc0,
    camera: {
      fov: 48,
      place(camera, c) { const x = Math.max(-4, Math.min(4, c.x * 0.4)); camera.position.set(x, 6.4, 18.5); camera.lookAt(x, 4.6, -6); },
    },
    actions: {
      book: () => openTaskBook(),
      map: () => openMap(),
      menu: () => ctx.pauseMenu(),
      tick: (dt) => { grumm.userData.animate?.(dt, { talking: grummTalking }); },
    },
  });
  Object.assign(ws.sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -14, far: 120 });

  // delivered artefacts on their pedestals
  function refreshShelf() {
    root.children.filter((o) => o.userData.isTrophy).forEach((o) => { root.remove(o); const i = ws.extras.indexOf(o); if (i >= 0) ws.extras.splice(i, 1); });
    REGION_ORDER.forEach((id, i) => {
      if (!regionState(id).returned) return;
      const a = buildArtefact(id); a.userData.isTrophy = true; a.position.set(shelfSlots[i][0], CAP_H, shelfSlots[i][1]); a.scale.setScalar(0.85); root.add(a); ws.extras.push(a);
    });
  }
  refreshShelf();

  async function grummSays(lines, expr = 'grumpy') {
    setExpr('talking'); grummTalking = true;
    try { await say(lines, { speaker: GRUMM, style: 'grumm' }); } finally { grummTalking = false; setExpr(expr); }
  }

  const regions = {};
  async function region(id) { if (!regions[id]) regions[id] = await api.region(id).catch(() => null); return regions[id]; }

  function nextTask() { return REGION_ORDER.find((id) => !regionState(id).returned) || null; }

  async function assign(id) {
    const rg = await region(id);
    updateSave((s) => { s.currentTask = id; });
    if (rg) await grummSays(rg.scientist?.briefing || [`Go to ${rg.region.name}. Bring me something worth my time.`]);
    else await grummSays(['Hmm. That map is missing. Somebody ate it.']);
    refreshHud();
    pulseHud('map');
  }

  async function talkToGrumm() {
    const s = getSave();
    if (!s.introSeen) {
      await grummSays(INTRO);
      updateSave((x) => { x.introSeen = true; });
      await assign(nextTask());
      return;
    }
    // deliver any artefact not yet returned, in order
    for (const id of REGION_ORDER) {
      const rs = regionState(id);
      if (rs.artefact && !rs.returned) {
        const rg = await region(id);
        await say([`You hand over ${theName(rg?.artefact?.name)}.`], { style: 'narration' });
        setExpr('surprised');
        await grummSays(rg?.scientist?.return || ['...Hm. Hmph. Fine.'], 'surprised');
        updateSave(() => { regionState(id).returned = true; });
        confetti(120);
        refreshShelf();
        const nx = nextTask();
        if (nx) { setExpr('grumpy'); await assign(nx); }
        else { await grummSays(FINALE, 'surprised'); updateSave((x) => { x.currentTask = null; x.endingSeen = true; }); ctx.goto('ending'); }
        return;
      }
    }
    const cur = s.currentTask || nextTask();
    if (!cur) { await grummSays(['You again. Go be competent elsewhere.']); return; }
    const rg = await region(cur);
    await grummSays(rg?.scientist?.reminder || ['The map, Speck. On my desk. GO.']);
  }

  async function openMap() {
    const s = getSave();
    if (!s.introSeen) { toast('Talk to Grumm first', 2200); return; }
    const { openMapOverlay } = await import('./map.js');
    const choice = await openMapOverlay(ctx);
    if (choice) ctx.goto('region', choice);
  }

  async function openTaskBook() {
    const s = getSave();
    const id = s.currentTask || REGION_ORDER.find((x) => regionState(x).arrived);
    if (!s.introSeen) { toast('No book yet', 1800); return; }
    const rg = id ? await region(id) : null;
    if (!rg) { toast('Nothing to read yet', 1800); return; }
    await ctx.openBook({ arxivId: rg.paper.arxivId, title: rg.paper.title }, id);
  }

  async function refreshHud() {
    const s = getSave();
    const cur = s.currentTask;
    let task = s.introSeen ? '' : 'Talk to Grumm';
    if (cur) {
      const rg = await region(cur);
      const rs = regionState(cur);
      task = rs.artefact && !rs.returned ? `Give Grumm ${theName(rg?.artefact?.name)}` : (rg?.scientist?.taskTitle || '');
    }
    setHud({ place: 'Lab', task, artefacts: s.artefacts, mapLabel: 'Map' });
  }

  ws.addInteractable({ label: 'Grumm', icon: '💬', pos: { x: 0, y: 0, z: -2.8 }, radius: 4.0, promptHeight: 2.6, onInteract: talkToGrumm });
  ws.addInteractable({ label: 'Map', icon: '🗺️', pos: { x: 7.8, y: 0, z: 1.8 }, radius: 2.6, promptHeight: 2.6, onInteract: openMap });
  ws.addInteractable({
    label: 'Trophies', icon: '✦', pos: { x: -6.6, y: 0, z: 0.9 }, radius: 2.4, promptHeight: 2.4,
    onInteract: async () => {
      const done = REGION_ORDER.filter((id) => regionState(id).returned);
      if (!done.length) { await say(['Three empty bottle caps. Pedestals, apparently.'], { style: 'narration' }); return; }
      const lines = [];
      for (const id of done) { const rg = await region(id); lines.push(`✦ ${rg?.artefact?.name || id}`); }
      await say([lines.join('   ')], { style: 'narration' });
    },
  });

  return {
    scene: ws.scene, camera: ws.camera, update: ws.update, dispose: ws.dispose,
    async onEnter() { await refreshHud(); ws.snapCamera(); },
    async start() {
      const s = getSave();
      if (!s.introSeen) {
        await ws.run(() => say(['You wake up on a desk. Everything is enormous. Including him.'], { style: 'narration' }));
        await ws.run(talkToGrumm);
      } else if (REGION_ORDER.some((id) => regionState(id).artefact && !regionState(id).returned)) {
        toast('Give Grumm the artefact', 2600);
      }
    },
  };
}
