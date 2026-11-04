// Bespoke landmarks (the machine station of each world) and the three artefacts, built to match the
// "look" text in content/regions/<world>.json. Toy-paper style like the villagers and stations: chunky
// rounded shapes, warm colours, no outlines.
//
//   buildLandmark(regionId, stationId) -> THREE.Group | null   (null: use the generic station)
//     userData.update(dt, t)        every frame
//     userData.radius               collider radius around the anchor
//     userData.setAwake(on, now)    the station's own challenge is solved: the Bell's ears turn out and glow,
//                                   the Lens lights up, the Scanner's screen and hourglasses fill (now: no tween)
//     userData.celebrate()          the whole world is solved: the Bell rings, the Lens flashes, the crank spins
//   buildRelic(regionId) -> THREE.Group | null   the artefact itself, centred on its origin, about 1 unit tall
//     userData.update(dt, t)
import * as THREE from 'three';
import { rbox } from './geo.js';
import { add, grp, aim, teardropGeo, taperTubeGeo, frameGeo, PI, TAU, clamp, smooth } from './toyparts.js';

const DS = THREE.DoubleSide;
const dim = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const ease = (x) => x * x * (3 - 2 * x);

// ---------- shared bits ----------
function kit() {
  const cache = new Map();
  const make = (color, { r = 0.78, metal = 0, em = null, ei = 0, side = THREE.FrontSide, opacity = 1, map = null } = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: r, metalness: metal, side, map });
    if (em !== null) { m.emissive = new THREE.Color(em); m.emissiveIntensity = ei; }
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    return m;
  };
  return {
    // cached: for things that never change colour
    M(color, o = {}) {
      const k = JSON.stringify([color, o.r, o.metal, o.em, o.ei, o.side, o.opacity]);
      if (o.map) return make(color, o);
      if (!cache.has(k)) cache.set(k, make(color, o));
      return cache.get(k);
    },
    // a fresh material, for things that glow or fade on their own
    own: make,
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const FONT = (px) => `700 ${px}px Fredoka, "Trebuchet MS", sans-serif`;
function labelTex(text, { w = 256, h = 88, bg = '#fff6dc', ink = '#3a2b1f', edge = '#b98a55' } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; rr(g, 4, 4, w - 8, h - 8, 16); g.fill();
    g.lineWidth = 6; g.strokeStyle = edge; g.stroke();
    let px = 46; g.font = FONT(px);
    while (g.measureText(text).width > w - 30 && px > 14) { px -= 2; g.font = FONT(px); }
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 3);
  });
}
// the Twin Lens's photo: an island at sea under a big sun
function photoTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#b8f6ff'); sky.addColorStop(1, '#43d9d2');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff1a0'; g.beginPath(); g.arc(w * 0.72, h * 0.28, h * 0.13, 0, TAU); g.fill();
    g.fillStyle = '#1aa5ba'; g.fillRect(0, h * 0.64, w, h * 0.36);
    g.fillStyle = '#f7e2a6'; g.beginPath(); g.ellipse(w * 0.4, h * 0.67, w * 0.27, h * 0.08, 0, 0, TAU); g.fill();
    g.strokeStyle = '#8a5a36'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * 0.38, h * 0.65); g.quadraticCurveTo(w * 0.34, h * 0.48, w * 0.42, h * 0.38); g.stroke();
    g.fillStyle = '#3c9a42';
    for (const a of [-2.9, -2.2, -1.5, -0.8, -0.1]) { g.beginPath(); g.ellipse(w * 0.42 + Math.cos(a) * w * 0.1, h * 0.38 + Math.sin(a) * h * 0.06, w * 0.11, h * 0.032, a, 0, TAU); g.fill(); }
  });
}
// a cream caption card with three ink lines
function captionTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#fff3cf'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a3b55'; g.lineCap = 'round'; g.lineWidth = 10;
    for (const [y, x1] of [[0.3, 0.82], [0.5, 0.7], [0.7, 0.56]]) { g.beginPath(); g.moveTo(w * 0.18, h * y); g.lineTo(w * x1, h * y); g.stroke(); }
  });
}

// a bell: smooth outer profile from the crown to a flared lip, which turns a little way inside
function bellGeo(H, R, seg = 40) {
  const outer = new THREE.SplineCurve([
    [0.001, H], [0.36 * R, 0.985 * H], [0.52 * R, 0.9 * H], [0.57 * R, 0.74 * H], [0.6 * R, 0.52 * H],
    [0.7 * R, 0.3 * H], [0.86 * R, 0.12 * H], [R, 0],
  ].map(([r, y]) => new THREE.Vector2(r, y))).getPoints(30);
  return new THREE.LatheGeometry([...outer, new THREE.Vector2(R * 0.9, 0.012 * H), new THREE.Vector2(R * 0.82, 0.08 * H)], seg);
}
// bell radius at height y (matches bellGeo's spline closely enough to seat things on it)
const bellR = (H, R, y) => {
  const u = clamp(y / H, 0, 1);
  const pts = [[0, 1], [0.12, 0.86], [0.3, 0.7], [0.52, 0.6], [0.74, 0.57], [0.9, 0.52], [1, 0]];
  for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const [a, ra] = pts[i - 1], [b, rb] = pts[i]; return R * (ra + (rb - ra) * (u - a) / (b - a)); }
  return 0;
};
// an ear-trumpet along +y: a thin stem flaring into a wide mouth
function hornGeo(len, mouth, seg = 16) {
  const stem = mouth * 0.24, pts = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(new THREE.Vector2(stem + (mouth - stem) * u ** 3.4, u * len)); }
  pts.push(new THREE.Vector2(mouth * 0.88, len * 0.97));
  return new THREE.LatheGeometry(pts, seg);
}
function gearGeo(r, teeth = 10, depth = 0.07, hole = 0) {
  const s = new THREE.Shape(), r0 = r * 0.84, r1 = r * 1.0;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU, w = TAU / teeth;
    [[r0, a], [r1, a + w * 0.12], [r1, a + w * 0.44], [r0, a + w * 0.56]].forEach(([rad, ang], j) => {
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      if (!i && !j) s.moveTo(x, y); else s.lineTo(x, y);
    });
  }
  s.closePath();
  if (hole) { const p = new THREE.Path(); p.absarc(0, 0, hole, 0, TAU, true); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: depth * 0.2, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}
function typewriter(k, body = 0x2f6f6a) {
  const g = new THREE.Group(), ivory = k.M(0xfff6e6), dark = k.M(0x2b2233), steel = k.M(0xd8d0c0, { r: 0.5, metal: 0.2 });
  add(g, rbox(0.62, 0.16, 0.46, 0.06), k.M(body), 0, 0.08, 0);
  const bed = add(g, rbox(0.56, 0.07, 0.3, 0.03), k.M(dim(body, 0.75)), 0, 0.18, 0.06); bed.rotation.x = 0.3;
  const key = new THREE.CylinderGeometry(0.026, 0.028, 0.03, 10);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 7 - (row === 2); i++) add(g, key, ivory, -0.21 + i * 0.07 + row * 0.02, 0.215 + row * 0.03, 0.15 - row * 0.075);
  add(g, rbox(0.3, 0.025, 0.05, 0.012), ivory, 0, 0.19, 0.2);
  add(g, rbox(0.66, 0.12, 0.14, 0.05), k.M(body), 0, 0.24, -0.16);
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.72, 14), dark, 0, 0.31, -0.16).rotation.z = PI / 2;
  for (const sx of [-1, 1]) add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12), steel, sx * 0.39, 0.31, -0.16).rotation.z = PI / 2;
  const paper = add(g, new THREE.PlaneGeometry(0.4, 0.34), k.M(0xfffdf6, { side: DS }), 0, 0.47, -0.2); paper.rotation.x = -0.25;
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), steel, -0.4, 0.37, -0.1).rotation.z = 0.9;
  return g;
}
function stool(k, { wood = 0xb07a48, h = 0.5, r = 0.27 } = {}) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(r, r * 0.95, 0.08, 18), k.M(wood), 0, h, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    const leg = add(g, new THREE.CylinderGeometry(0.03, 0.036, h, 6), k.M(dim(wood, 0.8)), Math.cos(a) * r * 0.6, h / 2, Math.sin(a) * r * 0.6);
    leg.rotation.set(Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14);
  }
  return g;
}
// a little hourglass (glass cones, wooden caps and posts), its neck at the origin
function hourglass(k, { h = 0.6, r = 0.2, wood = 0xc8956a } = {}) {
  const g = new THREE.Group(), glass = k.M(0xdff8ff, { r: 0.1, opacity: 0.38, side: DS }), wm = k.M(wood);
  for (const sy of [1, -1]) {
    const c = add(g, new THREE.CylinderGeometry(sy > 0 ? r : r * 0.12, sy > 0 ? r * 0.12 : r, h * 0.42, 20, 1, true), glass, 0, sy * h * 0.21, 0);
    c.renderOrder = 2;
    add(g, new THREE.CylinderGeometry(r * 1.2, r * 1.2, h * 0.08, 20), wm, 0, sy * (h * 0.42 + h * 0.04), 0);
  }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; add(g, new THREE.CylinderGeometry(r * 0.08, r * 0.08, h * 0.84, 6), wm, Math.cos(a) * r * 1.05, 0, Math.sin(a) * r * 1.05); }
  return g;
}
function shadows(root) {
  root.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
}

// ---------- the Listening Bell (Attendale's hilltop) ----------
function listeningBellTower() {
  const k = kit(), root = new THREE.Group(); root.name = 'listening-bell';
  const WOOD = 0xb27a4a, WOOD_D = 0x86573a, BRASS = 0xf0bf45, TEAL = 0x3cc0ad, ROOF = 0xd8574a;
  const brass = k.M(BRASS, { r: 0.42, metal: 0.25 }), brassD = k.M(dim(BRASS, 0.78), { r: 0.45, metal: 0.25 });

  // platform, posts, beam, little roof, pennant
  add(root, rbox(2.3, 0.3, 1.8, 0.1), k.M(WOOD_D), 0, 0.15, 0);
  for (let i = 0; i < 5; i++) add(root, rbox(0.42, 0.04, 1.72, 0.02), k.M(WOOD), -0.92 + i * 0.46, 0.31, 0);
  for (const sx of [-1, 1]) {
    add(root, rbox(0.26, 3.95, 0.26, 0.07), k.M(WOOD), sx * 0.92, 2.3, -0.3);
    add(root, rbox(0.42, 0.16, 0.42, 0.05), k.M(WOOD_D), sx * 0.92, 0.39, -0.3);
    const brace = add(root, rbox(0.12, 1.05, 0.12, 0.04), k.M(WOOD_D), sx * 0.66, 3.82, -0.3); brace.rotation.z = sx * 0.75;
  }
  add(root, rbox(2.45, 0.3, 0.46, 0.08), k.M(WOOD_D), 0, 4.33, -0.3);
  const rs = new THREE.Shape(); rs.moveTo(-1.55, 0); rs.lineTo(0, 1.0); rs.lineTo(1.55, 0); rs.closePath();
  add(root, new THREE.ExtrudeGeometry(rs, { depth: 0.82, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2 }), k.M(ROOF), 0, 4.5, -0.71);
  for (const sx of [-1, 1]) for (const z of [0.2, -0.8]) { const trim = add(root, rbox(1.98, 0.13, 0.07, 0.03), k.M(0xfff1dc), sx * 0.8, 5.04, z); trim.rotation.z = -sx * 0.573; }
  add(root, new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), k.M(WOOD_D), 0, 5.88, -0.3);
  const pen = new THREE.Shape(); pen.moveTo(0, 0); pen.lineTo(0.6, -0.13); pen.lineTo(0, -0.27); pen.closePath();
  const flag = add(root, new THREE.ShapeGeometry(pen), k.M(0xff7ab8, { side: DS }), 0.03, 6.28, -0.3);

  // the bell on a pivot under the beam (bell origin at its lip)
  const H = 1.42, R = 0.74;
  const pivot = grp(root, 0, 4.18, -0.3);
  add(pivot, new THREE.TorusGeometry(0.12, 0.035, 8, 18), brassD, 0, -0.08, 0);
  const bellG = grp(pivot, 0, -1.72, 0);
  add(bellG, bellGeo(H, R), k.M(BRASS, { r: 0.42, metal: 0.25, side: DS }), 0, 0, 0);
  add(bellG, new THREE.TorusGeometry(R * 0.985, 0.055, 8, 44), brassD, 0, 0.02, 0).rotation.x = PI / 2;
  add(bellG, new THREE.TorusGeometry(bellR(H, R, H * 0.62) * 1.0, 0.03, 8, 40), brassD, 0, H * 0.62, 0).rotation.x = PI / 2;
  add(bellG, rbox(0.42, 0.2, 0.3, 0.06), k.M(WOOD_D), 0, H + 0.05, 0);
  add(bellG, teardropGeo(0.5, 0.14), brassD, 0, H * 0.58, 0);
  // eight teal ear-trumpets around the waist; asleep they droop, awake they point out at the village
  const ears = [];
  const waistY = H * 0.36, waistR = bellR(H, R, waistY) * 0.92;
  for (let i = 0; i < 8; i++) {
    const holder = grp(bellG, 0, waistY, 0); holder.rotation.y = (i / 8) * TAU + PI / 8;
    const ear = grp(holder, 0, 0, waistR);
    const mat = k.own(TEAL, { r: 0.6, em: 0x6ff7e6, ei: 0, side: DS });
    add(ear, hornGeo(0.46, 0.18), mat, 0, 0, 0).rotation.x = PI / 2;
    add(ear, new THREE.TorusGeometry(0.17, 0.022, 6, 18), k.M(dim(TEAL, 0.7)), 0, 0, 0.45);
    ears.push({ ear, mat, phase: i });
  }

  // the open gearbox at its base: two empty sockets, ONE EAR and MANY EARS
  const box = grp(root, -0.5, 0.33, 0.38);
  add(box, rbox(1.0, 0.74, 0.62, 0.07), k.M(0xa47048), 0, 0.37, 0);
  add(box, new THREE.PlaneGeometry(0.86, 0.6), k.M(0x3a2a22), 0, 0.39, 0.312);
  const door = grp(box, -0.46, 0.39, 0.33); door.rotation.y = -2.0;
  add(door, rbox(0.86, 0.6, 0.05, 0.03), k.M(0xc79466), 0.43, 0, 0);
  const sockets = [];
  for (const [sx, text] of [[-0.21, 'ONE EAR'], [0.21, 'MANY EARS']]) {
    add(box, new THREE.TorusGeometry(0.12, 0.028, 8, 24), brass, sx, 0.5, 0.33);
    add(box, new THREE.CircleGeometry(0.1, 20), k.M(0x15100c), sx, 0.5, 0.318);
    add(box, new THREE.PlaneGeometry(0.38, 0.13), new THREE.MeshBasicMaterial({ map: labelTex(text), transparent: true }), sx, 0.24, 0.322);
    const gear = add(box, gearGeo(0.105, 9, 0.05, 0.025), brass, sx, 0.5, 0.36); gear.scale.setScalar(0.001);
    sockets.push(gear);
  }
  // a little typewriter on a stool
  const st = stool(k); st.position.set(0.62, 0.32, 0.48); root.add(st);
  const tw = typewriter(k); tw.position.set(0.62, 0.86, 0.5); tw.rotation.y = -0.35; tw.scale.setScalar(0.9); root.add(tw);
  shadows(root);

  let awake = 0, awakeTo = 0, ring = 0, t0 = 0;
  root.userData = {
    radius: 1.1,
    setAwake(on, now = false) { awakeTo = on ? 1 : 0; if (now) awake = awakeTo; },
    celebrate() { ring = 1; awakeTo = 1; },
    update(dt, t) {
      t0 = t;
      awake += (awakeTo - awake) * Math.min(1, dt * 2.2);
      ring = Math.max(0, ring - dt / 3.2);
      const swing = Math.sin(t * 1.3) * 0.025 + Math.sin(t * 9) * 0.32 * ring * ring;
      pivot.rotation.z = swing; pivot.rotation.x = Math.sin(t * 0.9) * 0.012;
      flag.rotation.y = Math.sin(t * 2.4) * 0.35;
      for (const e of ears) {
        const droop = 0.95 * (1 - ease(clamp(awake, 0, 1)));
        e.ear.rotation.x = droop - 0.12 + Math.sin(t * 2 + e.phase) * 0.04 * awake;
        const wave = ring > 0 ? Math.max(0, Math.sin(t * 6 - e.phase * 0.8)) * ring : 0;
        e.mat.emissiveIntensity = 0.32 * awake + 0.9 * wave + Math.sin(t * 3 + e.phase) * 0.06 * awake;
      }
      sockets.forEach((g, i) => { const s = Math.max(0.001, ease(clamp(awake * 1.4 - i * 0.3, 0, 1))); g.scale.setScalar(s); g.rotation.z += dt * (i ? -1.6 : 1.2) * awake; });
    },
  };
  return root;
}

// ---------- the Twin Lens (Pairadise's hilltop) ----------
function twinLensTower() {
  const k = kit(), root = new THREE.Group(); root.name = 'twin-lens';
  const BRASS = 0xe2b04a, TURQ = 0x3fd6d0;
  const brass = k.M(BRASS, { r: 0.38, metal: 0.3 }), brassD = k.M(dim(BRASS, 0.75), { r: 0.42, metal: 0.3 });

  // driftwood plinth with a rope
  add(root, new THREE.CylinderGeometry(1.0, 1.12, 0.46, 22), k.M(0xd8c39a), 0, 0.23, 0);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; const plank = add(root, rbox(0.42, 0.44, 0.08, 0.03), k.M(0xbfa47a), Math.sin(a) * 1.07, 0.23, Math.cos(a) * 1.07); plank.rotation.y = a; }
  add(root, new THREE.TorusGeometry(1.09, 0.055, 8, 44), k.M(0xc9a26a), 0, 0.36, 0).rotation.x = PI / 2;
  // the barrel: three telescoping sections, leaning back a touch
  const barrel = grp(root, 0, 0.46, -0.15); barrel.rotation.x = -0.07;
  let y = 0;
  for (const [r, h] of [[0.46, 1.25], [0.4, 1.0], [0.34, 0.85]]) {
    add(barrel, new THREE.CylinderGeometry(r * 0.97, r, h, 28), brass, 0, y + h / 2, 0);
    add(barrel, new THREE.TorusGeometry(r * 1.02, 0.055, 8, 32), brassD, 0, y + h - 0.03, 0).rotation.x = PI / 2;
    y += h;
  }
  // a tiny dial with a red pin
  const dial = grp(barrel, 0, 2.55, 0.37); dial.rotation.x = 0.07;
  add(dial, new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20), k.M(0xfff6e6), 0, 0, 0).rotation.x = PI / 2;
  add(dial, new THREE.TorusGeometry(0.16, 0.02, 6, 20), brassD, 0, 0, 0.02);
  const pin = grp(dial, 0, 0, 0.035); add(pin, rbox(0.03, 0.13, 0.015, 0.007), k.M(0xe8423a), 0, 0.055, 0);
  // the open panel with two blank gears
  const panel = grp(barrel, 0, 1.15, 0.43); panel.rotation.x = 0.07;
  add(panel, rbox(0.62, 0.42, 0.06, 0.03), k.M(0x3a2a22), 0, 0, 0);
  const pdoor = grp(panel, 0.31, 0, 0.04); pdoor.rotation.y = 1.9; add(pdoor, rbox(0.62, 0.42, 0.04, 0.02), brass, -0.31, 0, 0);
  const blanks = [];
  for (const sx of [-0.14, 0.14]) {
    const mat = k.own(0xe9d9b0, { r: 0.5, metal: 0.15, em: TURQ, ei: 0 });
    const gear = add(panel, gearGeo(0.13, 10, 0.05, 0.03), mat, sx, 0, 0.06); blanks.push({ gear, mat });
  }
  // the fork: two arms, a round eye (a photo) and a square eye (a caption card), a thread between them
  const fork = grp(barrel, 0, y, 0);
  add(fork, new THREE.SphereGeometry(0.4, 22, 16), brass, 0, 0.04, 0);
  const eyes = [], centers = [];
  for (const side of [-1, 1]) {
    const arm = grp(fork, 0, 0.05, 0); arm.rotation.z = -side * 0.62;
    add(arm, new THREE.CylinderGeometry(0.2, 0.27, 1.0, 20), brass, 0, 0.5, 0);
    const holder = grp(arm, 0, 1.08, 0); holder.rotation.z = side * 0.62;
    const glow = k.own(0xffffff, { r: 0.6, em: 0xffffff, ei: 0.25, map: side < 0 ? photoTex() : captionTex() });
    if (side < 0) {
      add(holder, new THREE.CylinderGeometry(0.55, 0.5, 0.4, 32, 1, true), brass, 0, 0, 0).rotation.x = PI / 2;
      add(holder, new THREE.TorusGeometry(0.55, 0.07, 10, 36), brassD, 0, 0, 0.2);
      add(holder, new THREE.CircleGeometry(0.5, 32), glow, 0, 0, 0.12);
      add(holder, new THREE.CircleGeometry(0.5, 32), k.M(0x5a4a2a), 0, 0, -0.18).rotation.y = PI;
    } else {
      add(holder, rbox(1.06, 1.06, 0.38, 0.1), brass, 0, 0, -0.02);
      add(holder, frameGeo(1.12, 1.12, 0.12, 0.13, 0.08), brassD, 0, 0, 0.19);
      add(holder, new THREE.PlaneGeometry(0.86, 0.86), glow, 0, 0, 0.18);
    }
    eyes.push({ holder, glow });
    centers.push(holder);
  }
  // the turquoise thread looping from eye to eye (built in root space once the eyes are placed)
  root.updateMatrixWorld(true);
  const P = (o, x, y2, z) => root.worldToLocal(o.localToWorld(new THREE.Vector3(x, y2, z)));
  // pinned from the middle of the photo to the middle of the card, sagging in front of the fork
  const a = P(centers[0], 0.08, -0.06, 0.32), b = P(centers[1], -0.1, -0.08, 0.3);
  const sag = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.42, 0.3));
  const threadMat = k.own(TURQ, { r: 0.5, em: TURQ, ei: 0.45 });
  add(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, a.clone().lerp(sag, 0.5).add(new THREE.Vector3(0, -0.1, 0.05)), sag, b.clone().lerp(sag, 0.5).add(new THREE.Vector3(0, -0.1, 0.05)), b]), 48, 0.04, 8), threadMat, 0, 0, 0);
  for (const p of [a, b]) add(root, new THREE.SphereGeometry(0.075, 12, 10), k.M(0xe8423a, { r: 0.5 }), p.x, p.y, p.z);
  // a typewriter on a driftwood stool
  const st = stool(k, { wood: 0xbfa47a, h: 0.42 }); st.position.set(0.55, 0.46, 0.5); root.add(st);
  const tw = typewriter(k, 0x2e5f7a); tw.position.set(0.55, 0.92, 0.52); tw.rotation.y = -0.4; tw.scale.setScalar(0.85); root.add(tw);
  shadows(root);

  let awake = 0, awakeTo = 0, flash = 0;
  root.userData = {
    radius: 1.15,
    setAwake(on, now = false) { awakeTo = on ? 1 : 0; if (now) awake = awakeTo; },
    celebrate() { flash = 1; awakeTo = 1; },
    update(dt, t) {
      awake += (awakeTo - awake) * Math.min(1, dt * 2.2);
      flash = Math.max(0, flash - dt / 3);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
      threadMat.emissiveIntensity = 0.25 + 0.55 * awake * pulse + 1.4 * flash * Math.max(0, Math.sin(t * 10));
      eyes.forEach((e, i) => {
        e.glow.emissiveIntensity = 0.18 + 0.5 * awake + 0.5 * flash;
        const blink = flash > 0 ? 1 + 0.06 * Math.sin(t * 12 + i * PI) * flash : 1;
        e.holder.scale.setScalar(blink);
      });
      blanks.forEach((g, i) => { g.mat.emissiveIntensity = 0.45 * awake; g.gear.rotation.z += dt * (i ? -1.4 : 1.4) * awake; });
      pin.rotation.z = Math.sin(t * 0.7) * 0.5 + awake * Math.sin(t * 3) * 0.3;
    },
  };
  return root;
}

// ---------- the Belly Scanner (Siftsand's terrace) ----------
function bellyScanner() {
  const k = kit(), root = new THREE.Group(); root.name = 'belly-scanner';
  const GREEN = 0x63b86a, GREEN_D = 0x4a9a55, MOUTH = 0xb8405a, PINK = 0xff8fa8, SAND = 0xe9cf93;
  const green = k.M(GREEN), greenD = k.M(GREEN_D);
  // lower jaw, cheeks, back of the throat
  add(root, rbox(1.8, 0.46, 1.32, 0.2), green, 0, 0.23, 0);
  add(root, rbox(1.46, 0.06, 1.0, 0.03), k.M(PINK), 0, 0.47, 0.05);
  for (let i = 0; i < 5; i++) add(root, rbox(0.3, 0.3, 0.06, 0.08), k.M(0xf3e6b8), -0.64 + i * 0.32, 0.24, 0.66);
  for (const sx of [-1, 1]) add(root, rbox(0.24, 1.42, 1.18, 0.1), green, sx * 0.8, 1.12, -0.05);
  add(root, rbox(1.5, 1.4, 0.12, 0.05), k.M(MOUTH), 0, 1.15, -0.58);
  // sand-coloured screen + the typewriter slot
  const beadTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#e9cf93'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(160,120,60,.35)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc((i * 37) % w, (i * 23) % h, 2, 0, TAU); g.fill(); }
    const cols = ['#d6304a', '#3a68d6', '#2fae5a', '#f0a830'];
    g.strokeStyle = 'rgba(120,80,40,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    for (let i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.beginPath(); g.arc(w * (0.125 + i * 0.25), h / 2, h * 0.17, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(w * (0.125 + i * 0.25) - 4, h / 2 - 4, 3, 0, TAU); g.fill(); }
  });
  beadTex.wrapS = THREE.RepeatWrapping;
  const screenMat = k.own(0xffffff, { r: 0.85, map: beadTex, em: 0xfff0c8, ei: 0 });
  const blank = k.M(SAND, { r: 0.9 });
  add(root, rbox(1.12, 0.68, 0.06, 0.04), k.M(0x8a5a36), 0, 1.3, -0.5);
  const screen = add(root, new THREE.PlaneGeometry(1.0, 0.56), blank, 0, 1.3, -0.415);
  add(root, rbox(0.74, 0.1, 0.08, 0.03), k.M(0x2b1a20), 0, 0.82, -0.5);
  const slip = add(root, new THREE.PlaneGeometry(0.42, 0.22), k.M(0xfffdf6, { side: DS }), 0, 0.92, -0.47);
  // upper jaw: a big rounded head with fangs, nostrils and two eyes on top
  const head = add(root, new THREE.SphereGeometry(1, 30, 18, 0, TAU, 0, PI / 2), green, 0, 1.82, -0.02); head.scale.set(1.0, 0.62, 0.78);
  add(root, rbox(1.84, 0.16, 1.5, 0.08), greenD, 0, 1.84, -0.02);
  for (const sx of [-1, 1]) {
    add(root, new THREE.ConeGeometry(0.09, 0.3, 10), k.M(0xfffdf6), sx * 0.52, 1.62, 0.6).rotation.x = PI;
    add(root, new THREE.SphereGeometry(0.04, 8, 6), k.M(0x2b2233), sx * 0.18, 2.12, 0.62);
    const eye = grp(root, sx * 0.5, 2.28, 0.3);
    add(eye, new THREE.SphereGeometry(0.24, 18, 14), green, 0, 0, 0);
    add(eye, new THREE.SphereGeometry(0.19, 16, 12), k.M(0xfffdf6), 0, 0.03, 0.1);
    const pupil = add(eye, new THREE.SphereGeometry(0.1, 12, 10), k.M(0x2b2233), 0, 0.03, 0.24); pupil.scale.set(0.6, 1.2, 0.5);
    add(eye, new THREE.SphereGeometry(0.03, 8, 6), k.M(0xffffff, { em: 0xffffff, ei: 0.6 }), 0.03, 0.08, 0.28);
  }
  // a forked tongue on the floor of the mouth
  const tongue = grp(root, 0, 0.51, 0.0);
  add(tongue, rbox(0.14, 0.035, 0.7, 0.017), k.M(0xe8506a), 0, 0, 0.3);
  for (const sx of [-1, 1]) { const f = add(tongue, rbox(0.05, 0.03, 0.3, 0.014), k.M(0xe8506a), sx * 0.07, 0, 0.75); f.rotation.y = sx * 0.45; }
  // a row of tiny empty hourglasses along the top, one per belly pocket
  add(root, rbox(1.36, 0.08, 0.3, 0.03), k.M(0xb07a48), 0, 2.42, -0.28);
  const pockets = [];
  [0xd6304a, 0x3a68d6, 0x2fae5a, 0xf0a830].forEach((c, i) => {
    const hg = hourglass(k, { h: 0.42, r: 0.12 }); hg.position.set(-0.48 + i * 0.32, 2.67, -0.28); root.add(hg);
    const bead = add(hg, new THREE.SphereGeometry(0.065, 12, 10), k.M(c, { r: 0.4 }), 0, -0.12, 0); bead.scale.setScalar(0.001);
    pockets.push({ hg, bead });
  });
  // the crank on the right cheek
  const crank = grp(root, 0.95, 1.1, 0.1);
  add(crank, new THREE.TorusGeometry(0.22, 0.04, 8, 20), k.M(0xb07a48), 0, 0, 0).rotation.y = PI / 2;
  for (let i = 0; i < 3; i++) add(crank, rbox(0.03, 0.42, 0.03, 0.01), k.M(0xb07a48), 0, 0, 0).rotation.x = (i / 3) * PI;
  add(crank, new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), k.M(0x8a5a36), 0.11, 0.2, 0).rotation.z = PI / 2;
  add(crank, new THREE.SphereGeometry(0.06, 10, 8), k.M(0xe8423a), 0.22, 0.2, 0);
  shadows(root);

  let awake = 0, awakeTo = 0, party = 0, nextFlick = 2;
  root.userData = {
    radius: 0.9,
    setAwake(on, now = false) { awakeTo = on ? 1 : 0; if (now) awake = awakeTo; screen.material = awakeTo ? screenMat : blank; },
    celebrate() { party = 1; root.userData.setAwake(true); },
    update(dt, t) {
      awake += (awakeTo - awake) * Math.min(1, dt * 2);
      party = Math.max(0, party - dt / 3.5);
      crank.rotation.x -= dt * (0.4 * awake + 6 * party);
      beadTex.offset.x = (beadTex.offset.x + dt * 0.12 * awake) % 1;
      screenMat.emissiveIntensity = 0.12 + 0.05 * Math.sin(t * 4);
      slip.position.y = 0.92 + Math.sin(t * 1.5) * 0.015;
      pockets.forEach((p, i) => {
        p.bead.scale.setScalar(Math.max(0.001, ease(clamp(awake * 1.6 - i * 0.2, 0, 1))));
        p.hg.rotation.z = party > 0 ? Math.min(PI, (1 - party) * PI * 2.2 - i * 0.3) * (party > 0.05 ? 1 : 0) : 0;
      });
      nextFlick -= dt;
      if (nextFlick < 0) { nextFlick = 2.5 + (Math.sin(t * 13.7) + 1) * 1.5; }
      const flick = nextFlick < 0.35 ? Math.sin((nextFlick / 0.35) * PI) : 0;
      tongue.position.z = 0.25 + flick * 0.25 + party * Math.abs(Math.sin(t * 9)) * 0.2;
    },
  };
  return root;
}

const LANDMARKS = { 'attention/bell': listeningBellTower, 'clip/lens': twinLensTower, 'mamba/scanner': bellyScanner };
export function buildLandmark(regionId, stationId) {
  const make = LANDMARKS[`${regionId}/${stationId}`];
  return make ? make() : null;
}

// ---------- the artefacts ----------
// The Listening Bell: a small brass-yellow bell, eight teal ear-trumpets, a teardrop clapper and a
// pull-rope of two twisted threads (pink sine, sky-blue cosine) ending in a tassel.
function listeningBellRelic() {
  const k = kit(), root = new THREE.Group(); root.name = 'relic-listening-bell';
  const BRASS = 0xf2c14e, TEAL = 0x3cc0ad;
  const H = 0.62, R = 0.34;
  const wobble = grp(root, 0, 0.36, 0);
  const bell = grp(wobble, 0, -0.3, 0);
  add(bell, bellGeo(H, R), k.M(BRASS, { r: 0.42, metal: 0.25, side: DS, em: 0xffb030, ei: 0.12 }), 0, 0, 0);
  add(bell, new THREE.TorusGeometry(R * 0.98, 0.03, 8, 36), k.M(dim(BRASS, 0.78), { r: 0.45, metal: 0.25 }), 0, 0.012, 0).rotation.x = PI / 2;
  add(bell, new THREE.TorusGeometry(0.07, 0.022, 8, 16), k.M(dim(BRASS, 0.78), { r: 0.45, metal: 0.25 }), 0, H + 0.05, 0);
  add(bell, teardropGeo(0.24, 0.065), k.M(0xfff1c8, { r: 0.5 }), 0, H * 0.58, 0);
  const ears = [];
  const waistY = H * 0.42, waistR = bellR(H, R, waistY) * 0.92;
  for (let i = 0; i < 8; i++) {
    const holder = grp(bell, 0, waistY, 0); holder.rotation.y = (i / 8) * TAU;
    const ear = grp(holder, 0, 0, waistR); ear.rotation.x = -0.1;
    const mat = k.own(TEAL, { r: 0.6, em: 0x6ff7e6, ei: 0.15, side: DS });
    add(ear, hornGeo(0.2, 0.075), mat, 0, 0, 0).rotation.x = PI / 2;
    ears.push(mat);
  }
  // the pull-rope: two twisted threads below the lip, then a tassel
  const twist = (phase) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const u = i / 20, a = u * TAU * 2.5 + phase; pts.push(new THREE.Vector3(Math.cos(a) * 0.022, -0.02 - u * 0.36, Math.sin(a) * 0.022)); }
    return new THREE.CatmullRomCurve3(pts);
  };
  add(bell, new THREE.TubeGeometry(twist(0), 40, 0.013, 6), k.M(0xff7ab8), 0, 0.02, 0);
  add(bell, new THREE.TubeGeometry(twist(PI), 40, 0.013, 6), k.M(0x6ec6ff), 0, 0.02, 0);
  const tassel = add(bell, new THREE.ConeGeometry(0.055, 0.12, 10), k.M(0xff9ac8), 0, -0.4, 0);
  add(bell, new THREE.SphereGeometry(0.03, 8, 6), k.M(0x6ec6ff), 0, -0.34, 0);
  shadows(root);
  root.userData.update = (dt, t) => {
    wobble.rotation.z = Math.sin(t * 2.1) * 0.08; wobble.rotation.x = Math.sin(t * 1.7) * 0.05;
    tassel.rotation.z = -wobble.rotation.z * 1.5;
    const cyc = (t % 6) / 6; // every few seconds the ears glow one after another, then all together
    ears.forEach((m, i) => {
      const seq = cyc < 0.6 ? Math.max(0, 1 - Math.abs(cyc / 0.6 * 9 - i - 0.5)) : 0;
      const all = cyc > 0.65 && cyc < 0.85 ? Math.sin((cyc - 0.65) / 0.2 * PI) : 0;
      m.emissiveIntensity = 0.12 + 0.75 * seq + 0.6 * all;
    });
  };
  return root;
}

// The Twin Lens: a small brass spyglass forking into two eyepieces, a round one (a turquoise photo) and a
// square one (a cream caption card), a glowing thread looping between them, a tiny dial with a red pin.
function twinLensRelic() {
  const k = kit(), root = new THREE.Group(); root.name = 'relic-twin-lens';
  const BRASS = 0xe2b04a, TURQ = 0x3fd6d0;
  const brass = k.M(BRASS, { r: 0.38, metal: 0.3, em: 0xb07a10, ei: 0.08 }), brassD = k.M(dim(BRASS, 0.75), { r: 0.42, metal: 0.3 });
  const body = grp(root, 0, -0.48, 0);
  add(body, new THREE.CylinderGeometry(0.1, 0.12, 0.42, 20), brass, 0, 0.21, 0);
  add(body, new THREE.TorusGeometry(0.11, 0.022, 6, 20), brassD, 0, 0.42, 0).rotation.x = PI / 2;
  add(body, new THREE.CylinderGeometry(0.085, 0.1, 0.18, 20), brass, 0, 0.5, 0);
  const dial = grp(body, 0, 0.24, 0.115);
  add(dial, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), k.M(0xfff6e6), 0, 0, 0).rotation.x = PI / 2;
  add(dial, rbox(0.012, 0.045, 0.008, 0.004), k.M(0xe8423a), 0, 0.018, 0.012);
  add(body, new THREE.SphereGeometry(0.12, 16, 12), brass, 0, 0.6, 0);
  const holders = [];
  for (const side of [-1, 1]) {
    const arm = grp(body, 0, 0.6, 0); arm.rotation.z = -side * 0.62;
    add(arm, new THREE.CylinderGeometry(0.06, 0.08, 0.32, 14), brass, 0, 0.16, 0);
    const holder = grp(arm, 0, 0.36, 0); holder.rotation.z = side * 0.62;
    const glow = k.own(0xffffff, { r: 0.6, em: 0xffffff, ei: 0.35, map: side < 0 ? photoTex() : captionTex() });
    if (side < 0) {
      add(holder, new THREE.CylinderGeometry(0.17, 0.15, 0.12, 24, 1, true), brass, 0, 0, 0).rotation.x = PI / 2;
      add(holder, new THREE.TorusGeometry(0.17, 0.025, 8, 24), brassD, 0, 0, 0.06);
      add(holder, new THREE.CircleGeometry(0.155, 24), glow, 0, 0, 0.04);
      add(holder, new THREE.CircleGeometry(0.155, 24), glow, 0, 0, -0.05).rotation.y = PI;
    } else {
      add(holder, rbox(0.32, 0.32, 0.11, 0.03), brass, 0, 0, 0);
      add(holder, frameGeo(0.34, 0.34, 0.04, 0.045, 0.03), brassD, 0, 0, 0.06);
      add(holder, new THREE.PlaneGeometry(0.26, 0.26), glow, 0, 0, 0.058);
      add(holder, new THREE.PlaneGeometry(0.26, 0.26), glow, 0, 0, -0.058).rotation.y = PI;
    }
    holders.push(holder);
  }
  root.updateMatrixWorld(true);
  const P = (o, x, y, z) => root.worldToLocal(o.localToWorld(new THREE.Vector3(x, y, z)));
  const a = P(holders[0], 0.1, 0.13, 0.03), b = P(holders[1], -0.13, 0.15, 0.03);
  const top = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.12, 0.06));
  const threadMat = k.own(TURQ, { r: 0.5, em: TURQ, ei: 0.6 });
  add(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, top, b]), 24, 0.018, 6), threadMat, 0, 0, 0);
  for (const p of [a, b]) add(root, new THREE.SphereGeometry(0.028, 8, 6), threadMat, p.x, p.y, p.z);
  shadows(root);
  root.userData.update = (dt, t) => { threadMat.emissiveIntensity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3)); };
  return root;
}

// The Sifting Hourglass: clear glass cones, warm wooden caps, golden sand, a green paper snake coiled
// round the top cap with its head raised. Sand trickles, the neck pinches shut, a coloured bead drops through.
function siftingHourglassRelic() {
  const k = kit(), root = new THREE.Group(); root.name = 'relic-sifting-hourglass';
  const h = 0.86, r = 0.27, GREEN = 0x7fdc5a;
  const hg = hourglass(k, { h, r }); root.add(hg);
  const sandM = k.M(0xf3cf88, { r: 0.9 });
  const pile = add(hg, new THREE.ConeGeometry(r * 0.8, h * 0.16, 18), sandM, 0, -h * 0.34, 0);
  const upper = add(hg, new THREE.CylinderGeometry(r * 0.46, r * 0.13, h * 0.16, 18), sandM, 0, h * 0.1, 0);
  const stream = add(hg, new THREE.CylinderGeometry(0.012, 0.012, h * 0.3, 6), sandM, 0, -h * 0.15, 0);
  const neck = add(hg, new THREE.TorusGeometry(0.038, 0.016, 6, 16), k.M(0xc8956a), 0, 0, 0); neck.rotation.x = PI / 2;
  const beadCols = [0xd6304a, 0x3a68d6, 0x2fae5a];
  const bead = add(hg, new THREE.SphereGeometry(0.045, 12, 10), k.own(beadCols[0], { r: 0.35, em: beadCols[0], ei: 0.25 }), 0, h * 0.2, 0);
  // the snake: a tapered coil around the top cap, head raised
  const capY = h * 0.46;
  const pts = [];
  for (let i = 0; i <= 26; i++) { const u = i / 26, a = u * TAU * 1.25 - 0.4; const rad = r * 1.28 - u * 0.02; pts.push(new THREE.Vector3(Math.cos(a) * rad, capY - 0.02 + u * 0.07, Math.sin(a) * rad)); }
  const last = pts[pts.length - 1];
  pts.push(new THREE.Vector3(last.x * 0.9, last.y + 0.1, last.z * 0.9 + 0.04), new THREE.Vector3(last.x * 0.8, last.y + 0.2, last.z * 0.8 + 0.08));
  const curve = new THREE.CatmullRomCurve3(pts);
  const snakeM = k.M(GREEN, { r: 0.7 });
  hg.add(new THREE.Mesh(taperTubeGeo(curve, (u) => 0.012 + 0.032 * smooth(0, 0.25, u) - 0.008 * smooth(0.85, 1, u), 60, 10), snakeM));
  const tip = curve.getPointAt(1), dir = curve.getTangentAt(1);
  const headG = grp(hg, tip.x, tip.y, tip.z);
  add(headG, new THREE.SphereGeometry(0.055, 14, 10), snakeM, 0, 0, 0).scale.set(1, 0.8, 1.25);
  aim(headG, new THREE.Vector3(dir.x * 0.3, 1, dir.z * 0.3 + 0.4));
  for (const sx of [-1, 1]) { add(headG, new THREE.SphereGeometry(0.014, 8, 6), k.M(0x2b2233), sx * 0.03, 0.025, 0.04); }
  add(headG, rbox(0.012, 0.004, 0.06, 0.002), k.M(0xe8423a), 0, -0.01, 0.07);
  shadows(root);
  root.userData.update = (dt, t) => {
    // a 5 s cycle: sand trickles, the neck pinches and the trickle stops, then a bead drops through
    const c = (t % 5) / 5;
    const trickle = c < 0.45, pinch = c >= 0.45 && c < 0.6;
    stream.visible = trickle;
    stream.scale.x = stream.scale.z = 0.8 + Math.sin(t * 30) * 0.2;
    neck.scale.setScalar(pinch ? 1 - 0.4 * Math.sin(((c - 0.45) / 0.15) * PI) : 1);
    pile.scale.y = 0.8 + 0.2 * Math.sin(t * 0.2);
    upper.scale.y = 0.9 + 0.1 * Math.cos(t * 0.2);
    if (c >= 0.6) {
      const u = (c - 0.6) / 0.4;
      bead.visible = true; bead.position.y = h * 0.2 - u * u * h * 0.48;
      const col = beadCols[Math.floor(t / 5) % beadCols.length]; bead.material.color.setHex(col); bead.material.emissive.setHex(col);
    } else bead.visible = false;
  };
  return root;
}

const RELICS = { attention: listeningBellRelic, clip: twinLensRelic, mamba: siftingHourglassRelic };
export function buildRelic(regionId) {
  const make = RELICS[regionId];
  return make ? make() : null;
}
