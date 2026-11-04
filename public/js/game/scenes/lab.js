// Jean-Lafontaine de Becancourt's lab: the hub. The Speck stands on his desk. Talk to him, deliver artefacts,
// then climb down the ruler to the little door in the baseboard: behind it are the small (real) worlds.
import * as THREE from 'three';
import { createPlayer, loadScientist, scientistStandIn } from '../player.js';
import { createWalkScene } from '../walkscene.js';
import { buildArtefact, theName } from '../artefacts.js';
import { getSave, updateSave, regionState, deliveredArtefacts } from '../save.js';
import { say, ask, toast } from '../dialogue.js';
import { confetti } from '../fx.js';
import { setHud, pulseHud } from '../hud.js';
import { api } from '../../api.js';
import { rbox, createRng } from '../../engine/geo.js';
import { createKit } from '../../engine/kit.js';
import { buildLittleDoor } from '../../engine/littledoor.js';

export const REGION_ORDER = ['attention', 'clip', 'mamba'];

const SCIENTIST = { name: 'Jean-Lafontaine de Becancourt', color: '#6a5acd' };

const INTRO = [
  'Oh. It\'s awake. I\'m Jean-Lafontaine de Becancourt. Normal size. YOU are a Speck.',
  'Perfect size for the little door down there. Small worlds behind it. Real ones.',
  'Go in. Bring back REAL knowledge. Not vibes.',
  'Take this: the Cursed Book of Dimensionality. It whispers. It helps. BARELY.',
];
const FINALE = [
  'Three. THREE. From a Speck.',
  'Fine. You may call yourself my assistant. Very junior.',
  '…Good work. Now GO HOME.',
];


export async function createLabScene(ctx) {
  const save = getSave();
  const r = createRng(42);
  const K = createKit(r);
  const root = new THREE.Group();
  const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const add = (geo, mat, x, y, z, par = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
  // Scale: he is a normal man; the Speck is tiny (about the height of his mug).
  // The Speck walks on his desk top (y = 0); the lab floor is far below.
  const S = 2.42;          // buildScientist() is ~9.5 units tall -> ~23 units, ~12x the Speck
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

  // ---------- the room, at his scale ----------
  const planks = K.mkTex(256, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { const v = 150 + r() * 30 | 0; g.fillStyle = `rgb(${v + 40},${v - 10},${v - 60})`; g.fillRect(0, i * 32, w, 32); g.fillStyle = 'rgba(60,30,10,.5)'; g.fillRect(0, i * 32, w, 2); g.fillRect((r() * w) | 0, i * 32, 2, 32); } });
  add(new THREE.PlaneGeometry(140, 90), L(0xffffff, { map: K.rep(planks, 10, 6) }), 0, FLOOR, -10).rotation.x = -Math.PI / 2;
  const paper = K.mkTex(256, 256, (g, w, h) => { g.fillStyle = '#e9dcc0'; g.fillRect(0, 0, w, h); g.fillStyle = '#dccba8'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 12, h); g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(r() * w, r() * h, 3, 0, 7); g.fill(); } });
  add(new THREE.PlaneGeometry(140, 70), L(0xffffff, { map: K.rep(paper, 12, 6) }), 0, FLOOR + 35, -24);
  add(new THREE.BoxGeometry(140, 2.4, 0.8), L(0x8a5a36), 0, FLOOR + 1.2, -23.6);
  // chalkboard behind him
  const chalk = K.mkTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#2f4a3c'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(r() * w, r() * h); g.lineTo(r() * w, r() * h); g.stroke(); }
    g.fillStyle = 'rgba(245,245,235,.9)'; g.font = 'italic 44px Georgia';
    g.fillText('Attention(Q,K,V) = softmax(QKᵀ/√dₖ) V', 60, 100);
    g.fillText('L = ½ [CE(logits) + CE(logitsᵀ)]', 120, 210);
    g.fillText('hₜ = Āhₜ₋₁ + B̄xₜ ,  yₜ = Chₜ', 80, 320);
    g.font = 'bold 40px Georgia'; g.fillText('?!', 860, 420); g.font = '32px Georgia'; g.fillText('(do NOT erase  — J.-L. de B.)', 440, 460);
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

  // ---------- things on the desk (all his size, so huge to the Speck) ----------
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
  // ---------- the way down: a wooden ruler leaning off the desk's right edge ----------
  const RAMP = { x0: 10.5, x1: 26.6, z0: 2.5, z1: 4.9 }; // its top surface runs from y 0 to the floor
  const rulerTex = K.mkTex(1024, 96, (g, w, h) => {
    g.fillStyle = '#f2d27a'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(150,100,40,.18)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.fillStyle = '#2b2233'; g.font = 'bold 20px Georgia'; g.textAlign = 'center';
    for (let i = 0; i <= 120; i++) {
      const x = 12 + (i * (w - 24)) / 120; const len = i % 10 === 0 ? 34 : i % 5 === 0 ? 24 : 14;
      g.fillRect(x - 1, 0, 2, len); g.fillRect(x - 1, h - len, 2, len);
      if (i % 10 === 0) g.fillText(String(i / 4), x, 56);
    }
  });
  {
    const A = new THREE.Vector2(RAMP.x0, 0), B = new THREE.Vector2(RAMP.x1, FLOOR);
    const len = A.distanceTo(B), ang = Math.atan2(B.y - A.y, B.x - A.x), T = 0.3;
    const n = new THREE.Vector2(-Math.sin(ang), Math.cos(ang));
    const mid = A.clone().add(B).multiplyScalar(0.5).addScaledVector(n, -T / 2);
    const ruler = add(new THREE.BoxGeometry(len, T, RAMP.z1 - RAMP.z0 + 0.3), [L(0xd9b45f), L(0xd9b45f), L(0xffffff, { map: rulerTex }), L(0xc9a04f), L(0xd9b45f), L(0xd9b45f)], mid.x, mid.y, (RAMP.z0 + RAMP.z1) / 2);
    ruler.rotation.z = ang;
  }
  // ---------- the floor at the Speck's scale: crumpled paper, a wastebasket ----------
  const paperBall = add(new THREE.IcosahedronGeometry(1.5, 1), L(0xf4efe2, { flatShading: true }), 16.5, FLOOR + 1.2, -9.5);
  paperBall.scale.set(1, 0.85, 1.05); paperBall.rotation.set(0.4, 0.8, 0.2);
  colliders.push({ type: 'circle', x: 16.5, z: -9.5, r: 1.6 });
  const basket = new THREE.Group(); basket.position.set(33.5, FLOOR, -15); root.add(basket);
  add(new THREE.CylinderGeometry(3.3, 2.8, 7.5, 28, 1, true), L(0x8a9aae, { side: THREE.DoubleSide }), 0, 3.75, 0, basket);
  add(new THREE.TorusGeometry(3.3, 0.14, 8, 32), L(0x6a7a8e), 0, 7.5, 0, basket).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(2.8, 2.8, 0.1, 28), L(0x6a7a8e), 0, 0.05, 0, basket);
  for (const [dx, dz] of [[-0.8, 0.4], [0.9, -0.6], [0.1, 0.9]]) add(new THREE.IcosahedronGeometry(1.1, 1), L(0xf4efe2, { flatShading: true }), dx, 7.2, dz, basket);
  colliders.push({ type: 'circle', x: 33.5, z: -15, r: 3.5 });
  // ---------- the little door in the baseboard, with the map pinned beside it ----------
  const DOOR = { x: 22, z: -22.9 };
  const door = buildLittleDoor();
  door.position.set(DOOR.x, FLOOR, DOOR.z); root.add(door);
  const mapTex = K.mkTex(256, 192, (g, w, h) => { g.fillStyle = '#f6e7c3'; g.fillRect(0, 0, w, h); g.fillStyle = '#7bcd5d'; g.beginPath(); g.ellipse(70, 80, 40, 28, 0, 0, 7); g.fill(); g.fillStyle = '#22cfd8'; g.beginPath(); g.ellipse(170, 60, 36, 24, 0, 0, 7); g.fill(); g.fillStyle = '#f3cf88'; g.beginPath(); g.ellipse(150, 140, 50, 26, 0, 0, 7); g.fill(); g.fillStyle = '#e8566a'; for (const [x, y] of [[70, 80], [170, 60], [150, 140]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); } g.strokeStyle = '#8a5a36'; g.setLineDash([6, 6]); g.lineWidth = 3; g.beginPath(); g.moveTo(70, 80); g.lineTo(170, 60); g.lineTo(150, 140); g.stroke(); });
  const pinned = add(new THREE.PlaneGeometry(2.6, 1.95), L(0xffffff, { map: mapTex }), DOOR.x + 3.6, FLOOR + 3.6, -23.92);
  pinned.rotation.z = -0.05;
  add(new THREE.SphereGeometry(0.12, 10, 8), L(0xe8566a), DOOR.x + 3.6, FLOOR + 4.45, -23.85);
  // pedestals for the artefacts he keeps
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
    zones: [
      { x0: -9.9, x1: 9.9, z0: -3.3, z1: 4.8, y: 0 },                        // the desk top
      { x0: 9.9, x1: RAMP.x0, z0: RAMP.z0, z1: RAMP.z1, y: 0 },              // the desk edge at the ruler
      { ramp: true, axis: 'x', ...RAMP, y0: 0, y1: FLOOR },                   // the ruler
      { x0: 11.5, x1: 37, z0: -22.3, z1: 9, y: FLOOR },                      // the floor, right of the desk
    ],
    colliders,
    update(dt) { door.userData.update(dt); },
  };

  // Jean-Lafontaine de Becancourt: a normal-sized man standing behind his desk
  const buildScientist = await loadScientist();
  const scientist = buildScientist ? buildScientist() : scientistStandIn();
  scientist.scale.setScalar(S);
  scientist.position.set(0, FLOOR, -10.5);
  root.add(scientist);
  let scientistTalking = false;
  const setExpr = (e) => scientist.userData.setExpression?.(e);
  setExpr('grumpy');

  const player = await createPlayer(save.character);
  // back from a small world: step out of the little door
  const fromLatent = String(save.lastScene || '').startsWith('region:');
  if (fromLatent) player.place(DOOR.x, FLOOR, -21.3); else player.place(0, 0, 2.6);

  const ws = createWalkScene({
    engine: ctx.engine, world, player,
    light: { sky: 0xfff4e0, ground: 0x9a7a5a, hi: 1.45, sun: 0xffe8cc, si: 1.7, dir: [16, 24, 14] },
    background: 0xe9dcc0,
    camera: {
      fov: 48,
      // on the desk: a fixed view with him behind it; going down the ruler blends into a follow camera
      place(camera, c) {
        const dx = Math.max(-4, Math.min(4, c.x * 0.4));
        const t = Math.max(0, Math.min(1, Math.max((-c.y - 0.1) / 5, (c.x - 8.5) / 6))); const k = t * t * (3 - 2 * t); // follow sooner past the desk edge
        camera.position.set(dx + (c.x - 1.5 - dx) * k, 6.4 + (c.y + 6.8 - 6.4) * k, 18.5 + (c.z + 15.5 - 18.5) * k);
        camera.lookAt(dx + (c.x + 0.5 - dx) * k, 4.6 + (c.y + 1.3 - 4.6) * k, -6 + (c.z - 4 + 6) * k);
      },
    },
    actions: {
      book: () => openTaskBook(),
      map: () => openMap(),
      menu: () => ctx.pauseMenu(),
      tick: (dt) => { scientist.userData.animate?.(dt, { talking: scientistTalking }); },
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

  async function scientistSays(lines, expr = 'grumpy') {
    setExpr('talking'); scientistTalking = true;
    try { await say(lines, { speaker: SCIENTIST, style: 'scientist' }); } finally { scientistTalking = false; setExpr(expr); }
  }

  const regions = {};
  async function region(id) { if (!regions[id]) regions[id] = await api.region(id).catch(() => null); return regions[id]; }

  function nextTask() { return REGION_ORDER.find((id) => !regionState(id).returned) || null; }
  const allReturned = () => REGION_ORDER.every((id) => regionState(id).returned);
  async function finale() {
    await scientistSays(FINALE, 'surprised');
    updateSave((x) => { x.currentTask = null; x.endingSeen = true; });
    ctx.goto('ending');
  }

  async function assign(id) {
    const rg = await region(id);
    updateSave((s) => { s.currentTask = id; });
    if (rg) await scientistSays(rg.scientist?.briefing || [`Go to ${rg.region.name}. Bring me something worth my time.`]);
    else await scientistSays(['Hmm. That map is missing. Somebody ate it.']);
    refreshHud();
    pulseHud('map');
    toast('🚪 Down the ruler, through the little door', 3600);
  }

  async function talkToScientist() {
    const s = getSave();
    if (!s.introSeen) {
      await scientistSays(INTRO);
      updateSave((x) => { x.introSeen = true; });
      await assign(nextTask());
      return;
    }
    // all three delivered but the finale never finished (closed or reloaded mid-speech): play it now
    if (allReturned() && !s.endingSeen) { await finale(); return; }
    // deliver any artefact not yet returned, in order: it goes on its bottle cap first, then he talks
    for (const id of REGION_ORDER) {
      const rs = regionState(id);
      if (rs.artefact && !rs.returned) {
        const rg = await region(id);
        await say([`You hand over ${theName(rg?.artefact?.name)}.`], { style: 'narration' });
        updateSave(() => { regionState(id).returned = true; });
        refreshShelf(); refreshHud();
        confetti(120);
        setExpr('surprised');
        await scientistSays(rg?.scientist?.return || ['...Hm. Hmph. Fine.'], 'surprised');
        const nx = nextTask();
        if (nx) { setExpr('grumpy'); await assign(nx); }
        else await finale();
        return;
      }
    }
    const cur = (s.currentTask && !regionState(s.currentTask).returned ? s.currentTask : null) || nextTask();
    if (!cur) { await scientistSays(['You again. Go be competent elsewhere.']); return; }
    const rg = await region(cur);
    await scientistSays(rg?.scientist?.reminder || ['The little door, Speck. Down the ruler. GO.']);
  }

  // M: look at the map (travel happens at the little door)
  async function openMap() {
    const s = getSave();
    if (!s.introSeen) { toast('Talk to Becancourt first', 2200); return; }
    const { openMapOverlay } = await import('./map.js');
    await openMapOverlay(ctx, { travel: false });
  }

  // the little door: pick a world on the pinned map, the door swings open, in you go
  async function travel() {
    const s = getSave();
    if (!s.introSeen) { toast('Talk to Becancourt first', 2200); return; }
    const { openMapOverlay } = await import('./map.js');
    const choice = await openMapOverlay(ctx, { travel: true });
    if (!choice) return;
    door.userData.setOpen(true);
    await glide(DOOR.x, -22.2, 600);
    await glide(DOOR.x, -23.6, 500);
    ctx.goto('region', choice);
  }
  // move the Speck along a short scripted path (input is frozen while ws.run is busy)
  function glide(x, z, ms) {
    const x0 = player.pos.x, z0 = player.pos.z, t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        player.place(x0 + (x - x0) * u, FLOOR, z0 + (z - z0) * u);
        if (u < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
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
    let task = s.introSeen ? '' : 'Talk to Becancourt';
    if (allReturned() && !s.endingSeen) task = 'Talk to Becancourt';
    else if (cur && !regionState(cur).returned) {
      const rg = await region(cur);
      const rs = regionState(cur);
      task = rs.artefact && !rs.returned ? `Give Becancourt ${theName(rg?.artefact?.name)}` : (rg?.scientist?.taskTitle || '');
    }
    setHud({ place: 'Lab', task, artefacts: deliveredArtefacts(), mapLabel: 'Map' });
  }

  ws.addInteractable({ label: 'Becancourt', icon: '💬', pos: { x: 0, y: 0, z: -2.8 }, radius: 4.0, promptHeight: 2.6, onInteract: talkToScientist });
  ws.addInteractable({ label: 'Little door', icon: '🚪', pos: { x: DOOR.x, y: FLOOR, z: -21.6 }, radius: 2.6, promptHeight: 3.6, onInteract: travel });
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
    async onEnter() { await refreshHud(); ws.snapCamera(); if (fromLatent) door.userData.openNow(true); },
    async start() {
      const s = getSave();
      if (fromLatent) setTimeout(() => door.userData.setOpen(false), 450);
      if (!s.introSeen) {
        await ws.run(() => say(['You wake up on a desk. Everything is enormous. Including him.'], { style: 'narration' }));
        await ws.run(talkToScientist);
      }
    },
  };
}
