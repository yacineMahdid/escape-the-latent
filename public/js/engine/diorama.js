// The layered paper diorama: one fixed layout (front bank, main path split by a
// stream, back terrace, hilltop, right step, hedge with a gate) dressed by biome.
// Returns the world group plus walkable zones, colliders and named anchors.
import * as THREE from 'three';
import { buildLittleDoor } from './littledoor.js';
import { BIOMES } from './biomes.js';
import { createKit } from './kit.js';
import { createRng, rbox, V3 } from './geo.js';

// the little door stands at the far left of every small world (the player arrives in front of it)
export const DOOR_POS = { x: -33.4, z: -1.5 };

export const ANCHORS = {
  arrival: [-33, 0, 1.6],
  'lane-left': [-21, 0, 1.4],
  'lane-mid': [-6, 0, 1.4],
  bridge: [11.5, 0.7, 0.8],        // by the back railing: the Speck can still cross in front
  'lane-right': [16.4, 0, 1.2],
  'path-to-gate': [18.8, 0, -5.6],
  gate: [21, 0, -10.6],
  'terrace-1': [-24, 1.7, -4.7],
  'terrace-2': [-15.5, 1.7, -4.7],
  'terrace-3': [-3.5, 1.7, -4.6],
  hilltop: [-21, 3.4, -11.4],      // in the gap between terrace houses 1 and 2, so the camera sees it
  rightstep: [31.5, 0.9, -6.6],
  'bank-left': [15, -0.95, 7.8],
  'bank-right': [28, -0.95, 7.8],
};

export const WORLD_X = [-37, 43];

export function buildDiorama(biomeId, { seed = 11, fences = true } = {}) {
  const B = BIOMES[biomeId] || BIOMES.meadow;
  const r = createRng(seed);
  const K = createKit(r);
  const root = new THREE.Group();
  const updaters = [];
  const colliders = []; // { type:'circle', x, z, r } | { type:'rect', x0, x1, z0, z1 }
  const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
  const add = (geo, mat, x = 0, y = 0, z = 0, par = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
  const grp = (x, y, z, s = 1, ry = 0, par = root) => { const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); g.rotation.y = ry; par.add(g); return g; };
  const circle = (x, z, rr) => colliders.push({ type: 'circle', x, z, r: rr });
  const rect = (x0, x1, z0, z1) => colliders.push({ type: 'rect', x0, x1, z0, z1 });
  const BIOME = biomeId;

  const T = {
    wood: K.wood,
    ground: K.groundTex(B.ground),
    cliff: K.cliffTex(B.cliff),
    path: K.pathTex(B.path),
    water: K.waterTex(B.water),
    fall: K.fallTex(B.fall),
  };
  T.bank = B.bank ? K.groundTex(B.bank) : T.ground;
  const woodM = () => L(B.wood, { map: T.wood });

  // ---------------- terrain: stacked paper slabs ----------------
  const frills = [], icicles = [];
  const dummy = new THREE.Object3D();
  function slab(x0, x1, z0, z1, y, bottom, opt = {}) {
    const w = x1 - x0, d = z1 - z0, dep = y - bottom;
    const sx = L(0xffffff, { map: K.rep(T.cliff, d / 3, 1) }), sz = L(0xffffff, { map: K.rep(T.cliff, w / 3, 1) });
    const top = L(0xffffff, { map: K.rep(opt.top || T.ground, w / (opt.ts || 5), d / (opt.ts || 5)) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, dep, d), [sx, sx, top, L(0x4a3a2a), sz, sz]);
    m.position.set((x0 + x1) / 2, y - dep / 2, (z0 + z1) / 2); root.add(m);
    if (opt.frill !== false) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.16, d + 0.16), L(B.lip));
      lip.position.set((x0 + x1) / 2, y - 0.07, (z0 + z1) / 2); root.add(lip);
      const edge = (px, pz, ry) => { if (B.frill !== null) frills.push([px, y, pz, ry]); if (B.icicles && r() < 0.35) icicles.push([px + (r() - 0.5) * 0.2, y - 0.12, pz]); };
      for (let x = x0 + 0.15; x < x1; x += 0.4) edge(x, z1 + 0.09, 0);
      if (opt.left !== false) for (let z = z0 + 0.15; z < z1; z += 0.4) edge(x0 - 0.09, z, -Math.PI / 2);
      if (opt.right !== false) for (let z = z0 + 0.15; z < z1; z += 0.4) edge(x1 + 0.09, z, Math.PI / 2);
    }
    return m;
  }
  function steps(x, za, zb, ya, yb, w = 2.6, n = 5) {
    const lo = Math.min(ya, yb) - 0.6;
    for (let i = 0; i < n; i++) {
      const z0 = za + (zb - za) * i / n, z1 = za + (zb - za) * (i + 1) / n, top = ya + (yb - ya) * (i + 1) / n;
      slab(x - w / 2, x + w / 2, Math.min(z0, z1), Math.max(z0, z1), top, lo, { top: T.path, ts: 2, frill: false });
    }
  }
  slab(-60, 70, 6.8, 16, -0.95, -4, { left: false, right: false, frill: false, top: T.bank });
  const riverTex = K.rep(T.water, 26, 1);
  const river = add(new THREE.PlaneGeometry(130, 3.6), L(0xffffff, { map: riverTex }), 5, -1.2, 5.1); river.rotation.x = -Math.PI / 2;
  slab(-60, 9.4, -13, 3.4, 0, -2.6, { left: false });
  slab(13.6, 70, -13, 3.4, 0, -2.6, { right: false });
  const streamTex = K.rep(T.water, 12, 1); streamTex.center.set(0.5, 0.5); streamTex.rotation = Math.PI / 2;
  { const st = add(new THREE.PlaneGeometry(4.2, 60), L(0xffffff, { map: streamTex }), 11.5, -0.35, -26.6); st.rotation.x = -Math.PI / 2;
    for (const sx of [9.45, 13.55]) add(new THREE.BoxGeometry(0.3, 0.5, 60), L(B.lip), sx, -0.2, -26.6);
    add(new THREE.PlaneGeometry(4.2, 0.85), L(0xffffff, { map: K.rep(T.fall, 2, 0.6) }), 11.5, -0.78, 3.42);
    for (let i = 0; i < 9; i++) { const f = add(new THREE.SphereGeometry(0.35 + r() * 0.25, 10, 8), L(B.foam), 9.8 + i * 0.42, -1.17, 3.7 + r() * 0.3); f.scale.y = 0.45; } }
  updaters.push((dt) => { riverTex.offset.x += dt * 0.04; streamTex.offset.y -= dt * 0.12; });
  slab(-60, 6, -12, -3.2, 1.7, -0.6, { right: true });
  slab(-60, -15, -20, -9.6, 3.4, -0.6, { right: true });
  slab(27, 70, -12, -4.6, 0.9, -0.6, { right: false });
  steps(-9.5, -0.4, -3.2, 0, 1.7);
  steps(-18.5, -6.8, -9.6, 1.7, 3.4, 2.2, 5);
  steps(28.8, -3.0, -4.6, 0, 0.9, 2.2, 3);
  function strip(x0, x1, z0, z1, y) { const p = add(new THREE.PlaneGeometry(x1 - x0, z1 - z0), L(0xffffff, { map: K.rep(T.path, (x1 - x0) / 3, (z1 - z0) / 3) }), (x0 + x1) / 2, y + 0.012, (z0 + z1) / 2); p.rotation.x = -Math.PI / 2; return p; }
  strip(-60, 9.4, 0.7, 2.5, 0); strip(13.6, 70, 0.7, 2.5, 0); strip(-60, 6, -5.5, -4.1, 1.7); strip(-60, -15, -11.6, -10.2, 3.4);
  { const curve = new THREE.CatmullRomCurve3([V3(17, 0, 1.6), V3(18.5, 0, -2), V3(16.5, 0, -5.5), V3(19.5, 0, -9), V3(21, 0, -12.5)]);
    const pm = L(0xffffff, { map: K.rep(T.path, 1, 1) });
    for (let t = 0; t <= 1; t += 0.02) { const p = curve.getPoint(t); const d = add(new THREE.CircleGeometry(1.05, 16), pm, p.x, 0.014 + t * 0.002, p.z); d.rotation.x = -Math.PI / 2; } }
  // bridge + pier steps down to the front bank
  { const b = grp(11.5, 0, 1.6); const wm = woodM();
    for (let i = -7; i <= 7; i++) { const x = i * 0.36; const y = 0.08 + 0.55 * Math.cos(i / 7 * Math.PI / 2); add(rbox(0.33, 0.14, 2.5, 0.05), wm, x, y, 0, b); }
    for (const zz of [-1.2, 1.2]) {
      for (const i of [-7, -3, 3, 7]) { const x = i * 0.36, y = 0.08 + 0.55 * Math.cos(i / 7 * Math.PI / 2); add(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), wm, x, y + 0.4, zz, b); }
      const rail = new THREE.CatmullRomCurve3([-7, -3.5, 0, 3.5, 7].map((i) => V3(i * 0.36, 0.08 + 0.55 * Math.cos(i / 7 * Math.PI / 2) + 0.8, zz)));
      add(new THREE.TubeGeometry(rail, 24, 0.06, 6), wm, 0, 0, 0, b);
    }
    const n = 6;
    for (let i = 0; i < n; i++) { const z = 3.5 + i * 0.6 + 0.3, y = -(i + 1) * (0.95 / n); add(rbox(2.2, 0.14, 0.56, 0.05), wm, 22, y, z); for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.08, 0.08, y + 1.5, 6), wm, 22 + sx, (y - 1.5) / 2, z); }
    for (const sx of [-1, 1]) { const rail = new THREE.CatmullRomCurve3([V3(22 + sx, 0.75, 3.4), V3(22 + sx, -0.2, 6.9)]); add(new THREE.TubeGeometry(rail, 4, 0.06, 6), wm, 0, 0, 0); } }
  if (frills.length) {
    const im = new THREE.InstancedMesh(new THREE.CircleGeometry(0.24, 10, Math.PI, Math.PI), L(B.frill, { side: THREE.DoubleSide }), frills.length);
    frills.forEach((f, i) => { dummy.position.set(f[0], f[1] - 0.02, f[2]); dummy.rotation.order = 'YXZ'; dummy.rotation.set(-0.35, f[3], 0); dummy.scale.set(1, 1 + r() * 0.5, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    root.add(im);
  }
  if (icicles.length) {
    const ig = new THREE.ConeGeometry(0.07, 0.5, 6); ig.rotateX(Math.PI);
    const im = new THREE.InstancedMesh(ig, L(0xd8f2ff, { emissive: 0x9fd8f5, emissiveIntensity: 0.25 }), icicles.length);
    icicles.forEach((f, i) => { dummy.rotation.set(0, 0, 0); const s = 0.6 + r() * 0.9; dummy.scale.set(1, s, 1); dummy.position.set(f[0], f[1] - 0.25 * s, f[2]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    root.add(im);
  }

  // ---------------- walkable zones ----------------
  // flat: {x0,x1,z0,z1,y}; ramp along z: {x0,x1,z0,z1,y0 (at z0),y1 (at z1)}; arch along x (bridge)
  const zones = [
    { x0: -37, x1: 9.5, z0: -3.15, z1: 3.3, y: 0 },
    { x0: 13.5, x1: 43, z0: -12.1, z1: 3.3, y: 0 },
    { x0: -37, x1: 5.9, z0: -11.9, z1: -3.25, y: 1.7 },
    { x0: -37, x1: -15.1, z0: -19.5, z1: -9.7, y: 3.4 },
    { x0: 27.1, x1: 43, z0: -11.9, z1: -4.7, y: 0.9 },
    { x0: -37, x1: 43, z0: 6.9, z1: 9.0, y: -0.95 },
    { ramp: true, x0: -10.75, x1: -8.25, z0: -3.25, z1: -0.4, y0: 1.7, y1: 0 },
    { ramp: true, x0: -19.55, x1: -17.45, z0: -9.7, z1: -6.8, y0: 3.4, y1: 1.7 },
    { ramp: true, x0: 27.75, x1: 29.85, z0: -4.7, z1: -3.0, y0: 0.9, y1: 0 },
    { ramp: true, x0: 21.0, x1: 23.0, z0: 3.25, z1: 7.0, y0: 0, y1: -0.95 },
    { arch: true, x0: 9.0, x1: 14.0, z0: 0.45, z1: 2.75, cx: 11.5, half: 2.52, base: 0.15, rise: 0.55 },
  ];

  // ---------------- houses ----------------
  function windowGlow(g, x, y, z, ei) { add(new THREE.BoxGeometry(0.5, 0.5, 0.05), new THREE.MeshLambertMaterial({ color: 0xffe9a0, emissive: 0xffc850, emissiveIntensity: ei }), x, y, z, g); }
  function cottage(h, x, y, z, ry, s) {
    const g = grp(x, y, z, s, ry); const wT = K.wallTex(h[1], h[2], h[3]);
    add(rbox(3, 2.4, 2.6, 0.16), L(0xffffff, { map: K.rep(wT, 0.6, 0.6) }), 0, 1.2, 0, g);
    const rs = new THREE.Shape(); rs.moveTo(-1.95, 0); rs.lineTo(0, 1.7); rs.lineTo(1.95, 0); rs.lineTo(-1.95, 0);
    const roofG = new THREE.ExtrudeGeometry(rs, { depth: 3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3 }); roofG.translate(0, 0, -1.5);
    const roofT = h[4] === 'snow' ? K.snowRoofTex() : K.roofTex(h[4], h[5]);
    add(roofG, L(0xffffff, { map: K.rep(roofT, 0.5, 0.5) }), 0, 2.35, 0, g);
    add(rbox(0.9, 1.35, 0.25, 0.12), L(h[6]), 0, 0.72, 1.33, g); add(new THREE.SphereGeometry(0.06, 8, 6), L(0xf0c040), 0.28, 0.75, 1.48, g);
    for (const wx of [-0.95, 0.95]) { add(rbox(0.66, 0.66, 0.18, 0.08), L(0xfff6e6), wx, 1.5, 1.32, g); windowGlow(g, wx, 1.5, 1.42, BIOME === 'dusk' || BIOME === 'snow' ? 0.9 : 0.35); add(new THREE.BoxGeometry(0.05, 0.5, 0.06), L(0xfff6e6), wx, 1.5, 1.45, g); }
    add(rbox(0.5, 1, 0.5, 0.08), L(0xb06a4a), 0.95, 3.25, -0.4, g);
    return g;
  }
  function cabin(h, x, y, z, ry, s) {
    const g = cottage(h, x, y, z, ry, s);
    const smoke = [];
    for (let i = 0; i < 3; i++) smoke.push(add(new THREE.SphereGeometry(0.25 + i * 0.12, 12, 10), L(0xffffff, { transparent: true, opacity: 0.85 }), 0.95 + i * 0.25, 3.95 + i * 0.55, -0.4, g));
    updaters.push((dt, t) => smoke.forEach((p, i) => { p.position.y = 3.95 + i * 0.55 + Math.sin(t * 1.2 + i) * 0.08; p.position.x = 0.95 + i * 0.25 + Math.sin(t * 0.7 + i * 2) * 0.06; }));
    for (let k = 0; k < 14; k++) { const c = add(new THREE.ConeGeometry(0.06, 0.3 + r() * 0.35, 6), L(0xd8f2ff), -1.8 + k * 0.28, 2.15, 1.6, g); c.rotation.x = Math.PI; }
    add(rbox(1.2, 0.25, 0.45, 0.1), L(0xffffff), 0, 1.95, 1.45, g);
    return g;
  }
  function igloo(x, y, z, ry, s) {
    const g = grp(x, y, z, s, ry);
    const t = K.mkTex(256, 128, (gg, w, h) => { gg.fillStyle = '#f6fbff'; gg.fillRect(0, 0, w, h); gg.fillStyle = '#bcd2ea'; for (let yy = 0; yy < h; yy += 21) { gg.fillRect(0, yy, w, 3); for (let xx = ((yy / 21) & 1) * 20; xx < w; xx += 40) gg.fillRect(xx, yy, 3, 21); } }, 6);
    add(new THREE.SphereGeometry(1.8, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), L(0xffffff, { map: K.rep(t, 3, 2) }), 0, 0, 0, g);
    const tun = add(new THREE.CylinderGeometry(0.85, 0.85, 1.4, 20, 1, false, 0, Math.PI), L(0xffffff, { map: K.rep(t, 1, 1) }), 0, 0, 1.6, g);
    tun.rotation.set(Math.PI / 2, 0, Math.PI / 2); tun.rotation.order = 'ZXY';
    add(new THREE.CircleGeometry(0.62, 20, 0, Math.PI), L(0x3a4a6a), 0, 0, 2.31, g);
    return g;
  }
  function adobe(h, x, y, z, ry, s) {
    const g = grp(x, y, z, s, ry); const wT = K.wallTex(h[1], h[2], 'adobe'); const wm = L(0xffffff, { map: K.rep(wT, 0.6, 0.6) });
    add(rbox(3.1, 2.5, 2.7, 0.3), wm, 0, 1.25, 0, g);
    if (h[4] === 'dome') { add(new THREE.SphereGeometry(1.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), L(0xffffff, { map: K.rep(K.wallTex('#f9f2e4', '#e3d4b8', 'adobe'), 0.8, 0.8) }), 0, 2.45, 0, g); add(new THREE.SphereGeometry(0.16, 10, 8), L(0xf0c040), 0, 3.65, 0, g); }
    else { add(rbox(3.3, 0.3, 2.9, 0.12), wm, 0, 2.6, 0, g); for (const sx of [-1.3, -0.4, 0.5, 1.3]) add(rbox(0.35, 0.3, 0.35, 0.08), wm, sx, 2.85, 1.2, g); }
    for (const sx of [-1.2, -0.6, 0, 0.6, 1.2]) add(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6), L(0x8a5a36), sx, 2.25, 1.45, g).rotation.x = Math.PI / 2;
    add(rbox(0.95, 1.5, 0.22, 0.08), L(h[3]), 0, 0.75, 1.33, g); add(new THREE.CircleGeometry(0.475, 18, 0, Math.PI), L(h[3]), 0, 1.5, 1.45, g);
    const aw = add(new THREE.BoxGeometry(1.7, 0.08, 0.8), L(0xffffff, { map: K.stripeTex('#f4f4f4', '#e8566a', 8) }), 0, 1.75, 1.65, g); aw.rotation.x = 0.35;
    for (const sx of [-1.05, 1.05]) { add(new THREE.CircleGeometry(0.3, 18), L(0x5a4a3a), sx, 1.55, 1.36, g); add(new THREE.TorusGeometry(0.3, 0.05, 6, 18), L(0xf6e6c8), sx, 1.55, 1.37, g); }
    for (const [px, ps] of [[-1.7, 0.42], [1.75, 0.32], [1.4, 0.26]]) { const pot = add(new THREE.SphereGeometry(ps, 14, 10), L(0xc8703e), px, ps, 1.4, g); pot.scale.y = 1.15; add(new THREE.CylinderGeometry(ps * 0.45, ps * 0.55, ps * 0.35, 12), L(0xb05e30), px, ps * 2.15, 1.4, g); }
    return g;
  }
  function crooked(h, x, y, z, ry, s) {
    const g = grp(x, y, z, s, ry); const inner = new THREE.Group(); g.add(inner); inner.rotation.z = (r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.04);
    const wT = K.wallTex(h[1], h[2], h[3]); add(rbox(2.9, 2.6, 2.5, 0.12), L(0xffffff, { map: K.rep(wT, 0.6, 0.6) }), 0, 1.3, 0, inner);
    const rs = new THREE.Shape(); rs.moveTo(-1.9, 0); rs.lineTo(0.25, 2.5); rs.lineTo(1.9, 0); rs.lineTo(-1.9, 0);
    const roofG = new THREE.ExtrudeGeometry(rs, { depth: 2.9, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 2 }); roofG.translate(0, 0, -1.45);
    add(roofG, L(0xffffff, { map: K.rep(K.roofTex(h[4], h[5]), 0.5, 0.5) }), 0, 2.5, 0, inner).rotation.z = -0.06;
    add(rbox(0.85, 1.45, 0.22, 0.1), L(h[6]), 0.1, 0.75, 1.25, inner);
    for (const [wx, wy] of [[-0.9, 1.6], [0.95, 1.75]]) { add(rbox(0.62, 0.7, 0.16, 0.06), L(0x3a2a2a), wx, wy, 1.24, inner); add(new THREE.BoxGeometry(0.5, 0.5, 0.05), new THREE.MeshLambertMaterial({ color: 0xffb050, emissive: 0xff8a20, emissiveIntensity: 1.2 }), wx, wy, 1.33, inner); add(new THREE.BoxGeometry(0.05, 0.56, 0.06), L(0x3a2a2a), wx, wy, 1.37, inner); }
    add(rbox(0.45, 1.2, 0.45, 0.06), L(0x6a5a5a), 0.9, 3.6, -0.3, inner).rotation.z = 0.18;
    return g;
  }
  function hut(h, x, y, z, ry, s) {
    const g = grp(x, y, z, s, ry); const wm = woodM();
    for (const sx of [-1.3, 1.3]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.11, 0.13, 0.9, 8), wm, sx, 0.45, sz, g);
    add(rbox(3.2, 0.2, 2.6, 0.06), wm, 0, 0.95, 0, g);
    const wT = K.wallTex(h[1], h[2], h[3]); add(rbox(2.7, 1.8, 2.2, 0.1), L(0xffffff, { map: K.rep(wT, 0.6, 0.6) }), 0, 1.95, 0, g);
    const roof = add(new THREE.ConeGeometry(2.5, 2.1, 4, 1), L(0xffffff, { map: K.rep(K.thatchTex(h[4], h[5]), 1.5, 1.2) }), 0, 3.85, 0, g); roof.rotation.y = Math.PI / 4; roof.scale.set(1.15, 1, 1);
    add(rbox(0.8, 1.2, 0.2, 0.08), L(h[6]), 0, 1.65, 1.12, g);
    for (let i = 0; i < 4; i++) add(rbox(0.9, 0.08, 0.25, 0.03), wm, 0, 0.75 - i * 0.2, 1.45 + i * 0.12, g);
    for (const sx of [-0.85, 0.85]) add(rbox(0.5, 0.5, 0.12, 0.05), L(0x5a3a1a), sx, 2.05, 1.11, g);
    return g;
  }
  const HP = [[-24, 1.7, -7.4, 0.08, 1], [-15.5, 1.7, -7.8, -0.05, 1.1], [-3.5, 1.7, -7.2, 0.1, 0.95], [36, 0.9, -8.4, -0.12, 1], [-33, 1.7, -7.6, 0.15, 1]];
  const houses = [];
  HP.forEach((p, i) => {
    const h = B.houses[i]; const st = h[0]; let g;
    if (st === 'cottage') g = cottage(h, ...p); else if (st === 'cabin') g = cabin(h, ...p); else if (st === 'igloo') g = igloo(p[0], p[1], p[2] + 0.2, p[3], p[4]);
    else if (st === 'adobe') g = adobe(h, ...p); else if (st === 'crooked') g = crooked(h, ...p); else if (st === 'hut') g = hut(h, ...p);
    houses.push(g);
    rect(p[0] - 1.75 * p[4], p[0] + 1.75 * p[4], p[2] - 1.6 * p[4], p[2] + 1.75 * p[4]);
  });

  // ---------------- trees ----------------
  const leafA = K.leafTex('#4fb35a', '#6fd06d', '#3e9a4c'), leafB = K.leafTex('#5cc068', '#7fdc78', '#46a556');
  function treeRound(x, y, z, s) {
    const g = grp(x, y, z, s); add(new THREE.CylinderGeometry(0.2, 0.32, 2, 8), L(0xffffff, { map: K.rep(T.wood, 1, 2) }), 0, 1, 0, g);
    const lm = L(0xffffff, { map: r() < 0.5 ? leafA : leafB });
    for (const [a, b, c, sx, sy] of [[0, 2.5, -0.25, 1.5, 1.2], [-0.6, 2.2, 0.05, 1.05, 0.9], [0.65, 2.3, 0.15, 1.1, 0.95], [0.05, 3.2, 0, 1, 0.85]]) { const m = add(new THREE.SphereGeometry(1, 20, 14), lm, a, b, c, g); m.scale.set(sx, sy, 0.55); }
    return g;
  }
  function treePine(x, y, z, s) {
    const g = grp(x, y, z, s); add(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 8), L(0x7a5236), 0, 0.6, 0, g);
    const pine = B.pine || [0x3f8fb0, 0x2f7898];
    for (let i = 0; i < 4; i++) { const rr = 1.3 - i * 0.27, hh = 1.3, yy = 1.25 + i * 0.72; const c = add(new THREE.ConeGeometry(rr, hh, 10), L(pine[i % 2]), 0, yy, 0, g); c.scale.z = 0.7; const sn = add(new THREE.ConeGeometry(rr * 0.8, hh * 0.62, 10), L(0xffffff), 0, yy + hh * 0.2, 0, g); sn.scale.z = 0.72; }
    return g;
  }
  function treePalm(x, y, z, s) {
    const g = grp(x, y, z, s, r() * 6); let px = 0, py = 0; const lean = 0.25 + r() * 0.25;
    for (let i = 0; i < 8; i++) { const t = i / 8; const seg = add(new THREE.CylinderGeometry(0.15 - 0.04 * t, 0.19 - 0.04 * t, 0.5, 8), L(i % 2 ? 0xb4854f : 0x9a6c3e), px, py + 0.25, 0, g); seg.rotation.z = -lean * t; px += Math.sin(lean * t) * 0.48; py += Math.cos(lean * t) * 0.48; }
    const ls = new THREE.Shape(); ls.moveTo(0, 0); ls.quadraticCurveTo(0.7, 0.42, 1.9, 0.05); ls.quadraticCurveTo(0.8, -0.12, 0, 0);
    const crown = new THREE.Group(); crown.position.set(px, py + 0.1, 0); g.add(crown);
    for (let k = 0; k < 8; k++) { const piv = new THREE.Group(); piv.rotation.y = k / 8 * Math.PI * 2 + r() * 0.3; crown.add(piv); const droop = new THREE.Group(); droop.rotation.z = -0.35 - r() * 0.35; piv.add(droop); const leaf = new THREE.Mesh(new THREE.ShapeGeometry(ls, 10), L(k % 2 ? 0x4fae4a : 0x3c9a42, { side: THREE.DoubleSide })); leaf.rotation.x = -Math.PI / 2; leaf.scale.set(1.1, 1.6, 1); droop.add(leaf); }
    for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.16, 10, 8), L(0x7a4a24), px + Math.cos(k * 2.1) * 0.22, py - 0.05, Math.sin(k * 2.1) * 0.22, g);
    const ph = r() * 6; updaters.push((dt, t) => { crown.rotation.z = Math.sin(t * 0.8 + ph) * 0.04; });
    return g;
  }
  const cactusT = K.mkTex(128, 128, (g, w, h) => { g.fillStyle = '#5cb85a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 16) { g.fillStyle = '#4a9e4a'; g.fillRect(x, 0, 5, h); g.fillStyle = '#7fd47a'; g.fillRect(x + 8, 0, 2, h); } g.fillStyle = '#fff6d0'; for (let i = 0; i < 30; i++) g.fillRect(r() * w, r() * h, 2, 2); });
  function cactus(x, y, z, s) {
    const g = grp(x, y, z, s); const m = L(0xffffff, { map: K.rep(cactusT, 2, 2) });
    add(new THREE.CapsuleGeometry(0.36, 2, 6, 14), m, 0, 1.35, 0, g);
    for (const [sx, hy, hh] of [[-1, 1.2, 0.7], [1, 1.6, 0.55]]) { const a = add(new THREE.CapsuleGeometry(0.2, 0.45, 6, 10), m, sx * 0.55, hy, 0, g); a.rotation.z = sx * Math.PI / 2; add(new THREE.CapsuleGeometry(0.2, hh, 6, 10), m, sx * 0.82, hy + hh / 2 + 0.1, 0, g); }
    add(new THREE.SphereGeometry(0.16, 10, 8), L(0xff6a9a), 0, 2.75, 0.1, g);
    return g;
  }
  function treeDead(x, y, z, s) {
    const g = grp(x, y, z, s, r() * 6); const m = L(0x3a2a30);
    const trunk = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0.2, 1, 0), V3(-0.15, 2, 0), V3(0.15, 2.9, 0)]); add(new THREE.TubeGeometry(trunk, 14, 0.22, 8), m, 0, 0, 0, g);
    add(new THREE.CylinderGeometry(0.22, 0.36, 0.4, 8), m, 0, 0.15, 0, g);
    for (let k = 0; k < 6; k++) { const t = 0.45 + k * 0.09; const p = trunk.getPoint(Math.min(t, 0.98)); const dir = (k % 2 ? 1 : -1); const pts = [p.clone()]; let q = p.clone(); for (let j = 0; j < 3; j++) { q = q.clone().add(V3(dir * (0.35 + r() * 0.3), 0.25 + r() * 0.35, (r() - 0.5) * 0.4)); pts.push(q); } add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.07 - k * 0.005, 6), m, 0, 0, 0, g); }
    if (r() < 0.6) { const crow = new THREE.Group(); crow.position.copy(trunk.getPoint(0.98)); crow.position.y += 0.25; g.add(crow); add(new THREE.SphereGeometry(0.2, 10, 8), L(0x1a1420), 0, 0, 0, crow).scale.set(1.2, 1, 1); add(new THREE.SphereGeometry(0.13, 10, 8), L(0x1a1420), 0.2, 0.16, 0, crow); add(new THREE.ConeGeometry(0.05, 0.18, 6), L(0xe8b040), 0.36, 0.14, 0, crow).rotation.z = -Math.PI / 2; add(new THREE.SphereGeometry(0.03, 6, 6), L(0xffd060, { emissive: 0xffb020 }), 0.26, 0.22, 0.09, crow); }
    return g;
  }
  function treeBroad(x, y, z, s, par = root) {
    const g = grp(x, y, z, s, r() * 6, par); const ls = new THREE.Shape(); ls.moveTo(0, 0); ls.bezierCurveTo(0.5, 0.55, 1.2, 0.5, 1.6, 0); ls.bezierCurveTo(1.2, -0.5, 0.5, -0.55, 0, 0);
    add(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6), L(0x3d8a3a), 0, 0.3, 0, g);
    for (let k = 0; k < 9; k++) { const piv = new THREE.Group(); piv.position.set(0, 0.55, 0); piv.rotation.y = k / 9 * Math.PI * 2; g.add(piv); const up = new THREE.Group(); up.rotation.z = 0.5 + r() * 0.5; piv.add(up); const leaf = new THREE.Mesh(new THREE.ShapeGeometry(ls, 10), L(k % 2 ? 0x2f9a4a : 0x3fb05a, { side: THREE.DoubleSide })); leaf.rotation.x = -Math.PI / 2; up.add(leaf); }
    for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.16, 10, 8), L([0xff4f6a, 0xffd35a, 0xff8ab8][k]), Math.cos(k * 2) * 0.6, 1.1 + r() * 0.3, Math.sin(k * 2) * 0.6, g);
    return g;
  }
  const TREEFN = { round: treeRound, pine: treePine, palm: treePalm, cactus, dead: treeDead, broad: treeBroad };
  [[-12.5, 0, -1.9, 1.05], [2.2, 0, -2.2, 1.1], [-27, 1.7, -4.6, 0.9], [-20, 3.4, -12.6, 1.1], [-29, 3.4, -13, 1], [25, 0, -2.1, 1.2], [39, 0.9, -6.5, 0.9], [41, 0, -1.5, 1.1], [-36, 0, -2, 1.1], [8, 0, -6, 1]].forEach((p, i) => {
    TREEFN[B.trees[i % 2]](...p); circle(p[0], p[2], 0.75 * p[3]);
  });

  // ---------------- hedge + gate ----------------
  function bush(x, y, z, s = 1, c = 0x3f9e4e, snowcap = false) {
    const m = L(c);
    for (const [a, b, cc] of [[0, 0, 0.6], [0.55, 0.05, 0.48], [-0.55, 0, 0.45]]) {
      const k = add(new THREE.SphereGeometry(cc * s, 14, 10), m, x + a * s, y + 0.3 * s + b, z); k.scale.z = 0.8;
      if (snowcap) { const sc = add(new THREE.SphereGeometry(cc * s * 0.92, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), L(0xffffff), x + a * s, y + 0.3 * s + b + cc * s * 0.12, z); sc.scale.z = 0.8; }
    }
  }
  for (let x = 14; x < 45; x += 1.4) {
    if (x > 19.2 && x < 22.8) continue; const i = Math.round(x / 1.4);
    if (B.hedge === 'wall') add(rbox(1.42, 1.3, 0.7, 0.15), L(0xffffff, { map: K.rep(K.wallTex('#efc898', '#d4a476', 'adobe'), 0.5, 0.5) }), x, 0.65, -12.6);
    else if (B.hedge === 'jungle') treeBroad(x, 0, -12.6, 1.4);
    else bush(x, 0, -12.6, 1.4, B.hedgeCol[i % 2], B.hedge === 'snowbush');
  }
  const gate = new THREE.Group(); root.add(gate);
  const seal = new THREE.Group(); root.add(seal);
  { const gx = 21, gz = -12.6;
    if (B.gate === 'vine' || B.gate === 'ice') { const st = L(B.gate === 'ice' ? 0xe8f4ff : 0xd8d0c0); for (const sx of [gx - 1.4, gx + 1.4]) { add(rbox(0.7, 2.8, 0.7, 0.1), st, sx, 1.4, gz, gate); add(new THREE.SphereGeometry(0.42, 12, 8), L(B.gate === 'ice' ? 0xffffff : 0xd8d0c0), sx, 3.0, gz, gate); } add(new THREE.TorusGeometry(1.4, 0.22, 8, 20, Math.PI), L(B.gate === 'ice' ? 0xbfe8ff : 0x7fd06a), gx, 2.75, gz, gate); }
    if (B.gate === 'sandstone') { const st = L(0xffffff, { map: K.rep(K.cliffTex(B.cliff), 0.4, 1) }); for (const sx of [gx - 1.5, gx + 1.5]) add(rbox(0.9, 3.2, 0.9, 0.12), st, sx, 1.6, gz, gate); add(rbox(4, 0.7, 1, 0.15), st, gx, 3.4, gz, gate); add(new THREE.TorusGeometry(1.05, 0.18, 8, 20, Math.PI), L(0xc8703e), gx, 2.3, gz, gate); }
    if (B.gate === 'iron') { const st = L(0x5a5064); for (const sx of [gx - 1.5, gx + 1.5]) { add(rbox(0.7, 2.6, 0.7, 0.08), st, sx, 1.3, gz, gate); add(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffc060 }), sx, 2.85, gz, gate); const pl = new THREE.PointLight(0xffa040, 4, 7, 1.4); pl.position.set(sx, 2.9, gz + 0.6); gate.add(pl); } }
    if (B.gate === 'tiki') { const bm = L(0xd8c070); for (const sx of [gx - 1.5, gx + 1.5]) { add(new THREE.CylinderGeometry(0.18, 0.2, 3.2, 10), bm, sx, 1.6, gz, gate); for (let k = 0; k < 5; k++) add(new THREE.TorusGeometry(0.19, 0.04, 6, 12), L(0xb8a050), sx, 0.4 + k * 0.65, gz, gate).rotation.x = Math.PI / 2; } add(new THREE.CylinderGeometry(0.16, 0.16, 3.6, 10), bm, gx, 3.2, gz, gate).rotation.z = Math.PI / 2; treeBroad(gx, 3.2, gz, 1.1, gate); }
    for (const sx of [gx - 1.45, gx + 1.45]) circle(sx, gz, 0.6);
    // the seal: a paper ribbon with a wax stamp across the gate, removed when the region is finished
    const ribbon = add(new THREE.BoxGeometry(2.4, 0.5, 0.06), L(0xe8566a), gx, 1.3, gz + 0.1, seal); ribbon.rotation.z = 0.12;
    const ribbon2 = add(new THREE.BoxGeometry(2.4, 0.5, 0.06), L(0xe8566a), gx, 1.3, gz + 0.12, seal); ribbon2.rotation.z = -0.12;
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20), L(0x9a2340), gx, 1.3, gz + 0.2, seal).rotation.x = Math.PI / 2;
    rect(gx - 1.2, gx + 1.2, gz - 0.3, gz + 0.45);
  }

  // ---------------- fences ----------------
  function fence(x0, x1, z, y = 0) {
    if (B.fence === 'bamboo') { const m = L(0xd9c878); for (let x = x0; x <= x1; x += 0.4) add(new THREE.CylinderGeometry(0.08, 0.08, 1 + r() * 0.2, 8), m, x, y + 0.5, z); add(new THREE.CylinderGeometry(0.05, 0.05, x1 - x0 + 0.3, 6), L(0xb8a050), (x0 + x1) / 2, y + 0.7, z - 0.1).rotation.z = Math.PI / 2; }
    else {
      const tilt = B.fence === 'crooked' ? 0.35 : 0.12; const m = woodM();
      for (let x = x0; x <= x1; x += 0.55) { const ph = 0.95 + r() * 0.2; const p = add(rbox(0.32, ph, 0.08, 0.04), m, x, y + 0.45, z); p.rotation.z = (r() - 0.5) * tilt; if (B.fence === 'snowwood') add(rbox(0.36, 0.12, 0.14, 0.05), L(0xffffff), x, y + 0.45 + ph / 2 + 0.02, z); }
      add(new THREE.BoxGeometry(x1 - x0 + 0.4, 0.12, 0.06), m, (x0 + x1) / 2, y + 0.62, z - 0.06);
    }
    if (y === 0) rect(x0 - 0.2, x1 + 0.2, z - 0.25, z + 0.35);
  }
  if (fences) { fence(-31, -26, 3.0); fence(-4, 3, 3.0); fence(32, 38, 3.0); fence(-38, -28, -3.5, 1.7); fence(0, 5.4, -3.5, 1.7); }

  // ---------------- props ----------------
  function flower(x, y, z, c, s = 1) { add(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.4 * s, 5), L(0x3d9a4e), x, y + 0.2 * s, z); const pm = L(c); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; add(new THREE.SphereGeometry(0.09 * s, 8, 6), pm, x + Math.cos(a) * 0.11 * s, y + 0.42 * s, z + Math.sin(a) * 0.11 * s); } add(new THREE.SphereGeometry(0.07 * s, 8, 6), L(0xffe14d), x, y + 0.44 * s, z); }
  const flowerOk = (x, z) => !Object.values(ANCHORS).some(([ax, , az]) => Math.hypot(ax - x, az - z) < 1.3) && Math.hypot(DOOR_POS.x - x, DOOR_POS.z - z) > 2.6;
  for (let i = 0; i < B.flowerN; i++) { const x = -36 + r() * 78, z = -0.2 - r() * 2.6; if ((x > 9 && x < 14) || !flowerOk(x, z)) continue; flower(x, 0, z, B.flowers[i % B.flowers.length]); }
  for (let i = 0; i < B.flowerN * 0.4; i++) { const x = -36 + r() * 42, z = -6 + r() * -1; if (!flowerOk(x, z)) continue; flower(x, 1.7, z, B.flowers[i % B.flowers.length]); }
  // the little door at the arrival point: the way in from (and back to) Becancourt's lab
  const littleDoor = buildLittleDoor({ standalone: true });
  littleDoor.position.set(DOOR_POS.x, 0, DOOR_POS.z); root.add(littleDoor);
  rect(DOOR_POS.x - 1.75, DOOR_POS.x + 1.75, DOOR_POS.z - 0.9, DOOR_POS.z + 0.55);
  function well(x, z, roofCol) { add(new THREE.CylinderGeometry(0.8, 0.85, 0.8, 14), L(0xffffff, { map: K.rep(K.wallTex('#d9d3c8', '#a9a397', 'brick'), 1.5, 0.5) }), x, 0.4, z); add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14), L(BIOME === 'snow' ? 0xd8f0ff : 0x4fc1ee), x, 0.78, z); for (const sx of [-0.7, 0.7]) add(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), L(0x8a5a36), x + sx, 1.2, z); const wr = add(new THREE.ConeGeometry(1.1, 0.7, 4), L(roofCol), x, 2.2, z); wr.rotation.y = Math.PI / 4; circle(x, z, 1.0); }
  const lampLights = [];
  function lamp(x, y, z, col = 0xfff0b0, light = true) { add(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 8), L(0x3a3440), x, y + 1.2, z); add(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: col }), x, y + 2.5, z); add(new THREE.ConeGeometry(0.3, 0.25, 8), L(0x3a3440), x, y + 2.75, z); if (light) { const pl = new THREE.PointLight(col, BIOME === 'dusk' ? 5 : 2.5, 7, 1.4); pl.position.set(x, y + 2.4, z + 0.3); root.add(pl); lampLights.push(pl); } circle(x, z, 0.25); }
  function snowman(x, z) { add(new THREE.SphereGeometry(0.6, 18, 14), L(0xffffff), x, 0.55, z); add(new THREE.SphereGeometry(0.42, 18, 14), L(0xffffff), x, 1.4, z); add(new THREE.SphereGeometry(0.3, 16, 12), L(0xffffff), x, 2.0, z); add(new THREE.ConeGeometry(0.07, 0.35, 8), L(0xff8a30), x, 2.0, z + 0.42).rotation.x = Math.PI / 2; for (const sx of [-0.1, 0.1]) add(new THREE.SphereGeometry(0.04, 8, 6), L(0x222222), x + sx, 2.08, z + 0.26); add(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 14), L(0x3a3a5a), x, 2.38, z); add(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 14), L(0x3a3a5a), x, 2.24, z); add(new THREE.TorusGeometry(0.34, 0.07, 8, 16), L(0xe04848), x, 1.75, z).rotation.x = Math.PI / 2; circle(x, z, 0.65); }
  function pumpkin(x, y, z, s = 1, lit = false) { const g = grp(x, y, z, s); for (let k = 0; k < 6; k++) { const p = add(new THREE.SphereGeometry(0.35, 12, 10), L(0xff8a2a, lit ? { emissive: 0xff6a00, emissiveIntensity: 0.25 } : {}), Math.cos(k / 6 * Math.PI * 2) * 0.12, 0.3, Math.sin(k / 6 * Math.PI * 2) * 0.12, g); p.scale.set(0.75, 0.85, 0.75); } add(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), L(0x4a6a2a), 0, 0.65, 0, g); if (y === 0) circle(x, z, 0.4 * s); }
  function torch(x, y, z) { add(new THREE.CylinderGeometry(0.06, 0.07, 2, 8), L(0xb8904e), x, y + 1, z); add(new THREE.CylinderGeometry(0.14, 0.1, 0.3, 8), L(0x6a4a2a), x, y + 2.05, z); const f = add(new THREE.ConeGeometry(0.13, 0.42, 10), new THREE.MeshBasicMaterial({ color: 0xffb030 }), x, y + 2.4, z); add(new THREE.ConeGeometry(0.07, 0.25, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }), x, y + 2.36, z + 0.02); updaters.push((dt, t) => { f.scale.y = 1 + Math.sin(t * 9 + x) * 0.12; }); circle(x, z, 0.25); }
  if (B.props === 'meadow') well(31, -1.3, 0x5b86dc);
  if (B.props === 'snow') { well(31, -1.3, 0xf7fbff); snowman(4.6, -0.9); snowman(-30, -0.2); for (const x of [-14.5, 1, 16.2]) lamp(x, 0, 0.2, 0xffe0a0); for (let i = 0; i < 10; i++) { const m = add(new THREE.SphereGeometry(0.5 + r() * 0.5, 14, 10), L(0xffffff), -36 + r() * 76, 0, -1.2 - r() * 1.8); m.scale.y = 0.35; } }
  if (B.props === 'desert') {
    well(31, -1.3, 0xe8566a);
    const flags = (x0, x1, y, z) => { const cv = new THREE.CatmullRomCurve3([V3(x0, y, z), V3((x0 + x1) / 2, y - 0.7, z), V3(x1, y, z)]); add(new THREE.TubeGeometry(cv, 20, 0.02, 4), L(0x6a4a2a), 0, 0, 0); for (let t = 0.04; t < 0.97; t += 0.06) { const p = cv.getPoint(t); const tri = new THREE.Shape(); tri.moveTo(-0.18, 0); tri.lineTo(0.18, 0); tri.lineTo(0, -0.42); add(new THREE.ShapeGeometry(tri), L([0xe8566a, 0xffd35a, 0x4f86d8, 0x5fc06a][Math.round(t * 16) % 4], { side: THREE.DoubleSide }), p.x, p.y, p.z); } };
    flags(-22.4, -17, 4.6, -6.1); flags(-14, -5.2, 4.6, -5.9); flags(-30, -23, 3.4, 1);
    for (let i = 0; i < 9; i++) { const x = -36 + r() * 76, z = -0.5 - r() * 2; if (!flowerOk(x, z) || (x > 9 && x < 14)) continue; const rk = add(new THREE.DodecahedronGeometry(0.3 + r() * 0.4, 0), L(0xc98a52), x, 0.1, z); rk.scale.y = 0.6; }
    for (const [x, z] of [[3.6, -0.6], [-17, -0.9], [15.4, -7.5]]) { cactus(x, 0, z, 0.55); circle(x, z, 0.45); }
  }
  if (B.props === 'dusk') { well(31, -1.3, 0x4c4a6c); for (const x of [-14.5, 1, 16.2]) lamp(x, 0, 0.2, 0xffb050); lamp(-9, 1.7, -3.9, 0xffb050); for (const [x, y, z, s] of [[-7.5, 0, -0.6, 1], [-6.8, 0, -0.3, 0.7], [4.4, 0, -1.1, 1.1], [-21, 1.7, -5.6, 0.9], [-1.6, 1.7, -5.8, 0.8], [15.6, 0, -7.4, 0.9], [26, 0, -0.4, 0.8]]) pumpkin(x, y, z, s, true); }
  if (B.props === 'tropic') { well(31, -1.3, 0xe6c46e); for (const x of [-14.5, 1, 16.2]) torch(x, 0, 0.2); for (let i = 0; i < 6; i++) add(rbox(0.7, 0.7, 0.7, 0.06), woodM(), 30 + i * 0.8, -0.95 + 0.35, 9.6 + (i % 2) * 0.8); const um = grp(-24, -0.95, 9.4); add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), L(0xffffff), 0, 1.3, 0, um); add(new THREE.ConeGeometry(1.6, 0.6, 12, 1, true), L(0xffffff, { map: K.stripeTex('#ff5a6a', '#ffffff', 12), side: THREE.DoubleSide }), 0, 2.6, 0, um); }
  // windmill on the hilltop (every biome)
  { const g = grp(-28.5, 3.4, -16.5); add(new THREE.CylinderGeometry(1.1, 1.5, 4.2, 8), L(BIOME === 'dusk' ? 0x8a7a8a : 0xf6ecd8), 0, 2.1, 0, g); add(new THREE.ConeGeometry(1.5, 1.6, 8), L(BIOME === 'dusk' ? 0x4c4a6c : 0xe8566a), 0, 5, 0, g); const hub = new THREE.Group(); hub.position.set(0, 4.2, 1.25); g.add(hub); for (let i = 0; i < 4; i++) { const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; hub.add(arm); add(rbox(0.55, 2.9, 0.08, 0.04), L(0xfff6e6), 0, 1.6, 0, arm); } add(new THREE.SphereGeometry(0.22, 10, 8), L(0x8a5a36), 0, 0, 0, hub); updaters.push((dt) => { hub.rotation.z += dt * 0.5; }); circle(-28.5, -16.5, 1.7); }

  // ---------------- background flats ----------------
  add(new THREE.PlaneGeometry(500, 260), L(B.farGround), 0, -0.6, -140).rotation.x = -Math.PI / 2;
  function bgRow(o) {
    const step = o.step;
    if (o.shape === 'pine') { for (let x = -110; x < 130; x += step * (0.7 + r() * 0.6)) { const s = o.r[0] + r() * (o.r[1] - o.r[0]); const g = grp(x, o.y, o.z + r() * 1.2, s); for (let i = 0; i < 3; i++) { const c = add(new THREE.ConeGeometry(1.1 - i * 0.28, 1.2, 8), L(o.col), 0, 0.6 + i * 0.65, 0, g); c.scale.z = 0.4; const sn = add(new THREE.ConeGeometry((1.1 - i * 0.28) * 0.75, 0.7, 8), L(0xffffff), 0, 0.85 + i * 0.65, 0, g); sn.scale.z = 0.42; } } return; }
    if (o.shape === 'mountain') { for (let x = -120; x < 140; x += step * (0.7 + r() * 0.6)) { const s = o.r[0] + r() * (o.r[1] - o.r[0]); const m = add(new THREE.ConeGeometry(s, s * 1.15, 6), L(o.col), x, o.y + s * 0.55, o.z + r() * 2); m.scale.z = 0.35; m.rotation.y = r(); const cap = add(new THREE.ConeGeometry(s * 0.42, s * 0.48, 6), L(0xffffff), x, o.y + s * 0.55 + s * 0.335, o.z + r() * 2 + 0.3); cap.scale.z = 0.36; cap.rotation.y = m.rotation.y; } return; }
    if (o.shape === 'mesa') { const c = new THREE.Color(o.col); const tx = K.cliffTex({ top: '#' + c.getHexString(), bottom: '#' + c.clone().multiplyScalar(0.75).getHexString(), stripe: 'rgba(120,50,20,.3)', band: 'rgba(0,0,0,0)', strata: true }); for (let x = -120; x < 140; x += step * (0.7 + r() * 0.6)) { const s = o.r[0] + r() * (o.r[1] - o.r[0]); const hgt = s * (0.5 + r() * 0.4); add(rbox(s * 2, hgt, 2, 0.3), L(0xffffff, { map: K.rep(tx, 1, 1) }), x, o.y + hgt / 2, o.z + r() * 2); } return; }
    const tx = K.domeTex(o.col, o.dark, 'rgba(255,255,255,.16)', o.icon); const m = L(0xffffff, { map: K.rep(tx, 2, 1) });
    for (let x = -110; x < 130; x += step * (0.7 + r() * 0.6)) { const rr = o.r[0] + r() * (o.r[1] - o.r[0]); const d = add(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, x, o.y, o.z + r() * 1.5); if (o.shape === 'dune') d.scale.set(rr * 1.9, rr * 0.55, rr * 0.4); else d.scale.set(rr, rr * (0.9 + r() * 0.4), rr * (o.flat || 0.35)); }
  }
  B.bg.forEach(bgRow);
  if (B.sea) {
    const seaTex = K.rep(K.waterTex({ base: '#1fc0d6', line: '#9ff2ff' }), 60, 24);
    const sea = add(new THREE.PlaneGeometry(500, 240), L(0xffffff, { map: seaTex }), 0, -0.45, -140); sea.rotation.x = -Math.PI / 2;
    updaters.push((dt) => { seaTex.offset.x += dt * 0.01; });
    for (const [x, z, s] of [[-30, -60, 9], [18, -75, 12], [60, -58, 7]]) { const isl = add(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), L(0x3fae6a), x, -0.5, z); isl.scale.set(s, s * 0.35, s * 0.35); add(new THREE.CylinderGeometry(s * 1.04, s * 1.04, 0.3, 24), L(0xf7e2a6), x, -0.4, z).scale.z = 0.35; }
    const boat = grp(4, -0.45, -40, 1.6); add(new THREE.CylinderGeometry(0.9, 0.5, 0.5, 12, 1, false, 0, Math.PI), L(0xb07a48), 0, 0.2, 0, boat).rotation.set(0, 0, Math.PI / 2); add(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), L(0x8a5a36), 0, 1.4, 0, boat); const sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(1.2, 0); sail.lineTo(0, 1.9); add(new THREE.ShapeGeometry(sail), L(0xffffff, { side: THREE.DoubleSide }), 0.05, 0.5, 0, boat);
    updaters.push((dt, t) => { boat.position.x = 4 + Math.sin(t * 0.05) * 20; boat.rotation.z = Math.sin(t * 1.3) * 0.04; });
  }
  // sky dome, clouds, moon
  { const g = new THREE.SphereGeometry(230, 32, 20); const cols = []; const stops = B.sky.map(([t, c]) => [t, new THREE.Color(c)]);
    for (let i = 0; i < g.attributes.position.count; i++) { const y = Math.max(0, g.attributes.position.getY(i) / 230); let c = stops[stops.length - 1][1]; for (let k = 0; k < stops.length - 1; k++) { if (y >= stops[k][0] && y <= stops[k + 1][0]) { const t = (y - stops[k][0]) / (stops[k + 1][0] - stops[k][0]); c = stops[k][1].clone().lerp(stops[k + 1][1], Math.pow(t, 0.8)); break; } } cols.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); root.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }))); }
  const clouds = [];
  function cloud(x, y, z, s) { const g = grp(x, y, z); const m = new THREE.MeshLambertMaterial({ color: B.clouds.col, emissive: B.clouds.col, emissiveIntensity: B.clouds.emi, fog: false }); for (const [a, b, c] of [[0, 0, 0.85], [0.85, -0.12, 0.6], [-0.85, -0.15, 0.62], [0.35, 0.4, 0.62], [-0.3, 0.3, 0.5]]) add(new THREE.SphereGeometry(c, 16, 12), m, a, b, 0, g); g.scale.set(s, s * 0.85, s * 0.35); clouds.push(g); }
  for (let x = -80; x < 100; x += (14 + r() * 10) / B.clouds.n) cloud(x, 12 + r() * 8, -55 - r() * 12, 2.4 + r() * 1.6);
  updaters.push((dt) => clouds.forEach((c, i) => { c.position.x += dt * (0.25 + (i % 3) * 0.08); if (c.position.x > 110) c.position.x = -90; }));
  if (B.moon) { add(new THREE.CircleGeometry(4.2, 40), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }), -34, 17.5, -120); add(new THREE.CircleGeometry(7, 40), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.18, fog: false }), -34, 17.5, -121); for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2, e = 0.25 + r() * 0.6; add(new THREE.SphereGeometry(0.25 + r() * 0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }), Math.cos(a) * Math.cos(e) * 210, Math.sin(e) * 210, -Math.abs(Math.sin(a) * Math.cos(e) * 210)); } }

  // ---------------- foreground (front bank, framing the bottom of the screen) ----------------
  function blade(x, z, h, col, lean) { const s = new THREE.Shape(); s.moveTo(-0.16, 0); s.quadraticCurveTo(-0.1 + lean * 0.4, h * 0.6, lean, h); s.quadraticCurveTo(0.12 + lean * 0.3, h * 0.55, 0.16, 0); s.lineTo(-0.16, 0); const m = add(new THREE.ShapeGeometry(s, 8), L(col, { side: THREE.DoubleSide }), x, -0.95, z); m.rotation.y = (r() - 0.5) * 0.6; return m; }
  function tuft(x, z, s, cols) { for (let i = 0; i < 7; i++) blade(x + (i - 3) * 0.22 * s, z + (r() - 0.5) * 0.3, (1.6 + r() * 1.4) * s, cols[i % cols.length], (r() - 0.5) * 0.8 * s); }
  function bigLeaves(x, z, s) { const ls = new THREE.Shape(); ls.moveTo(0, 0); ls.bezierCurveTo(0.6, 0.7, 1.6, 0.7, 2.2, 0); ls.bezierCurveTo(1.6, -0.7, 0.6, -0.7, 0, 0); for (let k = 0; k < 5; k++) { const piv = grp(x, -0.95, z, s, (k - 2) * 0.5); const up = new THREE.Group(); up.rotation.z = 0.9 + r() * 0.4; piv.add(up); up.add(new THREE.Mesh(new THREE.ShapeGeometry(ls, 10), L(k % 2 ? 0x2a8a44 : 0x37a052, { side: THREE.DoubleSide }))); } }
  function starfish(x, z) { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, rr = i & 1 ? 0.12 : 0.3; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } const m = add(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03 }), L(0xff7a50), x, -0.9, z); m.rotation.x = -Math.PI / 2; }
  const bankSpots = [ANCHORS['bank-left'][0], ANCHORS['bank-right'][0]];
  for (let x = -46; x < 56; x += 2.6 + r() * 2.8) {
    const k = r(), z = 9.6 + r() * 1.2;
    // in front of the bank villagers, plants stay low so the camera can see them (same random draws either way)
    const n0 = root.children.length;
    if (B.fg === 'meadow') { if (k < 0.55) tuft(x, z, 1 + r() * 0.4, [0x58b648, 0x6cc957, 0x4aa63e, 0xa6d94c]); else if (k < 0.8) flower(x, -0.95, z - 0.2, [0xff8ab8, 0xffd35a, 0xffffff][(r() * 3) | 0], 2.4); else bush(x, -0.95, z, 1.3, 0x3d9a4a); }
    if (B.fg === 'snow') { if (k < 0.45) tuft(x, z, 0.8 + r() * 0.3, [0xcfe2f2, 0xe6f2fb, 0xb8d4ea]); else if (k < 0.75) bush(x, -0.95, z, 1.3, 0x2f7a60, true); else treePine(x, -0.95, z + 0.3, 0.9); }
    if (B.fg === 'desert') { if (k < 0.45) tuft(x, z, 0.8 + r() * 0.4, [0xd9b44a, 0xc9a040, 0xe8c860]); else if (k < 0.75) cactus(x, -0.95, z, 0.8); else { const rk = add(new THREE.DodecahedronGeometry(0.7 + r() * 0.5, 0), L(0xc98a52), x, -0.7, z); rk.scale.y = 0.6; } }
    if (B.fg === 'dusk') { if (k < 0.5) tuft(x, z, 1 + r() * 0.3, [0x6a5a4a, 0x5a4a5a, 0x7a6a50]); else if (k < 0.78) pumpkin(x, -0.95, z, 1.6, true); else treeDead(x, -0.95, z + 0.4, 0.75); }
    if (B.fg === 'tropic') { if (k < 0.5) bigLeaves(x, z, 1.1 + r() * 0.4); else if (k < 0.75) starfish(x, z - 0.4); else tuft(x, z, 0.9, [0x3fb05a, 0x5fcf7a]); }
    if (bankSpots.some((ax) => Math.abs(x - ax) < 1.9)) {
      const kk = 0.38; // shrink towards the spot on the ground, so loose parts (bush balls) come down too
      for (const o of root.children.slice(n0)) { o.position.set(x + (o.position.x - x) * kk, -0.95 + (o.position.y + 0.95) * kk, z + (o.position.z - z) * kk); o.scale.multiplyScalar(kk); }
    }
  }

  // ---------------- particles ----------------
  if (B.particles === 'snow') {
    const fg = new THREE.CircleGeometry(0.09, 6); const fm = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
    const flakes = []; for (let i = 0; i < 320; i++) { const f = add(fg, fm, -40 + r() * 86, -1 + r() * 14, -12 + r() * 24); f.rotation.set(r() * 3, r() * 3, r() * 3); f.scale.setScalar(0.6 + r() * 1.4); f.userData.v = 0.6 + r() * 0.8; flakes.push(f); }
    updaters.push((dt, t) => flakes.forEach((f, i) => { f.position.y -= dt * f.userData.v; f.position.x += Math.sin(t + i) * dt * 0.3; f.rotation.x += dt; if (f.position.y < -1.2) f.position.y = 13; }));
  }
  if (B.particles === 'fireflies') {
    const fm = new THREE.MeshBasicMaterial({ color: 0xf0ff9a, fog: false }); const gm = new THREE.MeshBasicMaterial({ color: 0xe0ff80, transparent: true, opacity: 0.25, fog: false });
    const flies = []; for (let i = 0; i < 90; i++) { const g = grp(-38 + r() * 82, 0.4 + r() * 4, -10 + r() * 14); add(new THREE.SphereGeometry(0.05, 6, 6), fm, 0, 0, 0, g); add(new THREE.SphereGeometry(0.16, 8, 8), gm, 0, 0, 0, g); g.userData.base = g.position.clone(); g.userData.ph = r() * 6; flies.push(g); }
    updaters.push((dt, t) => flies.forEach((f) => { const p = f.userData.ph; f.position.set(f.userData.base.x + Math.sin(t * 0.5 + p) * 0.6, f.userData.base.y + Math.sin(t * 0.8 + p * 2) * 0.3, f.userData.base.z + Math.cos(t * 0.4 + p) * 0.5); }));
  }

  root.traverse((o) => { if (o.isMesh && !(o.material && o.material.isMeshBasicMaterial)) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    root, biome: B, biomeId, zones, colliders, anchors: ANCHORS,
    signpost: { x: DOOR_POS.x, z: DOOR_POS.z + 1.4 }, // where to stand to use the little door
    door: littleDoor,
    gatePos: { x: 21, z: -12.6 },
    setGateOpen(open) { seal.visible = !open; const c = colliders.find((k) => k.type === 'rect' && k.x0 === 21 - 1.2); if (c) c.disabled = open; },
    update(dt, t) { for (const u of updaters) u(dt, t); littleDoor.userData.update(dt); },
    makeFlower: (x, y, z, c, s) => flower(x, y, z, c, s),
    kit: K,
  };
}
