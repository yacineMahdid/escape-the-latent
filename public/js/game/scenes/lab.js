// Professor Grumm's giant lab: the hub. Talk to Grumm, deliver artefacts, open the map.
import * as THREE from 'three';
import { createPlayer, loadHumans } from '../player.js';
import { createWalkScene } from '../walkscene.js';
import { buildArtefact } from '../artefacts.js';
import { getSave, updateSave, regionState } from '../save.js';
import { say, ask, toast } from '../dialogue.js';
import { confetti } from '../fx.js';
import { setHud } from '../hud.js';
import { api } from '../../api.js';
import { rbox, createRng } from '../../engine/geo.js';
import { createKit } from '../../engine/kit.js';

export const REGION_ORDER = ['attention', 'clip', 'mamba'];

const GRUMM = { name: 'Professor Grumm', color: '#6a5acd' };

const INTRO = [
  'Oh. It\'s awake. Splendid. Another tiny assistant.',
  'I am Professor Grumm. I collect knowledge. Mostly other people\'s, since mine is already complete.',
  'Out that door is the Latent: famous papers that folded themselves into little worlds. Don\'t ask me why. Ask a reviewer.',
  'You, Speck, will go in and bring knowledge back. REAL knowledge. Not vibes. Not a summary you found on a napkin.',
  'Take this book. It whispers. It has read every word of every paper, and it will help you exactly as much as it wants to. Which is: BARELY.',
];
const FINALE = [
  'Three. THREE. A speck carried three papers\' worth of understanding up my stairs.',
  'Do you know how many of my last assistants came back from even ONE? ...Neither do I. I stopped counting at "none".',
  'Fine. FINE. You may call yourself my assistant. Junior. Very junior. Microscopically junior.',
  'There is a new pile of papers on the desk tomorrow. Bigger ones. Go home, Speck.',
  '...Good work.',
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

  // floor planks
  const planks = K.mkTex(256, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { const v = 150 + r() * 30 | 0; g.fillStyle = `rgb(${v + 40},${v - 10},${v - 60})`; g.fillRect(0, i * 32, w, 32); g.fillStyle = 'rgba(60,30,10,.5)'; g.fillRect(0, i * 32, w, 2); g.fillRect((r() * w) | 0, i * 32, 2, 32); } });
  add(new THREE.PlaneGeometry(80, 40), L(0xffffff, { map: K.rep(planks, 6, 3) }), 0, 0, 2).rotation.x = -Math.PI / 2;
  // back wall + wallpaper
  const paper = K.mkTex(256, 256, (g, w, h) => { g.fillStyle = '#e9dcc0'; g.fillRect(0, 0, w, h); g.fillStyle = '#dccba8'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 12, h); g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(r() * w, r() * h, 3, 0, 7); g.fill(); } });
  add(new THREE.PlaneGeometry(80, 40), L(0xffffff, { map: K.rep(paper, 8, 4) }), 0, 20, -12);
  add(new THREE.PlaneGeometry(40, 40), L(0xffffff, { map: K.rep(paper, 4, 4) }), -18, 20, 2).rotation.y = Math.PI / 2;
  add(new THREE.PlaneGeometry(40, 40), L(0xffffff, { map: K.rep(paper, 4, 4) }), 18, 20, 2).rotation.y = -Math.PI / 2;
  add(new THREE.BoxGeometry(80, 1.2, 0.6), L(0x8a5a36), 0, 0.6, -11.8);
  // chalkboard with scribbles from the three papers
  const chalk = K.mkTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#2f4a3c'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(r() * w, r() * h); g.lineTo(r() * w, r() * h); g.stroke(); }
    g.fillStyle = 'rgba(245,245,235,.9)'; g.font = 'italic 44px Georgia';
    g.fillText('Attention(Q,K,V) = softmax(QKᵀ/√dₖ) V', 60, 100);
    g.fillText('L = ½ [CE(logits) + CE(logitsᵀ)]', 120, 210);
    g.fillText('hₜ = Āhₜ₋₁ + B̄xₜ ,  yₜ = Chₜ', 80, 320);
    g.font = 'bold 40px Georgia'; g.fillText('?!', 860, 420); g.font = '32px Georgia'; g.fillText('(do NOT erase  — G.)', 520, 460);
    g.strokeStyle = 'rgba(245,245,235,.8)'; g.lineWidth = 4; g.beginPath(); g.arc(780, 160, 60, 0, 6.28); g.stroke();
  }, 4);
  add(rbox(22, 9, 0.5, 0.3), L(0x8a5a36), 0, 14.5, -11.6);
  add(new THREE.PlaneGeometry(21, 8), L(0xffffff, { map: chalk }), 0, 14.5, -11.3);
  // window
  add(rbox(8, 9, 0.4, 0.2), L(0xfff6e6), 13, 16, -11.7);
  add(new THREE.PlaneGeometry(7, 8), new THREE.MeshBasicMaterial({ color: 0x8fd3ff }), 13, 16, -11.45);
  add(new THREE.BoxGeometry(0.3, 8, 0.2), L(0xfff6e6), 13, 16, -11.3); add(new THREE.BoxGeometry(7, 0.3, 0.2), L(0xfff6e6), 13, 16, -11.3);
  // giant desk
  const wood = L(0xffffff, { map: K.wood });
  add(rbox(24, 0.9, 6.4, 0.2), wood, 0, 5.4, -7.6);
  for (const x of [-11, 11]) for (const z of [-10.2, -5.0]) add(rbox(1.0, 5.0, 1.0, 0.15), wood, x, 2.5, z);
  // desk clutter
  const books = [0xe8566a, 0x4f86d8, 0xffd35a, 0x3ec7b5, 0xb39cff];
  for (let i = 0; i < 5; i++) { const b = add(rbox(4.2 - i * 0.2, 0.7, 3, 0.08), L(books[i]), -8 + (i % 2) * 0.3, 6.2 + i * 0.72, -8.4); b.rotation.y = (r() - 0.5) * 0.3; }
  const mug = add(new THREE.CylinderGeometry(1.0, 0.9, 2.2, 24), L(0xfff6e6), 8.5, 7.0, -7.2); add(new THREE.TorusGeometry(0.6, 0.18, 8, 16), L(0xfff6e6), 9.5, 7.1, -7.2).rotation.y = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.88, 0.88, 0.05, 24), L(0x5a3a1a), 8.5, 8.05, -7.2);
  for (let i = 0; i < 6; i++) { const p = add(new THREE.BoxGeometry(2.6, 0.04, 3.4), L(0xfffdf6), -1 + r() * 4, 5.88 + i * 0.05, -6.6 + r()); p.rotation.y = (r() - 0.5) * 0.8; }
  // shelf with pedestals for delivered artefacts (left), the door to the Latent (right)
  add(rbox(10, 0.5, 2.4, 0.1), wood, -12, 0.25, -3.2);
  const door = new THREE.Group(); door.position.set(13.2, 0, -10.9); root.add(door);
  add(rbox(6.4, 11.5, 0.6, 0.3), L(0x9a6236), 0, 5.75, 0, door);
  add(rbox(5.2, 10.3, 0.3, 0.3), L(0xb07a48), 0, 5.4, 0.3, door);
  add(new THREE.SphereGeometry(0.4, 12, 10), L(0xf0c040), -1.9, 5.2, 0.6, door);
  const mapTex = K.mkTex(256, 192, (g, w, h) => { g.fillStyle = '#f6e7c3'; g.fillRect(0, 0, w, h); g.fillStyle = '#7bcd5d'; g.beginPath(); g.ellipse(70, 80, 40, 28, 0, 0, 7); g.fill(); g.fillStyle = '#22cfd8'; g.beginPath(); g.ellipse(170, 60, 36, 24, 0, 0, 7); g.fill(); g.fillStyle = '#f3cf88'; g.beginPath(); g.ellipse(150, 140, 50, 26, 0, 0, 7); g.fill(); g.fillStyle = '#e8566a'; for (const [x, y] of [[70, 80], [170, 60], [150, 140]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); } g.strokeStyle = '#8a5a36'; g.setLineDash([6, 6]); g.lineWidth = 3; g.beginPath(); g.moveTo(70, 80); g.lineTo(170, 60); g.lineTo(150, 140); g.stroke(); });
  add(new THREE.PlaneGeometry(3.6, 2.7), L(0xffffff, { map: mapTex }), 0, 6.6, 0.47, door).rotation.z = 0.05;
  add(rbox(4.6, 0.12, 2.4, 0.05), L(0xe8566a), 13.2, 0.06, -8.6);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const world = {
    root,
    zones: [{ x0: -15, x1: 15, z0: -4.1, z1: 6, y: 0 }],
    colliders: [{ type: 'rect', x0: -17.5, x1: -6.9, z0: -4.6, z1: -2.0 }, { type: 'circle', x: -11, z: -5, r: 0.8 }, { type: 'circle', x: 11, z: -5, r: 0.8 }],
    update() {},
  };

  // Grumm
  const humans = await loadHumans();
  const grumm = humans && humans.buildScientist ? humans.buildScientist() : scientistStandIn();
  grumm.position.set(0, 0, -10.2);
  root.add(grumm);
  let grummTalking = false;
  const setExpr = (e) => grumm.userData.setExpression?.(e);
  setExpr('grumpy');

  const player = await createPlayer(save.character);
  player.place(0, 0, 3.2);

  const ws = createWalkScene({
    engine: ctx.engine, world, player,
    light: { sky: 0xfff4e0, ground: 0x9a7a5a, hi: 1.5, sun: 0xffe8cc, si: 1.6, dir: [-10, 22, 16] },
    background: 0xe9dcc0,
    camera: {
      fov: 40,
      place(camera, c) { const x = Math.max(-6, Math.min(6, c.x * 0.45)); camera.position.set(x, 6.4, 21.5); camera.lookAt(x, 5.6, -4); },
    },
    actions: {
      book: () => openTaskBook(),
      map: () => openMap(),
      menu: () => ctx.pauseMenu(),
      tick: (dt) => { grumm.userData.animate?.(dt, { talking: grummTalking }); },
    },
  });
  ws.sun.shadow.camera.left = -30; ws.sun.shadow.camera.right = 30; ws.sun.shadow.camera.top = 26; ws.sun.shadow.camera.bottom = -14;

  // delivered artefacts on the shelf
  const shelfSlots = [[-15, -3.2], [-12, -3.2], [-9, -3.2]];
  function refreshShelf() {
    root.children.filter((o) => o.userData.isTrophy).forEach((o) => { root.remove(o); const i = ws.extras.indexOf(o); if (i >= 0) ws.extras.splice(i, 1); });
    REGION_ORDER.forEach((id, i) => {
      if (!regionState(id).returned) return;
      const a = buildArtefact(id); a.userData.isTrophy = true; a.position.set(shelfSlots[i][0], 0.5, shelfSlots[i][1]); a.scale.setScalar(0.9); root.add(a); ws.extras.push(a);
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
    else await grummSays(['Hmm. The map to that region is missing. Somebody ate it. Probably you.']);
    refreshHud();
    toast('The door on the right opens the map of the Latent.', 3800);
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
        await say([`You hand Grumm the ${rg?.artefact?.name || 'artefact'}.`], { style: 'narration' });
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
    if (!cur) { await grummSays(['You again. Shouldn\'t you be off being... competent?']); return; }
    const rg = await region(cur);
    await grummSays(rg?.scientist?.reminder || ['Why are you still here? The door, Speck. The DOOR.']);
  }

  async function openMap() {
    const s = getSave();
    if (!s.introSeen) { await say(['Maybe say hello to the enormous man first.'], { style: 'narration' }); return; }
    const { openMapOverlay } = await import('./map.js');
    const choice = await openMapOverlay(ctx);
    if (choice) ctx.goto('region', choice);
  }

  async function openTaskBook() {
    const s = getSave();
    const id = s.currentTask || REGION_ORDER.find((x) => regionState(x).arrived);
    if (!s.introSeen) { await say(['You don\'t have the book yet.'], { style: 'narration' }); return; }
    const rg = id ? await region(id) : null;
    if (!rg) { toast('The book is blank. Grumm has not sent you anywhere yet.'); return; }
    await ctx.openBook({ arxivId: rg.paper.arxivId, title: rg.paper.title }, id);
  }

  async function refreshHud() {
    const s = getSave();
    const cur = s.currentTask;
    let task = s.introSeen ? '' : 'Talk to the enormous man';
    if (cur) {
      const rg = await region(cur);
      const rs = regionState(cur);
      task = rs.artefact ? `Give Grumm the ${rg?.artefact?.name || 'artefact'}` : (rg?.scientist?.taskTitle || '');
    }
    setHud({ place: 'Professor Grumm\'s Lab', task, artefacts: s.artefacts, mapLabel: 'Map' });
  }

  ws.addInteractable({ label: 'Talk to Professor Grumm', pos: { x: 0, y: 0, z: -3.6 }, radius: 4.2, promptHeight: 3.2, onInteract: talkToGrumm });
  ws.addInteractable({ label: 'Open the map of the Latent', pos: { x: 12.2, y: 0, z: -3.4 }, radius: 3.4, promptHeight: 3.2, onInteract: openMap });
  ws.addInteractable({
    label: 'Look at the trophy shelf', pos: { x: -12, y: 0, z: -2.2 }, radius: 2.6, promptHeight: 2.4,
    onInteract: async () => {
      const done = REGION_ORDER.filter((id) => regionState(id).returned);
      if (!done.length) { await say(['An empty shelf. Grumm keeps it dusted. Hopefully.'], { style: 'narration' }); return; }
      const lines = [];
      for (const id of done) { const rg = await region(id); lines.push(`${rg?.artefact?.name}: ${rg?.artefact?.description || ''}`); }
      await say(lines, { style: 'narration' });
    },
  });

  return {
    scene: ws.scene, camera: ws.camera, update: ws.update, dispose: ws.dispose,
    async onEnter() { await refreshHud(); ws.snapCamera(); },
    async start() {
      const s = getSave();
      if (!s.introSeen) {
        await ws.run(() => say(['You wake up on a very large floor. Somebody very large is looking at you.'], { style: 'narration' }));
        await ws.run(talkToGrumm);
      } else if (REGION_ORDER.some((id) => regionState(id).artefact && !regionState(id).returned)) {
        toast('Grumm is waiting. Give him what you found.', 3500);
      }
    },
  };
}
