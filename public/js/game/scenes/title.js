// Title screen: a composed paper diorama (villagers lined up on the path, a giant
// Grumm looming behind the hills, paper sheets and confetti drifting) plus a
// cut-paper logo and chunky paper buttons.
import * as THREE from 'three';
import { buildDiorama, ANCHORS } from '../../engine/diorama.js';
import { buildVillager } from '../../engine/villagers.js';
import { loadHumans } from '../player.js';
import { createRng } from '../../engine/geo.js';

const CAST = [
  { species: 'bunny', colors: { shirt: '#ff7ab8' }, x: -10.6 },
  { species: 'frog', colors: { shirt: '#ffd35a' }, x: -8.6 },
  { species: 'cat', colors: { shirt: '#8a6ad8' }, x: -6.4 },
  { species: 'duck', colors: { shirt: '#3ec7b5' }, x: -2.0 },
  { species: 'bear', colors: { shirt: '#4f86d8' }, x: 0.2 },
  { species: 'snake', colors: { shirt: '#ff9a45' }, x: 2.4 },
];

export async function createTitleScene() {
  const world = buildDiorama('meadow', { seed: 5, fences: false });
  const scene = new THREE.Scene();
  scene.add(world.root);
  scene.fog = new THREE.Fog(0xffe9d2, 48, 150);
  const B = world.biome;
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x8a9a6a, 1.55));
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 20, bottom: -14, near: 1, far: 100 });
  sun.position.set(-18, 24, 22); sun.target.position.set(-4, 0, -2);
  scene.add(sun, sun.target);

  const r = createRng(99);
  const updaters = [];

  // villagers in a row on the path, hopping in turn
  CAST.forEach((c, i) => {
    const v = buildVillager(c);
    v.position.set(c.x, 0, 1.7);
    v.rotation.y = (-4 - c.x) * 0.04;
    scene.add(v);
    const phase = i * 0.9;
    updaters.push((dt, t) => {
      v.userData.animate?.(dt, { talking: false });
      const k = (t * 0.55 + phase) % 5.4;
      v.position.y = k < 0.5 ? Math.sin((k / 0.5) * Math.PI) * 0.55 : 0;
    });
  });

  // the player in the middle (stand-in until the character module exists)
  const humans = await loadHumans();
  if (humans?.buildHuman) {
    const hero = humans.buildHuman(humans.DEFAULT_CHARACTER || {});
    hero.position.set(-4.2, 0, 2.3); scene.add(hero);
    updaters.push((dt) => hero.userData.animate?.(dt, { moving: false, speed: 0, facing: 1 }));
  }

  // Grumm, enormous, peeking over the far hills like a cardboard backdrop
  let grumm;
  if (humans?.buildScientist) {
    grumm = humans.buildScientist();
    grumm.userData.setExpression?.('grumpy');
    grumm.scale.setScalar(2.4);
    grumm.position.set(15, -6.5, -40);
    grumm.rotation.y = -0.35;
  } else {
    grumm = new THREE.Group();
    const m = (c) => new THREE.MeshLambertMaterial({ color: c });
    const head = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 24), m(0xf0c4a0)); head.position.y = 15; grumm.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(6.8, 28, 20), m(0xf4f4f4)); hair.position.set(0, 17.5, -1.5); hair.scale.set(1.25, 0.75, 1); grumm.add(hair);
    for (const sx of [-2, 2]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), m(0x1e1824)); e.position.set(sx, 15.6, 5.5); e.scale.y = 1.3; grumm.add(e);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.8, 1), m(0xeeeeee)); brow.position.set(sx, 17.6, 5.4); brow.rotation.z = sx > 0 ? 0.32 : -0.32; grumm.add(brow);
      const lens = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 8, 24), m(0x2b2233)); lens.position.set(sx, 15.6, 5.8); grumm.add(lens);
    }
    const stache = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 12), m(0xf4f4f4)); stache.position.set(0, 13.2, 5.4); stache.scale.set(1.5, 0.45, 0.6); grumm.add(stache);
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 10, 24), m(0xf8f8f4)); coat.position.y = 5; grumm.add(coat);
    grumm.position.set(15, -3, -42);
    grumm.rotation.y = -0.35;
  }
  scene.add(grumm);
  const gy = grumm.position.y;
  updaters.push((dt, t) => { grumm.position.y = gy + Math.sin(t * 0.6) * 0.35; grumm.userData.animate?.(dt, { talking: false }); });

  // bunting over the line-up
  const cols = [0xff7ab8, 0xffd35a, 0x3ec7b5, 0x8fd3ff, 0xb39cff, 0xff9a45];
  for (const [x0, x1] of [[-14, -4], [-4, 6]]) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x0, 4.6, 0.6), new THREE.Vector3((x0 + x1) / 2, 3.8, 0.6), new THREE.Vector3(x1, 4.6, 0.6)]);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.025, 4), new THREE.MeshLambertMaterial({ color: 0x6a4a2a })));
    for (let t = 0.04; t < 0.97; t += 0.075) {
      const p = curve.getPoint(t); const tri = new THREE.Shape(); tri.moveTo(-0.24, 0); tri.lineTo(0.24, 0); tri.lineTo(0, -0.55);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshLambertMaterial({ color: cols[Math.round(t * 13) % cols.length], side: THREE.DoubleSide }));
      m.position.copy(p); scene.add(m);
      const ph = r() * 6; updaters.push((dt, tt) => { m.rotation.x = Math.sin(tt * 2 + ph) * 0.25; });
    }
  }

  // drifting paper sheets (the papers of the Latent) and confetti
  const sheetTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 84; const g = c.getContext('2d');
    g.fillStyle = '#fffdf6'; g.fillRect(0, 0, 64, 84); g.fillStyle = '#c9c2d6';
    g.fillRect(8, 8, 40, 5);
    for (let y = 20; y < 76; y += 7) g.fillRect(8, y, 20 + ((y * 13) % 28), 3);
    g.strokeStyle = '#2b2233'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 81);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const sheetMat = new THREE.MeshLambertMaterial({ map: sheetTex, side: THREE.DoubleSide });
  const sheets = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.18), sheetMat);
    s.position.set(-30 + r() * 52, 6 + r() * 9, -6 - r() * 10);
    s.userData = { v: 0.6 + r() * 0.9, ph: r() * 6, spin: 0.6 + r() };
    scene.add(s); sheets.push(s);
  }
  updaters.push((dt, t) => sheets.forEach((s) => {
    s.position.x += dt * s.userData.v;
    s.position.y += Math.sin(t * 0.9 + s.userData.ph) * dt * 0.4;
    s.rotation.set(Math.sin(t * s.userData.spin + s.userData.ph) * 0.9, t * 0.4 + s.userData.ph, Math.sin(t * 0.7 + s.userData.ph) * 0.4);
    if (s.position.x > 26) s.position.x = -32;
  }));
  const conf = [];
  const confGeo = new THREE.PlaneGeometry(0.12, 0.2);
  for (let i = 0; i < 110; i++) {
    const m = new THREE.Mesh(confGeo, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
    m.position.set(-22 + r() * 36, r() * 12, -3 + r() * 9);
    m.userData = { v: 0.5 + r() * 0.8, ph: r() * 6 };
    scene.add(m); conf.push(m);
  }
  updaters.push((dt, t) => conf.forEach((m) => {
    m.position.y -= dt * m.userData.v; m.position.x += Math.sin(t + m.userData.ph) * dt * 0.4;
    m.rotation.x += dt * 3; m.rotation.y += dt * 2;
    if (m.position.y < -0.5) m.position.y = 12;
  }));

  scene.traverse((o) => { if (o.isMesh && !(o.material && o.material.isMeshBasicMaterial)) { o.castShadow = true; o.receiveShadow = true; } });

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 600);
  return {
    scene, camera,
    update(dt, t) {
      camera.position.set(-4 + Math.sin(t * 0.12) * 0.8, 3.6, 15.5);
      camera.lookAt(-4, 3.7, -2);
      world.update(dt, t);
      for (const u of updaters) u(dt, t);
    },
    dispose() { scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }); },
  };
}

// Cut-paper logo: every letter a separate paper piece (colour fill, white paper
// border, ink outline), popping in one by one, then bobbing.
const PALETTE = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#8fd3ff', '#b39cff', '#ff9a45', '#7bcd5d'];
const SVGNS = 'http://www.w3.org/2000/svg';

export function buildLogo() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'logo-svg');
  svg.setAttribute('viewBox', '0 0 1000 300');
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.appendChild(e); return e; };
  const line = (word, y, size, startIndex) => {
    // measure with a canvas so letters sit snugly side by side
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `700 ${size}px Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
    const widths = [...word].map((ch) => ctx.measureText(ch).width * 0.98);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = 500 - total / 2;
    [...word].forEach((ch, i) => {
      const idx = startIndex + i;
      const rot = ((idx * 37) % 11) - 5;
      const dy = ((idx * 23) % 7) - 3;
      const g = mk('g', { class: 'logo-letter', style: `--i:${idx}; --r:${rot}deg; transform-origin:${x + widths[i] / 2}px ${y - size * 0.35}px` }, svg);
      const base = { x: x + widths[i] / 2, y: y + dy, 'text-anchor': 'middle', 'font-size': size };
      mk('text', { ...base, class: 'logo-ink' }, g).textContent = ch;
      mk('text', { ...base, class: 'logo-paper' }, g).textContent = ch;
      mk('text', { ...base, class: 'logo-fill', fill: PALETTE[idx % PALETTE.length] }, g).textContent = ch;
      x += widths[i];
    });
  };
  line('Escape', 128, 132, 0);
  // "the" on a pink ribbon
  const rib = mk('g', { class: 'logo-ribbon', style: '--i:6' }, svg);
  mk('path', { d: 'M420 150 L580 150 L566 168 L580 186 L420 186 L434 168 Z', class: 'logo-ribbon-shape' }, rib);
  mk('text', { x: 500, y: 179, 'text-anchor': 'middle', class: 'logo-ribbon-text' }, rib).textContent = 'the';
  line('Latent', 292, 132, 7);
  // a little paper airplane looping around the logo
  const plane = mk('g', { class: 'logo-plane' }, svg);
  mk('path', { d: 'M0 0 L46 14 L0 28 L10 14 Z', class: 'logo-plane-shape' }, plane);
  mk('path', { d: 'M10 14 L46 14', class: 'logo-plane-fold' }, plane);
  return svg;
}
