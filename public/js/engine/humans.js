// Animal Crossing-style humans built from primitives, in the same toy style as villagers.js.
//   buildHuman(params)  the player: feet at y=0, ~1.9 units tall, faces +z
//   buildScientist()    the old scientist model: a normal-sized grumpy man in a lab coat (~9.5 units, ~5x
//                       the Speck). The game shows Becancourt from engine/scientist.js; this one is for /dev pages.
// Character params: see "Character params" in docs/ARCHITECTURE.md. Every builder accepts anything
// and fills missing or invalid fields with defaults (normalizeCharacter).
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// character params

export const HAIR_STYLES = Object.freeze(['short', 'buzz', 'long', 'bob', 'ponytail', 'curly', 'bun', 'spiky', 'afro', 'braids', 'bald']);
export const GLASSES = Object.freeze(['none', 'round', 'square']);
export const FACIAL_HAIR = Object.freeze(['none', 'mustache', 'beard', 'stubble']);
export const TOP_STYLES = Object.freeze(['tee', 'hoodie', 'sweater', 'shirt', 'dress']);
export const ACCESSORIES = Object.freeze(['none', 'cap', 'beanie', 'headband', 'bow', 'earrings']);
export const CHARACTER_ENUMS = Object.freeze({ hairStyle: HAIR_STYLES, glasses: GLASSES, facialHair: FACIAL_HAIR, topStyle: TOP_STYLES, accessory: ACCESSORIES });
export const COLOR_FIELDS = Object.freeze(['skin', 'hairColor', 'eyeColor', 'topColor', 'bottomColor', 'shoeColor']);

// Palettes the creator offers (any #rrggbb is still valid).
export const SKIN_TONES = Object.freeze(['#ffe3d0', '#f8d2b4', '#e8b796', '#d9a27c', '#c68a62', '#a86d48', '#8a5636', '#6a3f28']);
export const HAIR_COLORS = Object.freeze(['#1f1a1f', '#3b2a20', '#6b4426', '#a0622e', '#d2803c', '#e9c46a', '#f3e2b0', '#b9b4b0', '#f4f2ee', '#ff8fc0', '#8a7cff', '#3fb7a8']);
export const EYE_COLORS = Object.freeze(['#3b2a20', '#1e1824', '#3a6fb0', '#3f8a5a', '#8a6a3a', '#7a5ab0']);
export const CLOTH_COLORS = Object.freeze(['#4f86d8', '#e8566a', '#ffd35a', '#3ec7b5', '#ff7ab8', '#b39cff', '#7bcd5d', '#ff9a4a', '#fffdf6', '#8a8f9e', '#3a3a5a', '#6a4a3a', '#2b2233']);
export const SHOE_COLORS = Object.freeze(['#6a4a3a', '#2b2233', '#fffdf6', '#e8566a', '#4f86d8', '#ffd35a', '#3ec7b5']);

export const DEFAULT_CHARACTER = Object.freeze({
  skin: '#e8b796',
  hairStyle: 'short',
  hairColor: '#3b2a20',
  eyeColor: '#3b2a20',
  glasses: 'none',
  facialHair: 'none',
  freckles: false,
  topStyle: 'tee',
  topColor: '#4f86d8',
  bottomColor: '#3a3a5a',
  shoeColor: '#6a4a3a',
  accessory: 'none',
});

export function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

// Accepts anything; returns a complete, valid character. An optional non-empty `name` is kept.
export function normalizeCharacter(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = { ...DEFAULT_CHARACTER };
  for (const field of COLOR_FIELDS) {
    const c = normalizeColor(src[field]);
    if (c) out[field] = c;
  }
  for (const [field, allowed] of Object.entries(CHARACTER_ENUMS)) {
    const v = typeof src[field] === 'string' ? src[field].trim().toLowerCase() : null;
    if (v && allowed.includes(v)) out[field] = v;
  }
  if (typeof src.freckles === 'boolean') out.freckles = src.freckles;
  else if (src.freckles === 'true' || src.freckles === 'false') out.freckles = src.freckles === 'true';
  if (typeof src.name === 'string') {
    const name = src.name.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (name) out.name = name;
  }
  return out;
}

// A random, cute, coherent character (rand: () => [0,1)).
export function randomCharacter(rand = Math.random) {
  const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
  const chance = (p) => rand() < p;
  const topColor = pick(CLOTH_COLORS.slice(0, 9));
  let bottomColor = pick(['#3a3a5a', '#4f86d8', '#6a4a3a', '#2b2233', '#8a8f9e', '#3ec7b5', '#fffdf6', '#e8566a']);
  if (bottomColor === topColor) bottomColor = '#3a3a5a';
  const hairColor = chance(0.85) ? pick(HAIR_COLORS.slice(0, 9)) : pick(HAIR_COLORS.slice(9));
  const topStyle = pick(TOP_STYLES);
  return {
    skin: pick(SKIN_TONES),
    hairStyle: pick(HAIR_STYLES),
    hairColor,
    eyeColor: pick(EYE_COLORS),
    glasses: chance(0.3) ? pick(['round', 'square']) : 'none',
    facialHair: topStyle !== 'dress' && chance(0.22) ? pick(['mustache', 'beard', 'stubble']) : 'none',
    freckles: chance(0.25),
    topStyle,
    topColor,
    bottomColor,
    shoeColor: pick(SHOE_COLORS),
    accessory: chance(0.5) ? pick(ACCESSORIES.slice(1)) : 'none',
  };
}

// ---------------------------------------------------------------------------------------------
// small helpers

const PI = Math.PI;
const TAU = PI * 2;
const DS = THREE.DoubleSide;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// sRGB hex colour maths (perceptual enough for shading and accents)
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(...A.map((v, i) => v + (B[i] - v) * t)); };
const shade = (h, k) => mix(h, k < 0 ? '#000000' : '#ffffff', Math.abs(k));
const cdist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = (seed % 2147483647) || 11;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// piecewise smooth curve through [x, y] pairs (x ascending), flat at the ends
function curve(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const t = (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * t * t * (3 - 2 * t);
      }
    }
    return pts[pts.length - 1][1];
  };
}
// a hairline: polar angle (in units of pi) as a function of |azimuth|, plus an optional extra term
const hairline = (pts, extra) => { const c = curve(pts); return (phi) => (c(Math.abs(phi)) + (extra ? extra(phi) : 0)) * PI; };

// per-model material cache
function materials() {
  const std = new Map(), basic = new Map();
  return {
    std(color, { r = 0.85, side = THREE.FrontSide, flat = false } = {}) {
      const k = `${color}|${r}|${side}|${flat}`;
      if (!std.has(k)) std.set(k, new THREE.MeshStandardMaterial({ color, roughness: r, metalness: 0, side, flatShading: flat }));
      return std.get(k);
    },
    basic(color, opacity = 1) {
      const k = `${color}|${opacity}`;
      if (!basic.has(k)) {
        const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
        if (opacity < 1) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
        basic.set(k, m);
      }
      return basic.get(k);
    },
  };
}

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// point a +y-oriented mesh (cone, capsule) along a direction
function aim(mesh, dir) { mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize()); return mesh; }

// An ellipsoid "frame" (semi-axes ax, ay, az) used to place things on a head.
//   phi: azimuth, 0 = front (+z), +pi/2 = +x.  th: polar angle, 0 = top, pi = bottom.
function ellipsoid(ax, ay, az) {
  return {
    ax, ay, az,
    at(phi, th, k = 1) { const s = Math.sin(th); return new THREE.Vector3(ax * k * s * Math.sin(phi), ay * k * Math.cos(th), az * k * s * Math.cos(phi)); },
    normal(phi, th) { const s = Math.sin(th); return new THREE.Vector3((s * Math.sin(phi)) / ax, Math.cos(th) / ay, (s * Math.cos(phi)) / az).normalize(); },
    z(x, y) { return az * Math.sqrt(Math.max(0, 1 - (x / ax) ** 2 - (y / ay) ** 2)); },
    // put a flat (+z facing) feature on the front surface at (x, y), pushed out by `out`, rolled by `roll`
    put(mesh, x, y, out = 0, roll = 0) {
      const z = this.z(x, y);
      const n = new THREE.Vector3(x / (ax * ax), y / (ay * ay), z / (az * az)).normalize();
      mesh.position.set(x + n.x * out, y + n.y * out, z + n.z * out);
      mesh.rotation.set(-Math.asin(n.y), Math.atan2(n.x, n.z), roll, 'YXZ');
      return mesh;
    },
    scaled(k) { return ellipsoid(ax * k, ay * k, az * k); },
  };
}

// A patch of an (inflated) ellipsoid between a top and a bottom polar angle that may vary with azimuth,
// with a rim folding back inside the head so the shell reads as having thickness. Analytic normals.
function shellGeo(F, { phi0 = -PI, phi1 = PI, top = 0, bottom, k = 1.06, segU = 64, segV = 14, rim = 0.95 }) {
  const topF = typeof top === 'function' ? top : () => top;
  const botF = typeof bottom === 'function' ? bottom : () => bottom;
  const kF = typeof k === 'function' ? k : () => k;
  const pos = [], nor = [], idx = [];
  const push = (phi, th, kk) => { const p = F.at(phi, th, kk), n = F.normal(phi, th); pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); };
  for (let i = 0; i <= segU; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segU;
    const t0 = topF(phi), t1 = botF(phi);
    for (let j = 0; j <= segV; j++) { const th = t0 + ((t1 - t0) * j) / segV; push(phi, th, kF(phi, th)); }
  }
  const R = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) { const a = i * R + j, b = a + R; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  if (rim) {
    const base = pos.length / 3;
    for (let i = 0; i <= segU; i++) {
      const phi = phi0 + ((phi1 - phi0) * i) / segU, th = botF(phi);
      push(phi, th, kF(phi, th)); push(phi, th, rim);
    }
    for (let i = 0; i < segU; i++) { const a = base + i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// Smooth 2D profile [[r, y], ...] -> sampled Vector2 list
const profile = (pts, n = 24) => new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(n);

// Surface of revolution of a profile (Vector2 r,y), squashed in z by sz, optionally open at the
// front by gap(y) radians (lab coat, V-neck). Analytic normals, so no seams.
function revolveGeo(pts, { seg = 40, sz = 1, gap = null } = {}) {
  const pos = [], nor = [], idx = [];
  const n = pts.length;
  for (let j = 0; j < n; j++) {
    const p = pts[j], a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
    const dr = b.x - a.x, dy = b.y - a.y;
    const g = gap ? clamp(gap(p.y), 0, TAU - 0.01) : 0;
    for (let i = 0; i <= seg; i++) {
      const phi = g / 2 + ((TAU - g) * i) / seg;
      const s = Math.sin(phi), c = Math.cos(phi);
      pos.push(p.x * s, p.y, p.x * c * sz);
      const nx = sz * dy * s, ny = -sz * dr, nz = dy * c, L = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / L, ny / L, nz / L);
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// hanging "curtain" of hair below a head ellipse (long hair), over the azimuths [phi0, phi1]
function curtainGeo(F, { phi0, phi1, yTop, yBot, k0 = 1.07, k1 = 1.13, segU = 48, segV = 8 }) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= segU; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segU;
    const s = Math.sin(phi), c = Math.cos(phi);
    const yb = typeof yBot === 'function' ? yBot(phi) : yBot;
    for (let j = 0; j <= segV; j++) {
      const t = j / segV, k = k0 + (k1 - k0) * t, y = yTop + (yb - yTop) * t;
      pos.push(F.ax * k * s, y, F.az * k * c);
      const nx = s / F.ax, nz = c / F.az, L = Math.hypot(nx, nz) || 1;
      nor.push(nx / L, -0.1, nz / L);
    }
  }
  const R = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) { const a = i * R + j, b = a + R; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// teardrop (ponytail, braid tuft) hanging down from its origin
const teardropGeo = (len, rad) => new THREE.LatheGeometry(
  profile([[0, 0], [rad * 0.75, -len * 0.08], [rad, -len * 0.32], [rad * 0.8, -len * 0.62], [rad * 0.35, -len * 0.88], [0, -len]], 20), 20);

// a tube along a curve whose radius follows radius(u), u in [0,1] (ponytail, curls)
function taperTubeGeo(curve, radius, segs = 24, radial = 12) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, P = curve.getPointAt(u), r = Math.max(0.0005, radius(u));
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// thin arm hugging an ellipsoid surface from azimuth phi0 to phi1 at polar angle th (glasses temples)
function surfaceArc(F, phi0, phi1, th, k, radius) {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(F.at(phi0 + ((phi1 - phi0) * i) / 8, th, k));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, radius, 6);
}

function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundRectGeo(w, h, r, depth) {
  const g = new THREE.ExtrudeGeometry(roundRectShape(w, h, r), { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
function frameGeo(w, h, r, t, depth) {
  const s = roundRectShape(w, h, r);
  s.holes.push(roundRectShape(w - 2 * t, h - 2 * t, Math.max(0.002, r - t)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// accessory colour that does not vanish against the top or the hair
function accent(kind, p) {
  const options = {
    cap: ['#e8566a', '#4f86d8', '#ffd35a', '#3ec7b5'],
    beanie: ['#ffd35a', '#e8566a', '#8fd3ff', '#b39cff'],
    headband: ['#ff7ab8', '#ffd35a', '#3ec7b5', '#8fd3ff'],
    bow: ['#ff5a8a', '#ffd35a', '#8fd3ff', '#b39cff'],
    earrings: ['#ffd35a'],
  }[kind] || ['#ff7ab8'];
  return options.find((c) => cdist(c, p.topColor) > 90 && cdist(c, p.hairColor) > 90) || options[0];
}

export function disposeModel(obj) {
  const mats = new Set();
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
  });
  mats.forEach((m) => m.dispose());
}

function finishShadows(root) {
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
}

// ---------------------------------------------------------------------------------------------
// the player

const HEAD_R = 0.45;
const HEAD_S = [1.1, 0.96, 1.0];
const HEAD_Y = 1.45;

export function buildHuman(params = {}) {
  const p = normalizeCharacter(params);
  const M = materials();
  const rand = rng(hashString(JSON.stringify(p)));
  const dress = p.topStyle === 'dress';
  const skin = M.std(p.skin);
  const hairM = M.std(p.hairColor, { r: 0.7, side: DS });
  const top = M.std(p.topColor, { side: DS });
  const bottom = M.std(p.bottomColor);
  const shoe = M.std(p.shoeColor, { r: 0.6 });

  const root = new THREE.Group();
  root.name = 'human';
  const pivot = grp(root); // facing yaw
  const body = grp(pivot); // bob / hop / lean

  // ---- legs + round shoes (pivot at the hip so they can swing)
  const legs = [];
  const legMat = dress ? skin : bottom;
  for (const sx of [-1, 1]) {
    const hip = grp(body, sx * 0.13, 0.44, 0);
    add(hip, new THREE.CapsuleGeometry(0.1, 0.17, 6, 14), legMat, 0, -0.17, 0);
    if (dress) add(hip, new THREE.CylinderGeometry(0.104, 0.104, 0.07, 14), M.std('#fffdf6'), 0, -0.29, 0);
    add(hip, new THREE.SphereGeometry(0.128, 18, 12), shoe, 0, -0.36, 0.045).scale.set(0.95, 0.62, 1.38);
    add(hip, new THREE.CylinderGeometry(0.12, 0.12, 0.035, 18), M.std(shade(p.shoeColor, p.shoeColor === '#fffdf6' ? -0.12 : 0.55)), 0, -0.42, 0.045).scale.set(0.98, 1, 1.38);
    legs.push(hip);
  }

  // ---- torso: a soft pear shape
  const torso = grp(body, 0, 0, 0);
  const torsoPts = profile([[0, 0.47], [0.2, 0.472], [0.29, 0.52], [0.305, 0.6], [0.297, 0.72], [0.272, 0.84], [0.235, 0.94], [0.17, 1.02], [0.08, 1.07], [0, 1.08]], 22);
  add(torso, revolveGeo(torsoPts, { seg: 40, sz: 0.86 }), top);
  if (!dress) add(torso, new THREE.SphereGeometry(0.255, 24, 14), bottom, 0, 0.47, 0).scale.set(1.12, 0.6, 0.92);
  const accentTop = luma(p.topColor) > 0.75 ? shade(p.topColor, -0.12) : shade(p.topColor, 0.28);
  const trimM = M.std(accentTop);

  if (p.topStyle === 'tee') {
    add(torso, new THREE.TorusGeometry(0.13, 0.022, 8, 24), trimM, 0, 1.0, 0.035).rotation.x = PI / 2 - 0.35;
  } else if (p.topStyle === 'hoodie') {
    // hood lying on the shoulders + kangaroo pocket + drawstrings
    const hood = add(torso, new THREE.TorusGeometry(0.19, 0.075, 10, 28), top, 0, 1.0, -0.06); hood.rotation.x = PI / 2 + 0.25; hood.scale.set(1.05, 1.0, 1.0);
    add(torso, new THREE.SphereGeometry(0.2, 18, 12), top, 0, 0.98, -0.2).scale.set(1.15, 0.75, 0.75);
    const pocket = add(torso, roundRectGeo(0.32, 0.13, 0.05, 0.03), trimM, 0, 0.62, 0.86 * radiusAt(torsoPts, 0.62) + 0.01); pocket.rotation.x = -0.08;
    for (const sx of [-1, 1]) { const s = add(torso, new THREE.CapsuleGeometry(0.011, 0.12, 4, 6), M.std('#fffdf6'), sx * 0.05, 0.87, 0.86 * radiusAt(torsoPts, 0.87) + 0.012); s.rotation.x = -0.35; }
  } else if (p.topStyle === 'sweater') {
    add(torso, new THREE.TorusGeometry(0.14, 0.035, 8, 26), trimM, 0, 1.0, 0.0).rotation.x = PI / 2 - 0.15;
    add(torso, revolveGeo(profile([[0.302, 0.70], [0.302, 0.78]], 2), { seg: 40, sz: 0.87 }).scale(1.03, 1, 1.03), M.std(luma(p.topColor) > 0.7 ? '#e8566a' : '#fffdf6', { side: DS }));
    add(torso, new THREE.TorusGeometry(0.29, 0.035, 8, 32), trimM, 0, 0.51, 0).rotation.x = PI / 2;
    torso.children[torso.children.length - 1].scale.set(1.0, 0.87, 1);
  } else if (p.topStyle === 'shirt') {
    const collarM = M.std(luma(p.topColor) > 0.82 ? '#cfe3f5' : '#fffdf6', { side: DS });
    for (const sx of [-1, 1]) {
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(sx * 0.15, 0.03); s.lineTo(sx * 0.05, -0.12); s.lineTo(0, 0);
      const flap = add(torso, new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), collarM, sx * 0.012, 1.01, 0.12);
      flap.rotation.x = -0.75;
    }
    for (let i = 0; i < 3; i++) { const y = 0.88 - i * 0.12; add(torso, new THREE.SphereGeometry(0.018, 8, 6), M.std('#fffdf6'), 0, y, 0.86 * radiusAt(torsoPts, y) + 0.004).scale.z = 0.5; }
    add(torso, roundRectGeo(0.09, 0.08, 0.02, 0.012), trimM, 0.13, 0.82, 0.22).rotation.set(-0.25, 0.42, 0);
  } else if (dress) {
    const skirtPts = profile([[0.27, 0.74], [0.3, 0.64], [0.38, 0.5], [0.46, 0.36], [0.5, 0.28], [0.48, 0.24]], 16);
    add(torso, revolveGeo(skirtPts, { seg: 44, sz: 0.9 }), top);
    // scalloped hem trim + sash
    add(torso, new THREE.TorusGeometry(0.49, 0.026, 8, 44), M.std('#fffdf6'), 0, 0.255, 0).rotation.x = PI / 2;
    torso.children[torso.children.length - 1].scale.set(1, 0.9, 1);
    const sash = add(torso, new THREE.TorusGeometry(0.285, 0.035, 8, 34), M.std(p.bottomColor === p.topColor ? shade(p.topColor, -0.3) : p.bottomColor), 0, 0.68, 0); sash.rotation.x = PI / 2; sash.scale.set(1, 0.88, 1);
    add(torso, new THREE.TorusGeometry(0.13, 0.022, 8, 24), trimM, 0, 1.0, 0.035).rotation.x = PI / 2 - 0.35;
  }

  // ---- stubby arms with round hands (pivot at the shoulder)
  const arms = [];
  const longSleeve = p.topStyle === 'hoodie' || p.topStyle === 'sweater' || p.topStyle === 'shirt';
  for (const sx of [-1, 1]) {
    const sh = grp(body, sx * 0.245, 0.93, 0);
    sh.rotation.z = sx * 0.32;
    add(sh, new THREE.CapsuleGeometry(0.07, 0.17, 6, 12), longSleeve ? top : skin, 0, -0.15, 0);
    if (!longSleeve && !dress) add(sh, new THREE.CapsuleGeometry(0.087, 0.06, 6, 12), top, 0, -0.06, 0);
    if (dress) add(sh, new THREE.SphereGeometry(0.105, 14, 10), top, 0, -0.03, 0);
    if (p.topStyle === 'sweater' || p.topStyle === 'shirt') add(sh, new THREE.CylinderGeometry(0.078, 0.078, 0.05, 14), trimM, 0, -0.25, 0);
    add(sh, new THREE.SphereGeometry(0.08, 14, 10), skin, 0, -0.3, 0.01);
    arms.push(sh);
  }

  // ---- big round head
  const head = grp(body, 0, HEAD_Y, 0);
  add(head, new THREE.SphereGeometry(HEAD_R, 40, 30), skin).scale.set(...HEAD_S);
  const F = ellipsoid(HEAD_R * HEAD_S[0], HEAD_R * HEAD_S[1], HEAD_R * HEAD_S[2]);

  const eyeHex = mix('#16111c', p.eyeColor, 0.32);
  const eyes = [], highlights = [];
  const brow = M.std(shade(p.hairColor, -0.15));
  for (const sx of [-1, 1]) {
    const e = F.put(add(head, new THREE.SphereGeometry(0.06, 18, 14), M.std(eyeHex, { r: 0.22 })), sx * 0.168, -0.01, -0.012);
    e.scale.set(1, 1.42, 0.5);
    e.userData.sy = 1.42;
    eyes.push(e);
    highlights.push(F.put(add(head, new THREE.SphereGeometry(0.019, 8, 6), M.basic('#ffffff')), sx * 0.168 + 0.02, 0.033, 0.024));
    F.put(add(head, new THREE.CapsuleGeometry(0.015, 0.07, 4, 8), brow), sx * 0.17, 0.13, 0.002, PI / 2 - sx * 0.12);
    F.put(add(head, new THREE.CircleGeometry(0.068, 20), M.basic('#ff8aa8', 0.5)), sx * 0.3, -0.13, 0.004).scale.set(1.15, 0.85, 1);
    add(head, new THREE.SphereGeometry(0.1, 14, 10), skin, sx * 0.482, -0.03, -0.01).scale.set(0.55, 0.85, 0.7);
  }
  // tiny nose + small smile
  F.put(add(head, new THREE.SphereGeometry(0.04, 14, 10), M.std(mix(p.skin, '#e0806e', 0.22))), 0, -0.1, 0.012).scale.set(1.25, 0.9, 0.8);
  const mouthY = p.facialHair === 'mustache' || p.facialHair === 'beard' ? -0.225 : -0.205;
  F.put(add(head, new THREE.TorusGeometry(0.048, 0.012, 8, 18, PI), M.std('#6a2a3a', { r: 0.5 })), 0, mouthY, 0.004, PI);
  if (p.freckles) {
    const fm = M.basic(mix(p.skin, '#7a3a1a', 0.5), 0.85);
    for (const sx of [-1, 1]) for (const [dx, dy] of [[0, 0], [0.042, -0.022], [-0.034, -0.03], [0.012, -0.058], [0.05, 0.018]]) {
      F.put(add(head, new THREE.CircleGeometry(0.011, 8), fm), sx * (0.235 + dx), -0.085 + dy, 0.006);
    }
  }

  // ---- facial hair
  if (p.facialHair === 'mustache' || p.facialHair === 'beard') {
    for (const sx of [-1, 1]) F.put(add(head, new THREE.SphereGeometry(0.05, 14, 10), hairM), sx * 0.048, -0.158, 0.006, sx * 0.3).scale.set(1.5, 0.62, 0.6);
  }
  if (p.facialHair === 'beard' || p.facialHair === 'stubble') {
    const beardTop = hairline([[0, 0.73], [0.35, 0.7], [0.75, 0.65], [1.15, 0.56], [1.5, 0.5]]);
    const geo = shellGeo(F, {
      phi0: -1.55, phi1: 1.55, top: beardTop, bottom: () => 0.93 * PI, segU: 40, segV: 8,
      k: p.facialHair === 'beard' ? (phi, th) => 1.035 + 0.07 * smooth(0.7 * PI, 0.88 * PI, th) * Math.cos(phi) ** 2 : 1.006,
      rim: p.facialHair === 'beard' ? 0.96 : 0,
    });
    const beardM = luma(p.hairColor) > 0.55 ? M.std(shade(p.hairColor, -0.1), { r: 0.75, side: DS }) : hairM;
    add(head, geo, p.facialHair === 'beard' ? beardM : M.basic(mix(p.hairColor, '#2b2233', 0.35), 0.38));
    if (p.facialHair === 'beard') {
      const chin = add(head, new THREE.SphereGeometry(0.13, 14, 10), beardM);
      chin.position.copy(F.at(0, 0.86 * PI, 1.08));
      chin.scale.set(1.5, 1.05, 0.9);
    }
  }

  // ---- hair
  const hair = buildHair(p, head, F, M, hairM, rand);

  // ---- glasses
  if (p.glasses !== 'none') {
    const fm = M.std(luma(p.skin) < 0.35 && luma(p.hairColor) < 0.2 ? '#7a5a3a' : '#2b2233', { r: 0.4 });
    const lens = M.basic('#dff3ff', 0.22);
    for (const sx of [-1, 1]) {
      const g = F.put(new THREE.Group(), sx * 0.168, -0.005, 0.045);
      head.add(g);
      if (p.glasses === 'round') add(g, new THREE.TorusGeometry(0.088, 0.014, 8, 28), fm);
      else add(g, frameGeo(0.205, 0.155, 0.04, 0.026, 0.022), fm);
      add(g, p.glasses === 'round' ? new THREE.CircleGeometry(0.08, 24) : new THREE.PlaneGeometry(0.16, 0.11), lens, 0, 0, -0.004);
      // temple arm back to the ear
      add(head, surfaceArc(F, sx * 0.62, sx * 1.38, 0.5 * PI, 1.04, 0.009), fm);
    }
    const bridge = F.put(add(head, new THREE.TorusGeometry(0.045, 0.011, 6, 12, PI), fm), 0, 0.005, 0.055);
    bridge.scale.set(1, 0.6, 1);
  }

  // ---- accessories
  const acc = p.accessory;
  if (acc !== 'none') buildAccessory(acc, p, head, F, hair, M);

  // ---------------------------------------------------------------------------------------------
  finishShadows(root);
  let t = rand() * 10, phase = 0, walk = 0, yaw = 0, blink = 1 + rand() * 3, hopT = -1;
  root.userData.params = p;
  root.userData.parts = { pivot, body, torso, head, legs, arms, eyes };
  root.userData.handlesFacing = true;
  root.userData.hop = () => { hopT = 0; };
  root.userData.animate = (dt, { moving = false, speed = 1, facing = 0 } = {}) => {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    t += dt;
    walk += ((moving ? 1 : 0) - walk) * Math.min(1, dt * 9);
    const sp = clamp(Number(speed) || 1, 0.3, 1);
    if (walk > 0.01) phase += dt * (8 + 5 * sp);
    else phase = 0;
    const sw = Math.sin(phase), amp = walk * (0.6 + 0.4 * sp);
    legs[0].rotation.x = sw * 0.72 * amp;
    legs[1].rotation.x = -sw * 0.72 * amp;
    arms[0].rotation.x = -sw * 0.9 * amp;
    arms[1].rotation.x = sw * 0.9 * amp;
    const idle = 1 - walk;
    const breath = Math.sin(t * 2.3) * idle;
    arms[0].rotation.z = -0.32 - breath * 0.03 - 0.12 * walk;
    arms[1].rotation.z = 0.32 + breath * 0.03 + 0.12 * walk;
    // hop (creator feedback): squash, jump, squash
    let hopY = 0, squash = 0;
    if (hopT >= 0) {
      hopT += dt;
      const T = 0.42;
      if (hopT < 0.08) squash = Math.sin((hopT / 0.08) * PI) * 0.1;
      else if (hopT < 0.08 + T) { const u = (hopT - 0.08) / T; hopY = 4 * 0.22 * u * (1 - u); squash = -0.05 * Math.sin(u * PI); }
      else if (hopT < 0.08 + T + 0.12) squash = Math.sin(((hopT - 0.08 - T) / 0.12) * PI) * 0.08;
      else hopT = -1;
    }
    const step = Math.abs(Math.cos(phase));
    body.position.y = step * 0.075 * walk + hopY;
    body.rotation.x = 0.07 * walk;
    body.scale.set(1 + squash * 0.6, 1 - squash - (1 - step) * 0.03 * walk, 1 + squash * 0.6);
    torso.scale.set(1 + breath * 0.012, 1 + breath * 0.02, 1 + breath * 0.012);
    head.position.y = HEAD_Y + breath * 0.012;
    head.rotation.z = Math.sin(t * 1.3) * 0.035 * idle + Math.sin(phase) * 0.06 * walk;
    head.rotation.x = Math.sin(t * 0.9) * 0.02 * idle - 0.04 * walk;
    // facing: turn toward -x / +x but stay readable from a camera at +z
    const f = facing > 0 ? 1 : facing < 0 ? -1 : 0;
    const goal = f * (moving ? 0.9 : 0.25);
    yaw += (goal - yaw) * Math.min(1, dt * 9);
    pivot.rotation.y = yaw;
    // blink
    blink -= dt;
    const closed = blink < 0.13;
    for (const e of eyes) e.scale.y = closed ? 0.14 : e.userData.sy;
    for (const h of highlights) h.visible = !closed;
    if (blink < 0) blink = 1.8 + Math.random() * 3.4;
    // swinging hair (ponytail, braids)
    for (const s of hair.swing) {
      const u = s.userData;
      s.rotation.z = u.rz + Math.sin(phase * 1 + u.ph) * u.amp * walk + Math.sin(t * 1.6 + u.ph) * 0.03;
      s.rotation.x = u.rx + Math.abs(Math.sin(phase)) * u.amp * 0.6 * walk;
    }
  };
  return root;
}

function luma(h) { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

// ---------------------------------------------------------------------------------------------
// hair styles: each returns { swing: [], hatK, hat: frame for hats, hideOnHat: [] }

function buildHair(p, head, F, M, hairM, rand) {
  const style = p.hairStyle;
  const out = { swing: [], hatK: 1.13, frame: null, center: new THREE.Vector3(), hideOnHat: [], hideEars: false };
  const H = (geo, mat = hairM) => add(head, geo, mat);
  const darker = M.std(shade(p.hairColor, -0.18), { r: 0.7, side: DS });
  const puffTop = (base, top) => (phi, th) => base + top * Math.max(0, Math.cos(th));

  if (style === 'short') {
    // side-swept bangs + a little cowlick
    const sweep = (phi) => -0.05 * clamp(phi / 0.9, -1, 1) - 0.035 * (0.5 + 0.5 * Math.cos(phi * 9)) * smooth(1.0, 0.2, Math.abs(phi));
    H(shellGeo(F, { bottom: hairline([[0, 0.4], [0.75, 0.42], [1.12, 0.5], [1.3, 0.6], [1.57, 0.52], [2.1, 0.64], [PI, 0.71]], sweep), k: puffTop(1.06, 0.07) }));
    const tuft = add(head, new THREE.ConeGeometry(0.06, 0.2, 10), hairM);
    tuft.position.copy(F.at(PI * 0.9, 0.1 * PI, 1.1));
    aim(tuft, new THREE.Vector3(0.25, 1, -0.6));
    out.hideOnHat.push(tuft);
    out.hatK = 1.15;
  } else if (style === 'buzz') {
    const buzz = M.std(mix(p.hairColor, p.skin, 0.22), { r: 1, side: DS });
    H(shellGeo(F, { bottom: hairline([[0, 0.31], [0.9, 0.34], [1.25, 0.5], [1.57, 0.46], [2.2, 0.6], [PI, 0.68]]), k: 1.022, rim: 0.98 }), buzz);
    out.hatK = 1.07;
  } else if (style === 'long') {
    const curtainBangs = (phi) => -0.02 * Math.cos(phi * 3) * smooth(0.9, 0.1, Math.abs(phi));
    H(shellGeo(F, { bottom: hairline([[0, 0.33], [0.4, 0.42], [0.8, 0.52], [1.05, 0.6], [PI, 0.6]], curtainBangs), k: puffTop(1.07, 0.05) }));
    // a centre part
    const part = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0.02, 0.12, 0.22, 0.31].map((th) => F.at(0, th * PI, 1.1))), 8, 0.008, 5);
    H(part, darker);
    // hair falling to the shoulder blades, framing the face
    H(curtainGeo(F, { phi0: 1.0, phi1: TAU - 1.0, yTop: -0.02, yBot: (phi) => -0.62 - 0.14 * smooth(1.0, 2.6, Math.abs(((phi + PI) % TAU) - PI)) + 0.035 * Math.cos(phi * 9), k0: 1.07, k1: 1.13 }));
    out.hideEars = true;
    out.hatK = 1.14;
  } else if (style === 'bob') {
    const flare = (phi, th) => 1.075 + 0.11 * smooth(0.45 * PI, 0.66 * PI, th) + 0.04 * Math.max(0, Math.cos(th));
    H(shellGeo(F, { bottom: hairline([[0, 0.365], [0.5, 0.375], [0.62, 0.6], [0.76, 0.66], [PI, 0.67]]), k: flare, segU: 96 }));
    out.hideEars = true;
    out.hatK = 1.14;
  } else if (style === 'ponytail') {
    const fringe = (phi) => -0.04 * smooth(-0.9, 0.4, phi) * smooth(0.9, 0.5, phi) - 0.02 * (0.5 + 0.5 * Math.cos(phi * 8)) * smooth(0.9, 0.2, Math.abs(phi));
    H(shellGeo(F, { bottom: hairline([[0, 0.36], [0.6, 0.38], [1.15, 0.48], [1.35, 0.56], [1.6, 0.46], [2.2, 0.6], [PI, 0.66]], fringe), k: puffTop(1.05, 0.04) }));
    const at = [2.2, 0.3 * PI];
    const anchor = F.at(at[0], at[1], 1.05);
    const tie = add(head, new THREE.TorusGeometry(0.075, 0.034, 8, 18), M.std(accent('bow', p)));
    tie.position.copy(anchor);
    aim(tie, F.normal(at[0], at[1])).rotateX(PI / 2);
    const tail = grp(head, anchor.x, anchor.y, anchor.z);
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, -0.01, -0.07), new THREE.Vector3(0.19, -0.16, -0.1),
      new THREE.Vector3(0.21, -0.42, -0.07), new THREE.Vector3(0.16, -0.68, -0.02),
    ]);
    const tailR = (u) => (u < 0.3 ? 0.075 + (0.165 - 0.075) * Math.sin((u / 0.3) * PI / 2) : 0.165 * Math.cos(((u - 0.3) / 0.7) * PI / 2) ** 0.8);
    add(tail, taperTubeGeo(path, tailR, 28, 14), hairM);
    tail.userData = { rz: 0, rx: 0, ph: 0.5, amp: 0.22 };
    out.swing.push(tail);
    out.hatK = 1.1;
  } else if (style === 'curly') {
    const lineFn = hairline([[0, 0.36], [0.8, 0.41], [1.3, 0.55], [1.57, 0.52], [2.2, 0.63], [PI, 0.7]]);
    H(shellGeo(F, { bottom: lineFn, k: 1.04 }));
    const curls = [];
    for (let th = 0.04 * PI; th < 0.74 * PI; th += 0.105 * PI) {
      const ring = Math.max(1, Math.round((TAU * Math.sin(th)) / 0.42));
      const off = rand() * TAU;
      for (let i = 0; i < ring; i++) {
        const phi = ((off + (i / ring) * TAU + PI) % TAU) - PI;
        if (th > lineFn(phi) - 0.02 * PI) continue;
        const r = 0.1 + rand() * 0.03;
        const c = add(head, new THREE.SphereGeometry(r, 12, 9), rand() < 0.3 ? darker : hairM);
        c.position.copy(F.at(phi, th, 1.05));
        curls.push({ mesh: c, th });
      }
    }
    // small curls along the fringe
    for (let phi = -0.95; phi <= 0.95; phi += 0.24) {
      const c = add(head, new THREE.SphereGeometry(0.085, 12, 9), hairM);
      c.position.copy(F.at(phi, lineFn(phi) - 0.02 * PI, 1.04));
      curls.push({ mesh: c, th: lineFn(phi) });
    }
    out.curls = curls;
    out.hatK = 1.24;
  } else if (style === 'bun') {
    H(shellGeo(F, { bottom: hairline([[0, 0.33], [0.7, 0.36], [1.15, 0.47], [1.35, 0.55], [1.6, 0.46], [2.3, 0.6], [PI, 0.64]]), k: 1.045 }));
    const bun = add(head, new THREE.SphereGeometry(0.2, 22, 16), hairM, 0, 0.53, -0.1);
    const band = add(head, new THREE.TorusGeometry(0.125, 0.03, 8, 22), M.std(accent('bow', p)), 0, 0.4, -0.08);
    band.rotation.x = PI / 2 + 0.25;
    // two wisps at the temples
    for (const sx of [-1, 1]) {
      const w = add(head, new THREE.CapsuleGeometry(0.026, 0.16, 4, 8), hairM);
      w.position.copy(F.at(sx * 1.12, 0.5 * PI, 1.03));
      w.rotation.z = sx * 0.12;
    }
    out.hideOnHat.push(bun, band);
    out.hatK = 1.09;
  } else if (style === 'spiky') {
    const jag = (phi) => -0.07 * Math.abs(Math.sin(phi * 4.5)) * smooth(1.1, 0.2, Math.abs(phi));
    H(shellGeo(F, { bottom: hairline([[0, 0.42], [0.8, 0.43], [1.2, 0.52], [1.57, 0.5], [2.2, 0.6], [PI, 0.66]], jag), k: 1.06, segU: 96 }));
    const spikes = [
      [0, 0.03, 0.36, 0.12], [0, 0.22, 0.32, 0.11], [0.8, 0.2, 0.33, 0.11], [-0.8, 0.2, 0.33, 0.11],
      [1.55, 0.27, 0.33, 0.11], [-1.55, 0.27, 0.33, 0.11], [2.3, 0.27, 0.32, 0.11], [-2.3, 0.27, 0.32, 0.11], [PI, 0.26, 0.32, 0.11],
      [1.95, 0.48, 0.27, 0.095], [-1.95, 0.48, 0.27, 0.095], [2.7, 0.48, 0.27, 0.095], [-2.7, 0.48, 0.27, 0.095],
    ];
    for (const [phi, th, len, rad] of spikes) {
      const c = add(head, new THREE.ConeGeometry(rad, len, 10), hairM);
      const n = F.normal(phi, th * PI);
      const dir = n.clone().add(new THREE.Vector3(0, 0.45, -0.15)).normalize();
      c.position.copy(F.at(phi, th * PI, 1.0)).addScaledVector(dir, len * 0.42);
      aim(c, dir);
      if (th < 0.4) out.hideOnHat.push(c);
    }
    out.hatK = 1.1;
  } else if (style === 'afro') {
    const center = new THREE.Vector3(0, 0.12, -0.13);
    const A = ellipsoid(F.ax * 1.5, F.ay * 1.44, F.az * 1.38);
    const lineFn = hairline([[0, 0.25], [0.55, 0.3], [1.0, 0.45], [1.35, 0.6], [1.7, 0.64], [2.3, 0.7], [PI, 0.72]]);
    const shell = add(head, shellGeo(A, { bottom: lineFn, k: 1, rim: 0 }), hairM);
    shell.position.copy(center);
    const bumps = [];
    for (let th = 0.08 * PI; th < 0.72 * PI; th += 0.12 * PI) {
      const ring = Math.max(1, Math.round((TAU * Math.sin(th)) / 0.5));
      const off = rand() * TAU;
      for (let i = 0; i < ring; i++) {
        const phi = ((off + (i / ring) * TAU + PI) % TAU) - PI;
        if (th > lineFn(phi) - 0.03 * PI) continue;
        const b = add(head, new THREE.SphereGeometry(0.15 + rand() * 0.05, 10, 8), rand() < 0.35 ? darker : hairM);
        b.position.copy(A.at(phi, th, 0.97)).add(center);
        bumps.push({ mesh: b, th });
      }
    }
    // fluffy frame around the face (hides the shell edge)
    for (let phi = -1.9; phi <= 1.9; phi += 0.19) {
      const b = add(head, new THREE.SphereGeometry(0.13, 10, 8), hairM);
      b.position.copy(A.at(phi, lineFn(phi), 0.93)).add(center);
      bumps.push({ mesh: b, th: lineFn(phi) });
    }
    out.curls = bumps;
    out.hatHideTh = 0.47 * PI;
    out.hideEars = true;
    out.hatK = 1;
    out.frame = A;
    out.center.copy(center);
  } else if (style === 'braids') {
    H(shellGeo(F, { bottom: hairline([[0, 0.34], [0.5, 0.43], [1.0, 0.5], [1.35, 0.57], [1.6, 0.52], [2.3, 0.62], [PI, 0.68]]), k: 1.045 }));
    const part = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0.02, 0.12, 0.22, 0.33].map((th) => F.at(0, th * PI, 1.075))), 8, 0.008, 5);
    H(part, darker);
    const tieM = M.std(accent('bow', p));
    for (const sx of [-1, 1]) {
      const root = grp(head, sx * 0.43, -0.16, -0.06);
      root.userData = { rz: 0, rx: 0, ph: sx, amp: 0.12 };
      out.swing.push(root);
      let y = 0;
      for (let i = 0; i < 6; i++) {
        const r = 0.082 - i * 0.004;
        const s = add(root, new THREE.SphereGeometry(r, 12, 9), i % 2 ? darker : hairM, sx * 0.012 * (i % 2 ? 1 : -1), y, 0.012 * i);
        s.scale.set(1, 1.2, 0.95);
        s.rotation.z = (i % 2 ? 1 : -1) * 0.45;
        y -= r * 1.7;
      }
      add(root, new THREE.TorusGeometry(0.045, 0.02, 6, 14), tieM, 0, y + 0.03, 0.075).rotation.x = PI / 2;
      add(root, new THREE.ConeGeometry(0.06, 0.13, 10), hairM, 0, y - 0.04, 0.075).rotation.x = PI;
    }
    out.hatK = 1.09;
  } else {
    // bald: a little shine
    F.put(add(head, new THREE.CircleGeometry(0.06, 16), M.basic('#ffffff', 0.35)), 0.12, 0.33, 0.004).scale.set(1.7, 1, 1);
    out.hatK = 1.035;
  }
  if (out.hideEars) head.children.filter((c) => c.geometry?.type === 'SphereGeometry' && Math.abs(Math.abs(c.position.x) - 0.482) < 1e-3).forEach((e) => { e.visible = false; });
  if (!out.frame) out.frame = F.scaled(out.hatK);
  return out;
}

// ---------------------------------------------------------------------------------------------
// accessories (sit on the hair: hair.frame is the hat-sized ellipsoid, hair.center its centre)

function buildAccessory(kind, p, head, F, hair, M) {
  const A = hair.frame, c = hair.center;
  const color = accent(kind, p);
  const mat = M.std(color, { side: DS });
  const place = (mesh, phi, th, k = 1) => { mesh.position.copy(A.at(phi, th, k)).add(c); return mesh; };
  const hatOn = () => {
    hair.hideOnHat.forEach((m) => { m.visible = false; });
    (hair.curls || []).forEach(({ mesh, th }) => { if (th < (hair.hatHideTh || 0.36 * PI)) mesh.visible = false; });
  };
  if (kind === 'cap') {
    hatOn();
    add(head, shellGeo(A, { bottom: hairline([[0, 0.36], [1.2, 0.42], [PI, 0.46]]), k: puff(1.02, 0.06), rim: 0.9 }), mat).position.copy(c);
    place(add(head, new THREE.SphereGeometry(0.04, 10, 8), mat), 0, 0, 1.09);
    const base = A.at(0, 0.36 * PI, 1.02).add(c);
    const brim = add(head, new THREE.CylinderGeometry(0.27, 0.27, 0.03, 28, 1, false, -PI / 2, PI), M.std(shade(color, -0.12), { side: DS }));
    brim.position.set(0, base.y - 0.02, base.z - 0.06);
    brim.scale.set(A.ax / 0.42, 1, 1.05);
    brim.rotation.x = -0.12;
    // panel seams
    for (const phi of [-1.1, 0, 1.1]) {
      const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0.02, 0.15, 0.3].map((th) => A.at(phi, th * PI, 1.022 + 0.06 * Math.cos(th * PI)).add(c))), 6, 0.006, 4);
      add(head, seam, M.std(shade(color, -0.25)));
    }
  } else if (kind === 'beanie') {
    hatOn();
    add(head, shellGeo(A, { bottom: 0.36 * PI, k: puff(1.04, 0.07), rim: 0.9 }), mat).position.copy(c);
    const cuffM = M.std(shade(color, -0.1), { side: DS });
    add(head, shellGeo(A, { top: 0.33 * PI, bottom: 0.45 * PI, k: 1.085, rim: 0.92, segV: 4 }), cuffM).position.copy(c);
    // ribs on the cuff
    for (let i = 0; i < 14; i++) {
      const phi = -PI + ((i + 0.5) / 14) * TAU;
      const rib = add(head, new THREE.CapsuleGeometry(0.013, 0.07, 3, 6), M.std(shade(color, -0.18)));
      rib.position.copy(A.at(phi, 0.39 * PI, 1.1)).add(c);
      aim(rib, A.normal(phi, 0.39 * PI).cross(new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi))));
    }
    const pom = place(add(head, new THREE.SphereGeometry(0.1, 14, 10), M.std('#fffdf6')), 0, 0, 1.18);
    pom.scale.set(1, 0.9, 1);
  } else if (kind === 'headband') {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const u = -1.45 + (2.9 * i) / 16; pts.push(new THREE.Vector3(A.ax * 1.02 * Math.sin(u), A.ay * 1.02 * Math.cos(u), 0)); }
    const band = add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.034, 8), mat);
    band.position.copy(c);
    band.rotation.x = 0.5;
    band.scale.z = A.az / A.ax;
    // a little flower on the side
    const fl = grp(head);
    fl.position.copy(A.at(0.85, 0.24 * PI, 1.04)).add(c);
    fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), A.normal(0.85, 0.24 * PI));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; add(fl, new THREE.SphereGeometry(0.04, 8, 6), M.std('#fffdf6'), Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0).scale.z = 0.5; }
    add(fl, new THREE.SphereGeometry(0.03, 8, 6), M.std('#ffd35a'), 0, 0, 0.012);
  } else if (kind === 'bow') {
    const g = grp(head);
    g.position.copy(A.at(0.62, 0.2 * PI, 1.0)).add(c);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), A.normal(0.62, 0.2 * PI));
    g.rotateZ(-0.35);
    for (const sx of [-1, 1]) {
      const loop = add(g, new THREE.SphereGeometry(0.1, 14, 10), mat, sx * 0.1, 0, 0.02);
      loop.scale.set(1.25, 0.82, 0.5);
      loop.rotation.z = sx * 0.35;
      const tail = add(g, new THREE.CapsuleGeometry(0.025, 0.08, 4, 6), mat, sx * 0.04, -0.09, 0.02);
      tail.rotation.z = sx * 0.5;
    }
    add(g, new THREE.SphereGeometry(0.045, 10, 8), M.std(shade(color, -0.12)), 0, 0, 0.05);
  } else if (kind === 'earrings') {
    const gold = M.std('#ffcf4a', { r: 0.35 });
    for (const sx of [-1, 1]) {
      const x = hair.hideEars ? sx * 0.47 : sx * 0.49, y = hair.hideEars ? -0.27 : -0.12, z = hair.hideEars ? 0.16 : 0.02;
      add(head, new THREE.TorusGeometry(0.022, 0.008, 6, 12), gold, x, y + 0.03, z).rotation.y = PI / 2;
      add(head, new THREE.SphereGeometry(0.032, 10, 8), gold, x, y - 0.012, z);
    }
  }
}
const puff = (base, top) => (phi, th) => base + top * Math.max(0, Math.cos(th));

// ---------------------------------------------------------------------------------------------
// The old scientist model: normal-sized and permanently irritated (~9.5 units, ~5x the Speck), same toy
// style. Not used by the game (it shows Becancourt from engine/scientist.js); /dev pages still compare it.

const EXPRESSIONS = {
  neutral: { browY: 0.02, browRot: 0.1, browS: 1, eyeY: 1, eyeX: 1, lid: 0.18, crease: 0 },
  grumpy: { browY: -0.17, browRot: 0.55, browS: 1.05, eyeY: 0.8, eyeX: 1, lid: 0.62, crease: 1 },
  surprised: { browY: 0.32, browRot: -0.22, browS: 1.12, eyeY: 1.4, eyeX: 1.22, lid: 0, crease: 0 },
  talking: { browY: -0.08, browRot: 0.36, browS: 1, eyeY: 0.92, eyeX: 1, lid: 0.35, crease: 0.6 },
};
const LIFT = 0.15; // his upper body sits a little higher so more of him shows above a desk

export function buildScientist() {
  const M = materials();
  const C = { skin: '#f2c8a6', hair: '#f4f2ee', hair2: '#dcdbe2', brow: '#e2e1e8', brow2: '#c9c8d3', coat: '#f8f6f0', vest: '#a8874a', shirt: '#d6e7f6', tie: '#d0453c', pants: '#4c4660', shoe: '#5a3a2a', frame: '#3a2a24' };
  const skin = M.std(C.skin);
  const hairM = M.std(C.hair, { r: 0.9 });
  const hair2 = M.std(C.hair2, { r: 0.9 });
  const coat = M.std(C.coat, { side: DS });
  const rand = rng(1234567);

  const root = new THREE.Group();
  root.name = 'old-scientist';
  const body = grp(root);

  // ---- legs + big round shoes
  for (const sx of [-1, 1]) {
    add(body, new THREE.CapsuleGeometry(0.52, 2.0, 8, 16), M.std(C.pants), sx * 0.64, 1.75, 0);
    add(body, new THREE.SphereGeometry(0.62, 20, 14), M.std(C.shoe, { r: 0.55 }), sx * 0.68, 0.34, 0.32).scale.set(0.95, 0.55, 1.45);
    add(body, new THREE.CylinderGeometry(0.6, 0.6, 0.12, 20), M.std('#3a2418'), sx * 0.68, 0.06, 0.32).scale.set(0.95, 1, 1.45);
  }

  // ---- torso: shirt underneath, sweater vest with a V-neck, lab coat open at the front
  const upper = grp(body, 0, LIFT, 0);
  const torsoPts = profile([[0, 2.5], [1.1, 2.52], [1.42, 2.85], [1.56, 3.6], [1.6, 4.4], [1.52, 5.3], [1.38, 6.1], [1.12, 6.75], [0.72, 7.15], [0.3, 7.32], [0, 7.36]], 30);
  add(upper, revolveGeo(torsoPts, { seg: 48, sz: 0.8 }), M.std(C.shirt));
  const vestPts = torsoPts.slice(1, -2).map((v) => new THREE.Vector2(v.x + 0.03, v.y));
  add(upper, revolveGeo(vestPts, { seg: 48, sz: 0.8, gap: (y) => (y > 5.55 ? (y - 5.55) * 0.95 : 0) }), M.std(C.vest, { side: DS }));
  // vest buttons
  for (const y of [5.25, 4.75, 4.25, 3.75]) add(upper, new THREE.SphereGeometry(0.08, 10, 8), M.std('#5a3a2a'), 0, y, 0.8 * (radiusAt(vestPts, y) + 0.01)).scale.z = 0.5;
  // tie: knot + blade lying on the shirt in the V
  const tieM = M.std(C.tie, { r: 0.6 });
  const knot = add(upper, new THREE.SphereGeometry(0.17, 14, 10), tieM, 0, 7.0, 0.62); knot.scale.set(1, 0.9, 0.7);
  const tieShape = new THREE.Shape();
  tieShape.moveTo(-0.12, 0); tieShape.lineTo(0.12, 0); tieShape.lineTo(0.27, -1.25); tieShape.lineTo(0, -1.5); tieShape.lineTo(-0.27, -1.25); tieShape.lineTo(-0.12, 0);
  const blade = add(upper, new THREE.ExtrudeGeometry(tieShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }), tieM, 0, 6.9, 0.78);
  blade.rotation.x = -0.36;
  // shirt collar points
  for (const sx of [-1, 1]) {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(sx * 0.42, 0.12); s.lineTo(sx * 0.18, -0.36); s.lineTo(0, 0);
    const flap = add(upper, new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }), M.std('#eef5fc', { side: DS }), sx * 0.08, 7.12, 0.6);
    flap.rotation.x = -0.6;
  }
  // lab coat
  const coatPts = profile([[1.8, 1.75], [1.72, 2.6], [1.68, 3.4], [1.7, 4.3], [1.62, 5.3], [1.49, 6.1], [1.26, 6.76], [0.95, 7.16], [0.72, 7.3]], 26);
  const coatGap = (y) => (y > 6.5 ? 1.2 + (y - 6.5) * 1.2 : y > 5.2 ? 0.82 + (y - 5.2) * 0.29 : y > 3.0 ? 0.6 + (y - 3.0) * 0.1 : 0.6 + (3.0 - y) * 0.3);
  add(upper, revolveGeo(coatPts, { seg: 56, sz: 0.8, gap: coatGap }), coat);
  // coat collar standing around the back of the neck
  const collar = add(upper, new THREE.TorusGeometry(0.86, 0.17, 10, 28, PI * 1.25), coat, 0, 7.18, -0.05);
  collar.rotation.set(PI / 2 - 0.25, 0, PI / 2 + PI * 0.375);
  collar.scale.set(1, 0.85, 1);
  // pockets + a pen
  const pocketM = M.std('#efece4', { side: DS });
  for (const sx of [-1, 1]) {
    const pk = add(upper, roundRectGeo(0.75, 0.6, 0.12, 0.05), pocketM, sx * 0.97, 3.2, 1.11);
    pk.rotation.y = sx * 0.52;
  }
  const breast = add(upper, roundRectGeo(0.5, 0.42, 0.08, 0.05), pocketM, 0.92, 5.95, 1.0);
  breast.rotation.set(-0.1, 0.55, 0);
  const pen = add(upper, new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), M.std('#4f86d8'), 0.85, 6.25, 1.0);
  pen.rotation.z = 0.12;
  add(upper, new THREE.SphereGeometry(0.06, 8, 6), M.std('#2b2233'), 0.82, 6.53, 1.0);

  // ---- arms: right hand holds a coffee mug, left hand raises a lecturing finger
  const arm = (sx, upperRot, foreRot) => {
    const sh = grp(upper, sx * 1.3, 6.62, 0.05);
    sh.rotation.set(upperRot[0], 0, upperRot[1]);
    add(sh, new THREE.SphereGeometry(0.5, 16, 12), coat, 0, -0.05, 0);
    add(sh, new THREE.CapsuleGeometry(0.45, 1.0, 8, 14), coat, 0, -0.85, 0);
    const fore = grp(sh, 0, -1.72, 0);
    fore.rotation.set(foreRot[0], 0, foreRot[1]);
    add(fore, new THREE.CapsuleGeometry(0.41, 0.75, 8, 14), coat, 0, -0.62, 0);
    add(fore, new THREE.CylinderGeometry(0.36, 0.36, 0.2, 16), M.std(C.shirt), 0, -1.22, 0);
    const hand = grp(fore, 0, -1.55, 0);
    add(hand, new THREE.SphereGeometry(0.42, 18, 14), skin).scale.set(1, 1.05, 0.9);
    return { sh, fore, hand };
  };
  const right = arm(-1, [-0.55, -0.6], [-1.75, 0]);
  const left = arm(1, [-0.15, 0.88], [0, 1.98]);
  // lecturing finger + thumb
  // (in the raised hand's frame +x points toward his face and -y up along the forearm)
  const finger = add(left.hand, new THREE.CapsuleGeometry(0.115, 0.42, 6, 10), skin, 0.15, -0.52, 0.06);
  finger.rotation.z = -0.12;
  add(left.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.36, -0.12, 0.16).scale.set(0.9, 1.3, 0.9);
  const knuckles = add(left.hand, new THREE.CapsuleGeometry(0.12, 0.32, 6, 10), skin, -0.04, -0.2, 0.3);
  knuckles.rotation.z = PI / 2;
  add(right.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.32, -0.1, 0.22);

  // mug in the right hand (kept upright in body space)
  root.updateMatrixWorld(true);
  const handPos = upper.worldToLocal(right.hand.getWorldPosition(new THREE.Vector3()));
  const mug = grp(upper);
  mug.position.copy(handPos).add(new THREE.Vector3(0.42, 0.42, 0.12));
  const mugM = M.std('#fffdf6', { r: 0.5 });
  add(mug, new THREE.CylinderGeometry(0.46, 0.42, 0.95, 24), mugM);
  add(mug, new THREE.CylinderGeometry(0.47, 0.47, 0.16, 24), M.std('#e8566a', { r: 0.5 }), 0, 0.18, 0);
  add(mug, new THREE.CylinderGeometry(0.41, 0.41, 0.02, 24), M.std('#5a3418', { r: 0.3 }), 0, 0.46, 0);
  add(mug, new THREE.TorusGeometry(0.26, 0.08, 8, 16), mugM, -0.5, 0.02, 0).rotation.y = 0;
  const steam = [];
  for (let i = 0; i < 2; i++) {
    const s = add(mug, new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 0, 0.6, 0);
    s.userData.off = i / 2;
    s.castShadow = false;
    steam.push(s);
  }

  // ---- big head with wild white hair
  const HR = 1.4, HS = [1.1, 0.95, 1.0];
  const head = grp(upper, 0, 8.15, 0.25);
  add(head, new THREE.SphereGeometry(HR, 44, 32), skin).scale.set(...HS);
  const F = ellipsoid(HR * HS[0], HR * HS[1], HR * HS[2]);
  // ears
  for (const sx of [-1, 1]) add(head, new THREE.SphereGeometry(0.32, 14, 10), skin, sx * 1.5, -0.05, -0.05).scale.set(0.55, 0.9, 0.7);
  // eyes (with eyelids for the grump), highlights
  const eyes = [], lids = [], hls = [];
  for (const sx of [-1, 1]) {
    const e = F.put(add(head, new THREE.SphereGeometry(0.18, 18, 14), M.std('#16111c', { r: 0.2 })), sx * 0.5, 0.1, -0.035);
    e.scale.set(1, 1.35, 0.5);
    eyes.push(e);
    hls.push(F.put(add(head, new THREE.SphereGeometry(0.055, 10, 8), M.basic('#ffffff')), sx * 0.5 + 0.06, 0.21, 0.05));
    // lid: a puffy skin-coloured lid above the eye that slides down (and slants) for the grump
    const lidG = grp(head);
    F.put(lidG, sx * 0.5, 0.1, 0.02);
    const lid = add(lidG, new THREE.SphereGeometry(0.2, 18, 12), skin);
    lid.scale.set(1.3, 0.62, 0.32);
    lid.userData.sx = sx;
    lids.push(lid);
    // rosy cheeks
    F.put(add(head, new THREE.CircleGeometry(0.24, 22), M.basic('#ff8aa8', 0.45)), sx * 0.98, -0.32, 0.01).scale.set(1.2, 0.85, 1);
  }
  // round glasses
  const frameM = M.std(C.frame, { r: 0.4 });
  for (const sx of [-1, 1]) {
    const g = F.put(new THREE.Group(), sx * 0.52, 0.1, 0.16);
    head.add(g);
    add(g, new THREE.TorusGeometry(0.37, 0.055, 10, 36), frameM);
    add(g, new THREE.CircleGeometry(0.34, 30), M.basic('#e6f6ff', 0.2), 0, 0, -0.01);
    const glint = add(g, new THREE.PlaneGeometry(0.06, 0.22), M.basic('#ffffff', 0.55), sx * -0.15 + 0.12, 0.12, 0.012);
    glint.rotation.z = -0.6;
    add(head, surfaceArc(F, sx * 0.78, sx * 1.36, 0.47 * PI, 1.03, 0.035), frameM);
  }
  F.put(add(head, new THREE.TorusGeometry(0.13, 0.045, 8, 14, PI), frameM), 0, 0.14, 0.2).scale.set(1, 0.55, 1);
  // huge bushy eyebrows
  const brows = [];
  for (const sx of [-1, 1]) {
    const b = grp(head);
    F.put(b, sx * 0.55, 0.62, 0.1);
    b.userData.base = b.position.clone();
    b.userData.sx = sx;
    const tuft = [[-0.36, -0.03, 0.15], [-0.16, 0.03, 0.2], [0.07, 0.05, 0.21], [0.28, 0.01, 0.18], [0.45, -0.06, 0.13]];
    for (const [x, y, r] of tuft) add(b, new THREE.SphereGeometry(r, 12, 9), x > 0.3 ? M.std(C.brow2, { r: 0.95 }) : M.std(C.brow, { r: 0.95 }), x * sx, y, 0).scale.set(1.15, 0.85, 0.65);
    brows.push(b);
  }
  // frown creases between the brows
  const creases = [];
  for (const sx of [-1, 1]) {
    const c = F.put(add(head, new THREE.CapsuleGeometry(0.026, 0.2, 4, 6), M.std(shade(C.skin, -0.18))), sx * 0.1, 0.5, 0.01, sx * 0.22);
    c.userData.sx = sx;
    creases.push(c);
  }
  // round nose
  F.put(add(head, new THREE.SphereGeometry(0.26, 18, 14), M.std(mix(C.skin, '#e0806e', 0.32))), 0, -0.2, 0.05).scale.set(1.15, 0.95, 0.9);
  // big white walrus mustache
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.SphereGeometry(0.3, 16, 12), hairM), sx * 0.34, -0.5, 0.06, sx * 0.32).scale.set(1.55, 0.72, 0.8);
    F.put(add(head, new THREE.SphereGeometry(0.17, 12, 10), hair2), sx * 0.72, -0.64, 0.02, sx * 0.7).scale.set(1.3, 0.7, 0.8);
  }
  F.put(add(head, new THREE.SphereGeometry(0.22, 14, 10), hairM), 0, -0.42, 0.08).scale.set(1.3, 0.75, 0.8);
  // mouths (one visible at a time)
  const mouthM = M.std('#6a2a3a', { r: 0.5 });
  const mouth = grp(head);
  F.put(mouth, 0, -0.86, 0.02);
  const mouths = {
    frown: add(mouth, new THREE.TorusGeometry(0.22, 0.055, 8, 20, PI), mouthM, 0, -0.1, 0),
    flat: add(mouth, new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), mouthM),
    o: grp(mouth),
    talk: grp(mouth),
  };
  mouths.flat.rotation.z = PI / 2;
  add(mouths.o, new THREE.TorusGeometry(0.15, 0.055, 8, 20), mouthM).scale.set(1, 1.2, 1);
  add(mouths.o, new THREE.CircleGeometry(0.15, 20), M.std('#3a1420'), 0, 0, -0.01).scale.set(1, 1.2, 1);
  add(mouths.talk, new THREE.SphereGeometry(0.22, 16, 12), M.std('#4a1a28', { r: 0.6 })).scale.set(1.25, 1, 0.35);
  add(mouths.talk, new THREE.SphereGeometry(0.12, 12, 8), M.std('#ff8aa8'), 0, -0.1, 0.04).scale.set(1.2, 0.6, 0.4);
  // wild Einstein hair: a fluffy cloud on each side and at the back, frizzy tufts, flyaway wisps on the bald top
  const puffs = [];
  for (const [phi, th, r, k] of [
    [1.25, 0.31, 0.46, 1.0], [1.6, 0.29, 0.54, 1.02], [2.0, 0.28, 0.6, 1.04], [2.45, 0.3, 0.62, 1.04], [2.85, 0.31, 0.6, 1.02],
    [1.95, 0.47, 0.62, 1.1], [2.35, 0.52, 0.68, 1.08], [2.8, 0.55, 0.64, 1.04],
    [1.85, 0.64, 0.48, 1.02], [2.3, 0.68, 0.55, 1.0], [2.75, 0.7, 0.52, 0.98],
    [1.5, 0.22, 0.38, 0.98], [2.1, 0.21, 0.44, 0.98], [2.7, 0.22, 0.46, 0.98],
    [PI, 0.33, 0.62, 1.03], [PI, 0.52, 0.66, 1.04], [PI, 0.7, 0.55, 0.98],
  ]) {
    for (const sx of phi === PI ? [1] : [-1, 1]) {
      const pp = add(head, new THREE.SphereGeometry(r, 16, 12), rand() < 0.3 ? hair2 : hairM);
      pp.position.copy(F.at(sx * phi, th * PI, k));
      pp.scale.set(1, 0.9, 1);
      puffs.push([sx * phi, th, k + r / 1.4]);
    }
  }
  // frizz: fat short tufts sticking out sideways and up
  const sides = puffs.filter(([, th]) => th >= 0.27); // frizz on the sides and back, not on the crown
  for (let i = 0; i < 26; i++) {
    const [phi, th, k] = sides[(i * 7) % sides.length];
    const ph = phi + (rand() - 0.5) * 0.35, tt = th * PI + (rand() - 0.5) * 0.2;
    const len = 0.38 + rand() * 0.32, rad = 0.2 + rand() * 0.08;
    const n = F.normal(ph, tt).add(new THREE.Vector3(Math.sign(Math.sin(ph)) * 0.5, rand() * 0.15, -0.15));
    n.y *= 0.45;
    n.normalize();
    const c = add(head, new THREE.ConeGeometry(rad, len, 8), rand() < 0.3 ? hair2 : hairM);
    c.position.copy(F.at(ph, tt, k * 0.92)).addScaledVector(n, len * 0.3);
    aim(c, n);
  }
  // a few thin flyaway tufts on the bald crown
  for (const [phi, th, r] of [[2.4, 0.08, 0.3], [-2.2, 0.1, 0.28], [PI, 0.12, 0.32]]) {
    const pp = add(head, new THREE.SphereGeometry(r, 12, 9), hairM);
    pp.position.copy(F.at(phi, th * PI, 1.02));
    pp.scale.set(1.2, 0.7, 1.2);
  }
  F.put(add(head, new THREE.CircleGeometry(0.22, 18), M.basic('#ffffff', 0.35)), 0.35, 0.95, 0.01).scale.set(1.6, 1, 1);
  finishShadows(root);
  steam.forEach((s) => { s.castShadow = false; });

  // ---- expressions + animation
  let expr = 'grumpy';
  const cur = { ...EXPRESSIONS.grumpy };
  let started = false, t = 0, blink = 2.5, talkOpen = 0;
  const apply = (blinking) => {
    for (const b of brows) {
      const sx = b.userData.sx;
      b.position.copy(b.userData.base);
      b.position.y += cur.browY;
      b.rotation.z = sx * cur.browRot;
      b.scale.setScalar(cur.browS);
    }
    eyes.forEach((e, i) => {
      e.scale.set(cur.eyeX, blinking ? 0.12 : 1.35 * cur.eyeY, 0.5);
      hls[i].visible = !blinking;
    });
    for (const c of creases) { c.visible = cur.crease > 0.05; c.scale.set(1, Math.max(0.01, cur.crease), 1); }
    for (const lid of lids) {
      const kk = cur.lid;
      lid.visible = kk > 0.04;
      lid.position.y = 0.37 - kk * 0.3;
      lid.rotation.z = lid.userData.sx * 0.34 * Math.min(1, kk * 2);
      lid.scale.set(1.3 * cur.eyeX, 0.62, 0.32);
    }
  };
  const showMouth = () => {
    const which = expr === 'grumpy' ? 'frown' : expr === 'surprised' ? 'o' : expr === 'talking' ? 'talk' : 'flat';
    for (const [k, m] of Object.entries(mouths)) m.visible = k === which;
  };
  root.userData.expression = () => expr;
  root.userData.setExpression = (name) => {
    expr = EXPRESSIONS[name] ? name : 'neutral';
    showMouth();
    if (!started) { Object.assign(cur, EXPRESSIONS[expr]); apply(false); }
  };
  root.userData.parts = { head, brows, eyes, mouths, mug, left, right };
  root.userData.animate = (dt, { talking = false } = {}) => {
    dt = clamp(Number(dt) || 0, 0, 0.1);
    started = true;
    t += dt;
    const goal = EXPRESSIONS[expr];
    const k = Math.min(1, dt * 12);
    for (const key of Object.keys(cur)) cur[key] += (goal[key] - cur[key]) * k;
    blink -= dt;
    const blinking = blink < 0.14;
    if (blink < 0) blink = 2 + Math.random() * 4;
    apply(blinking);
    const talk = talking || expr === 'talking';
    // mouth flaps
    if (talk) {
      mouths.talk.visible = true;
      for (const [key, m] of Object.entries(mouths)) if (key !== 'talk') m.visible = false;
      talkOpen = 0.2 + 0.8 * Math.abs(Math.sin(t * 11 + Math.sin(t * 3.1) * 2));
      mouths.talk.scale.set(1, talkOpen, 1);
    } else showMouth();
    // body: breathing, a grumpy little bob when talking
    const breath = Math.sin(t * 1.5);
    body.position.y = breath * 0.035 + (talk ? Math.abs(Math.sin(t * 6.5)) * 0.07 : 0);
    upper.rotation.x = 0.04 + (talk ? Math.sin(t * 3.2) * 0.012 : 0);
    head.rotation.z = Math.sin(t * 0.8) * 0.025 + (talk ? Math.sin(t * 5.3) * 0.035 : 0);
    head.rotation.x = (talk ? Math.sin(t * 6.1) * 0.035 : 0) + (expr === 'surprised' ? -0.06 : 0.02);
    // the lecturing finger wags while he talks
    left.fore.rotation.z = 1.98 + (talk ? Math.sin(t * 9) * 0.22 : Math.sin(t * 1.2) * 0.04) + (expr === 'surprised' ? 0.25 : 0);
    left.sh.rotation.z = 0.88 + (talk ? Math.sin(t * 4.5) * 0.05 : 0) + (expr === 'surprised' ? 0.2 : 0);
    // steam
    for (const s of steam) {
      const u = (t * 0.45 + s.userData.off) % 1;
      s.position.set(-0.35 * u + Math.sin(u * 7 + s.userData.off * 9) * 0.06, 0.55 + u * 0.6, 0.1);
      s.scale.setScalar(0.7 + u * 0.8);
      s.material.opacity = 0.4 * Math.sin(u * PI);
    }
  };
  root.userData.setExpression('grumpy');
  return root;
}

// radius of a sampled profile at height y
function radiusAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.y - y) * (b.y - y) <= 0) { const u = (y - a.y) / (b.y - a.y || 1); return a.x + (b.x - a.x) * u; }
  }
  return pts[0].x;
}
