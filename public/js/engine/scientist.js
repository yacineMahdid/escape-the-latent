// Jean-Lafontaine de Becancourt, the grumpy old man whose desk the Speck lives on.
// Long black hair falling past his shoulders, a full bushy black beard with the moustache merged into it,
// enormous black brows over heavy-lidded old eyes, a big ruddy nose and heavy cheeks; a worn chunky
// cardigan over a roll-neck, old trousers with turn-ups, felt slippers, and an old man's stoop.
// His coffee steams in his right hand; the left hand lectures with a raised finger.
// Same toy family as humans.js: primitives, lathes and swept locks, chunky, rounded and matte.
//   buildScientist() -> THREE.Group: feet at y = 0, faces +z, ~10 units tall, head centre at y ~8.3
//   userData: setExpression(name), expression(), animate(dt, { talking }), parts
import * as THREE from 'three';
import {
  materials, add, grp, ellipsoid, shellGeo, revolveGeo, profile, roundRectGeo, rng, curve, mix,
  shade, clamp, smooth, finishShadows, PI, TAU, DS, UP,
} from './toyparts.js';

// (jaw: how far the beard drops open; lift: how far the moustache rises with the upper lip)
const EXPRESSIONS = {
  neutral: { browY: 0.0, slant: 0.1, arch: 0.02, browS: 1.0, eyeY: 1.0, eyeX: 1.0, lid: 0.34, crease: 0.25, tilt: 0, startle: 0, jaw: 0, lift: 0 },
  grumpy: { browY: -0.13, slant: 0.42, arch: -0.03, browS: 1.04, eyeY: 0.92, eyeX: 1.0, lid: 0.6, crease: 1, tilt: 0.02, startle: 0, jaw: 0, lift: 0 },
  surprised: { browY: 0.13, slant: -0.15, arch: 0.1, browS: 1.05, eyeY: 1.45, eyeX: 1.18, lid: 0.0, crease: 0, tilt: -0.05, startle: 1, jaw: 1, lift: 1 },
  talking: { browY: -0.06, slant: 0.28, arch: 0.0, browS: 1.0, eyeY: 0.96, eyeX: 1.0, lid: 0.42, crease: 0.6, tilt: 0, startle: 0, jaw: 0.2, lift: 0.3 },
};

const HIP = 2.7; // the stoop pivots here
const LEAN = 0.08; // forward lean of the upper body
const HEAD = new THREE.Vector3(0, 8.32, 0.42); // head centre in upper-body coordinates (pushed forward)
const HR = 1.4, HS = [1.1, 0.96, 1.0];
const SZJ = 0.84; // cardigan depth squash
const V0 = 4.82; // the cardigan is buttoned below this height, open in a V above it
const BROW_X = 0.54, BROW_Y = 0.44;
const BROW_XO = [-0.32, -0.08, 0.17, 0.4]; // brow control points, offset outward from BROW_X
const BROW_R = 0.19; // brow thickness: 0.92 of it across the brow, 0.6 of it out of the face, and the end-cap length
const BEARD_Y = -1.3, JAW = 0.17; // the beard hangs from here in head coordinates; how far the jaw drops

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const named = (name, o) => { o.name = name; return o; };
const line = (pts, extra) => { const c = curve(pts); return (phi) => (c(Math.abs(phi)) + (extra ? extra(phi) : 0)) * PI; };

// radius of a sampled profile (ascending y) at height y
function radiusAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.y - y) * (b.y - y) <= 0) { const u = (y - a.y) / (b.y - a.y || 1); return a.x + (b.x - a.x) * u; }
  }
  return y < pts[0].y ? pts[0].x : pts[pts.length - 1].x;
}

// surface of revolution for knitwear: optional rib ripples around the axis, an opening at the front
// (gap(y) radians) and a rounded upper back (hump(y), the stoop) pushed out behind
function knitRevolve(pts, { seg = 72, sz = 1, gap = null, ribs = 0, amp = 0, hump = null } = {}) {
  const pos = [], idx = [];
  let closed = true;
  for (const p of pts) {
    const g = gap ? clamp(gap(p.y), 0, TAU - 0.01) : 0;
    if (g > 1e-6) closed = false;
    const hb = hump ? hump(p.y) : 0;
    for (let i = 0; i <= seg; i++) {
      const phi = g / 2 + ((TAU - g) * i) / seg;
      const r = p.x * (1 + amp * Math.cos(ribs * phi)), c = Math.cos(phi);
      pos.push(r * Math.sin(phi), p.y, r * c * sz - (c < 0 ? hb * Math.pow(-c, 1.5) : 0));
    }
  }
  for (let j = 0; j < pts.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closed) { // weld the normals across the seam
    const N = g.attributes.normal;
    for (let j = 0; j < pts.length; j++) {
      const a = j * (seg + 1), b = a + seg;
      const nx = N.getX(a) + N.getX(b), ny = N.getY(a) + N.getY(b), nz = N.getZ(a) + N.getZ(b), L = Math.hypot(nx, ny, nz) || 1;
      N.setXYZ(a, nx / L, ny / L, nz / L); N.setXYZ(b, nx / L, ny / L, nz / L);
    }
  }
  return g;
}

// A flattened lock of hair along a smooth curve: half-width W(u) across, half-thickness H(u) along
// out(P, u) (the direction it lies against). The end closes in a round cap about as long as the end
// is wide (capK scales it), so no lock ends in a point; capStart closes the start the same way (a lip
// roll). Analytic normals, outward-facing triangles. into: a lock built earlier with the same options,
// re-laid in place along the new path (a brow moving with the face) instead of building a new geometry.
function lockGeo(pts, W, H, out, { segs = 20, radial = 10, capRows = 5, capK = 1, sq = 2, capStart = false, into = null } = {}) {
  const e = 2 / sq; // sq > 2 squares the cross-section off (a flat ribbon of hair rather than a tube)
  const crv = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const L = crv.getLength();
  const capLen = Math.min(0.45 * L, Math.max(0.02, W(1) * capK));
  const uc = 1 - capLen / L, us = capStart ? Math.min(0.45 * L, Math.max(0.02, W(0) * capK)) / L : 0;
  const rows = [];
  if (capStart) for (let k = capRows; k > 0; k--) { const a = (k / capRows) * (PI / 2); rows.push([us * (1 - Math.sin(a)), -a]); }
  for (let i = 0; i < segs; i++) rows.push([us + ((uc - us) * i) / segs, 0]);
  for (let k = 0; k <= capRows; k++) { const a = (k / capRows) * (PI / 2); rows.push([uc + (1 - uc) * Math.sin(a), a]); }
  const pos = [], nor = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const prev = new THREE.Vector3(0, 0, 1);
  for (const [u, a] of rows) {
    const uu = Math.min(1, u);
    crv.getPointAt(uu, P);
    crv.getTangentAt(uu, T);
    N.copy(out(P, uu));
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-8) N.copy(prev);
    N.normalize();
    prev.copy(N);
    B.crossVectors(T, N).normalize();
    const w0 = Math.max(0.004, W(clamp(uu, us, uc))), h0 = Math.max(0.004, H(clamp(uu, us, uc)));
    const f = Math.cos(a), w = Math.max(0.002, w0 * f), h = Math.max(0.002, h0 * f);
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= radial; j++) {
      const t = (j / radial) * TAU, c0 = Math.cos(t), s0 = Math.sin(t);
      const c = Math.sign(c0) * Math.abs(c0) ** e, s = Math.sign(s0) * Math.abs(s0) ** e;
      const cn = Math.sign(c0) * Math.abs(c0) ** (2 - e) / w0, sn = Math.sign(s0) * Math.abs(s0) ** (2 - e) / h0;
      pos.push(P.x + w * c * B.x + h * s * N.x, P.y + w * c * B.y + h * s * N.y, P.z + w * c * B.z + h * s * N.z);
      let nx = cn * B.x + sn * N.x, ny = cn * B.y + sn * N.y, nz = cn * B.z + sn * N.z;
      const L1 = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / L1) * ca + T.x * sa; ny = (ny / L1) * ca + T.y * sa; nz = (nz / L1) * ca + T.z * sa;
      const L2 = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / L2, ny / L2, nz / L2);
    }
  }
  if (into) {
    for (const [k, v] of [['position', pos], ['normal', nor]]) { into.attributes[k].array.set(v); into.attributes[k].needsUpdate = true; }
    into.boundingBox = into.boundingSphere = null; // (recomputed when next needed, for culling)
    return into;
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
// The beard mass: a surface of revolution of the profile BP (ascending y, closed at both ends), squashed
// in z by sz, whose front is shaped into broad soft lobes (rounded ridges and rounded valleys). The lobes
// hang a little lower toward the middle, so the bottom edge is a row of round scallops.
// notch dips the top of the front centre (under the mouth) down and back a little.
function beardGeo(BP, { seg = 80, sz = 0.62, lobes = 10, amp = 0.07, drop = 0.2, notch = 0, notchW = 0.5 } = {}) {
  const pos = [], idx = [];
  const yb = BP[0].y, yt = BP[BP.length - 1].y;
  for (const p of BP) {
    const low = smooth(yb + 0.7 * (yt - yb), yb, p.y); // 0 in the upper part, 1 at the bottom
    const high = smooth(yt - 0.45, yt - 0.04, p.y) * smooth(0, 0.35, p.x); // the top surface (not the pole)
    for (let i = 0; i <= seg; i++) {
      const phi = -PI + (TAU * i) / seg, c = Math.cos(phi);
      const front = smooth(-0.1, 0.7, c), w = Math.pow(0.5 + 0.5 * Math.cos(lobes * phi), 1.5);
      const r = p.x * (1 + amp * front * (w - 0.35)), dip = notch * high * Math.exp(-((phi / notchW) ** 2));
      pos.push(r * Math.sin(phi), p.y - drop * front * w * (0.5 + 0.5 * c) * low - dip, r * c * sz - 0.4 * dip);
    }
  }
  for (let j = 0; j < BP.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const N = g.attributes.normal; // weld the seam at the back
  for (let j = 0; j < BP.length; j++) {
    const a = j * (seg + 1), b = a + seg;
    const nx = N.getX(a) + N.getX(b), ny = N.getY(a) + N.getY(b), nz = N.getZ(a) + N.getZ(b), L = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(a, nx / L, ny / L, nz / L); N.setXYZ(b, nx / L, ny / L, nz / L);
  }
  return g;
}

// lock widths: full at the root, tapering to k of that at the end (where the round cap closes it)
const taper = (w0, k = 0.62, p = 1) => (u) => w0 * (1 - (1 - k) * Math.pow(u, p));
// the mane: narrower at the root (locks crowd together on the head), full in the middle, then tapering
const maneW = (w0) => (u) => w0 * (0.6 + 0.4 * smooth(0, 0.3, u)) * (1 - 0.36 * smooth(0.35, 1, u));

export function buildScientist() {
  const M = materials();
  const C = {
    skin: '#efc29d', hair: '#25212a', hair2: '#2f2934', hairDeep: '#1b181f', brow: '#201c24',
    knit: '#3f6870', card: '#93424b', button: '#d9b77e', odd: '#5b7fb4',
    pants: '#5a5048', slipper: '#3f5b4b', fleece: '#efe3c8', sole: '#3b2a22',
    mug: '#f4ecdc', band: '#4a78b8', coffee: '#5a3418', mouth: '#3a1420', lip: '#d4807a', tongue: '#e8808e',
  };
  const skin = M.std(C.skin);
  const skinLine = M.std(shade(C.skin, -0.27), { r: 0.9 });
  const ruddy = M.std(mix(C.skin, '#e07a68', 0.38));
  const hairM = M.std(C.hair, { r: 0.62, side: DS });
  const hair2 = M.std(C.hair2, { r: 0.6, side: DS });
  const hairDeep = M.std(C.hairDeep, { r: 0.8, side: DS });
  const browM = M.std(C.brow, { r: 0.75 });
  const knitM = M.std(C.knit, { r: 0.95 });
  const cardM = M.std(C.card, { r: 0.95, side: DS });
  const ribM = M.std(shade(C.card, -0.16), { r: 0.95 });
  const rand = rng(48151623);
  const cur = { ...EXPRESSIONS.grumpy }; // the blended expression currently shown

  const root = new THREE.Group();
  root.name = 'becancourt';

  // ---- legs (planted; the body above them breathes): old trousers with turn-ups, felt slippers
  const legs = grp(root);
  const pantsM = M.std(C.pants, { r: 0.92 });
  for (const sx of [-1, 1]) {
    add(legs, new THREE.CapsuleGeometry(0.57, 1.8, 4, 14), pantsM, sx * 0.68, 2.05, 0);
    add(legs, new THREE.CylinderGeometry(0.62, 0.63, 0.26, 20), M.std(shade(C.pants, -0.1), { r: 0.92 }), sx * 0.68, 0.84, 0);
    const sl = grp(legs, sx * 0.7, 0, 0.3);
    add(sl, new THREE.SphereGeometry(0.62, 22, 14), M.std(C.slipper, { r: 0.95 }), 0, 0.34, 0.06).scale.set(0.96, 0.54, 1.45);
    add(sl, new THREE.CylinderGeometry(0.6, 0.6, 0.12, 22), M.std(C.sole, { r: 0.8 }), 0, 0.06, 0.06).scale.set(0.98, 1, 1.47);
    const cuff = add(sl, new THREE.TorusGeometry(0.44, 0.14, 8, 22), M.std(C.fleece, { r: 1 }), 0, 0.6, -0.26);
    cuff.rotation.x = PI / 2;
  }

  // ---- upper body, stooped forward from the hips
  const body = grp(root);
  const lean = grp(body, 0, HIP, 0);
  lean.rotation.x = LEAN;
  const up = grp(lean, 0, -HIP, 0);

  // roll-neck jumper under the cardigan
  const T = profile([[0, 2.45], [1.15, 2.48], [1.45, 2.8], [1.58, 3.6], [1.6, 4.4], [1.54, 5.3], [1.42, 6.0], [1.18, 6.68], [0.86, 7.08], [0.6, 7.28], [0, 7.34]], 20);
  add(up, revolveGeo(T, { seg: 40, sz: 0.8 }), knitM);
  const roll = add(up, new THREE.TorusGeometry(0.66, 0.24, 10, 28), knitM, 0, 7.2, 0.06);
  roll.rotation.x = PI / 2;
  roll.scale.set(1, 0.85, 1);

  // the cardigan: chunky, a bit baggy, buttoned below V0 and open in a V above; rounded over the stoop
  const J = profile([[1.8, 2.34], [1.76, 2.6], [1.72, 3.1], [1.74, 4.1], [1.72, 5.1], [1.64, 5.9], [1.46, 6.55], [1.14, 7.02], [0.84, 7.26], [0.68, 7.34]], 20);
  const cardGap = (y) => 0.05 + (y > V0 ? Math.pow((y - V0) / (7.34 - V0), 1.15) * 1.3 : 0);
  const hump = (y) => 0.3 * Math.exp(-(((y - 6.15) / 0.8) ** 2));
  add(up, knitRevolve(J, { seg: 76, sz: SZJ, gap: cardGap, hump }), cardM);
  // ribbed hem
  add(up, knitRevolve(profile([[1.74, 2.28], [1.85, 2.33], [1.87, 2.5], [1.85, 2.66], [1.78, 2.71]], 6), { seg: 110, sz: SZJ, gap: () => 0.05, ribs: 55, amp: 0.024, hump }), ribM);
  const onCard = (phi, y, out = 0.02) => { const r = radiusAt(J, y) + out; return V(r * Math.sin(phi), y, r * Math.cos(phi) * SZJ); };
  const yawOn = (phi) => Math.atan2(SZJ * Math.sin(phi), Math.cos(phi));
  // ribbed button band up the front and around the V
  const bodyOut = (P) => V(P.x, 0, P.z / (SZJ * SZJ)).normalize();
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let y = 2.36; y < 7.3; y += 0.3) { const r = radiusAt(J, y); pts.push(onCard(sx * (cardGap(y) / 2 + 0.06 / r), y, 0.03)); }
    pts.push(onCard(sx * (cardGap(7.32) / 2 + 0.08), 7.32, 0.03));
    add(up, lockGeo(pts, () => 0.12, () => 0.05, bodyOut, { segs: 44, radial: 8, capK: 0.5 }), ribM);
  }
  // big horn buttons; the top one was replaced long ago with an odd blue one
  for (const [y, odd] of [[4.5, true], [3.6, false], [2.95, false]]) {
    const b = add(up, new THREE.CylinderGeometry(odd ? 0.14 : 0.16, odd ? 0.14 : 0.16, 0.08, 16), M.std(odd ? C.odd : C.button, { r: 0.5 }));
    b.position.copy(onCard(0, y, 0.1));
    b.rotation.x = PI / 2;
  }
  // baggy patch pockets with a ribbed top
  for (const sx of [-1, 1]) {
    const phi = sx * 0.8;
    const pk = add(up, roundRectGeo(0.8, 0.7, 0.14, 0.05), M.std(shade(C.card, -0.05), { r: 0.95 }));
    pk.position.copy(onCard(phi, 3.0, 0.035));
    pk.rotation.y = yawOn(phi);
    const top = add(up, roundRectGeo(0.84, 0.15, 0.07, 0.05), ribM);
    top.position.copy(onCard(phi, 3.32, 0.06));
    top.rotation.y = yawOn(phi);
  }

  // ---- arms in chunky knit sleeves with ribbed cuffs: right hand holds the mug, left hand lectures
  const upperSleeve = revolveGeo(profile([[0.3, -1.98], [0.47, -1.84], [0.51, -1.5], [0.53, -0.8], [0.53, -0.2], [0.42, 0.16], [0.001, 0.26]], 12), { seg: 32 });
  const foreSleeve = revolveGeo(profile([[0.42, -1.16], [0.48, -1.08], [0.48, -0.9], [0.46, -0.6], [0.47, -0.1], [0.37, 0.2], [0.001, 0.3]], 11), { seg: 32 });
  const cuffGeo = knitRevolve(profile([[0.39, -1.5], [0.47, -1.45], [0.49, -1.3], [0.49, -1.16], [0.44, -1.08]], 6), { seg: 48, ribs: 16, amp: 0.05 });
  const arm = (sx, upperRot, foreRot) => {
    const sh = grp(up, sx * 1.38, 6.62, 0.3);
    sh.rotation.set(upperRot[0], 0, upperRot[1]);
    named('shoulder', add(sh, new THREE.SphereGeometry(0.6, 18, 14), cardM, 0, -0.02, 0)).scale.set(1, 0.95, 1);
    named('arm', add(sh, upperSleeve, cardM));
    const fore = grp(sh, 0, -1.74, 0);
    fore.rotation.set(foreRot[0], 0, foreRot[1]);
    named('arm', add(fore, foreSleeve, cardM));
    named('arm', add(fore, cuffGeo, ribM));
    const hand = grp(fore, 0, -1.62, 0);
    named('hand', add(hand, new THREE.SphereGeometry(0.44, 18, 14), skin)).scale.set(1, 1.05, 0.9);
    return { sh, fore, hand };
  };
  const right = arm(-1, [-0.55, -0.6], [-1.75, 0]);
  const left = arm(1, [-0.15, 0.88], [0, 1.98]);
  // lecturing finger + thumb (in the raised hand's frame +x points toward his face, -y up along the forearm)
  const finger = add(left.hand, new THREE.CapsuleGeometry(0.115, 0.42, 6, 10), skin, 0.15, -0.53, 0.06);
  finger.rotation.z = -0.12;
  add(left.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.36, -0.12, 0.16).scale.set(0.9, 1.3, 0.9);
  const knuckles = add(left.hand, new THREE.CapsuleGeometry(0.12, 0.32, 6, 10), skin, -0.04, -0.2, 0.3);
  knuckles.rotation.z = PI / 2;
  add(right.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.32, -0.1, 0.22);

  // the mug in his right hand (kept upright against the stoop)
  root.updateMatrixWorld(true);
  const toUp = (o, v = new THREE.Vector3()) => up.worldToLocal(o.getWorldPosition(v));
  const handPos = toUp(right.hand);
  const mug = grp(up);
  mug.position.copy(handPos).add(V(0.42, 0.42, 0.12));
  mug.rotation.x = -LEAN;
  const mugM = M.std(C.mug, { r: 0.5 });
  named('mug', add(mug, new THREE.CylinderGeometry(0.46, 0.42, 0.95, 24), mugM));
  add(mug, new THREE.CylinderGeometry(0.47, 0.47, 0.16, 24), M.std(C.band, { r: 0.5 }), 0, 0.18, 0);
  add(mug, new THREE.CylinderGeometry(0.41, 0.41, 0.02, 24), M.std(C.coffee, { r: 0.3 }), 0, 0.46, 0);
  add(mug, new THREE.TorusGeometry(0.26, 0.08, 8, 16), mugM, -0.5, 0.02, 0);
  const steam = [];
  for (let i = 0; i < 3; i++) {
    const s = add(mug, new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 0, 0.6, 0);
    s.userData.off = i / 3;
    steam.push(s);
  }
  const steamAt = (time) => {
    for (const s of steam) {
      const u = (time * 0.45 + s.userData.off) % 1;
      s.position.set(-0.3 * u + Math.sin(u * 7 + s.userData.off * 9) * 0.07, 0.55 + u * 0.75, 0.05);
      s.scale.setScalar(0.7 + u * 0.9);
      s.material.opacity = 0.42 * Math.sin(u * PI);
    }
  };
  steamAt(0.4);

  // obstacles the long hair must rest on (upper-body coordinates): the cardigan with its stooped back
  // (analytic), shoulders, arms, hands, the raised finger, the mug
  const solids = [];
  for (const a of [right, left]) {
    const s = toUp(a.sh), e = toUp(a.fore), h = toUp(a.hand);
    solids.push({ a: s, b: s, r: 0.62, fw: 1 }, { a: s, b: e, r: 0.56, fw: 1 }, { a: e, b: h, r: 0.53 }, { a: h, b: h, r: 0.5 });
  }
  solids.push({ a: toUp(left.hand), b: toUp(finger), r: 0.34 });
  solids.push({ a: mug.position.clone().add(V(0, -0.5, 0)), b: mug.position.clone().add(V(0, 0.6, 0)), r: 0.6 });
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
  // (fwd > 0 leans the way out of a shoulder or upper arm toward the front, so a broad sheet of hair rides
  // over the arm instead of wrapping round its side; such sheets keep only a small gap to the forearm, hand
  // and mug, which mostly sit in front of them, so they are not crumpled against the elbow)
  const pushOut = (P, off, fwd = 0) => {
    for (let it = 0; it < 4; it++) {
      if (P.y > 2.3 && P.y < 7.34) {
        const rj = radiusAt(J, P.y) + off;
        let rho = Math.hypot(P.x, P.z / SZJ);
        const c = rho > 1e-4 ? P.z / SZJ / rho : 1;
        const back = c < 0 ? hump(P.y) * Math.pow(-c, 1.5) : 0;
        const zz = P.z + back;
        rho = Math.hypot(P.x, zz / SZJ);
        if (rho < rj) { const k = rj / Math.max(rho, 1e-4); P.x *= k; P.z = zz * k - back; }
      }
      for (const s of solids) {
        tmp.subVectors(s.b, s.a);
        const L2 = tmp.lengthSq();
        const t = L2 > 1e-8 ? clamp(tmp2.subVectors(P, s.a).dot(tmp) / L2, 0, 1) : 0;
        const c = tmp2.copy(s.a).addScaledVector(tmp, t);
        const d = P.distanceTo(c), need = s.r + (fwd && !s.fw ? 0.35 * off : off);
        if (d >= need) continue;
        if (!fwd || !s.fw) { P.sub(c).multiplyScalar(need / Math.max(d, 1e-4)).add(c); continue; }
        const r = tmp3.subVectors(P, c).divideScalar(Math.max(d, 1e-4)), rz = r.z;
        const b = r.set(r.x, r.y, rz + fwd).normalize(), rb = (b.x * (P.x - c.x) + b.y * (P.y - c.y) + b.z * (P.z - c.z));
        P.addScaledVector(b, -rb + Math.sqrt(Math.max(0, rb * rb - d * d + need * need)));
      }
    }
    return P;
  };

  // ---- the big head
  const head = grp(up, HEAD.x, HEAD.y, HEAD.z);
  add(head, new THREE.SphereGeometry(HR, 40, 28), skin).scale.set(...HS);
  const F = ellipsoid(HR * HS[0], HR * HS[1], HR * HS[2]);
  const nrmH = (p) => V(p.x / (F.ax * F.ax), p.y / (F.ay * F.ay), p.z / (F.az * F.az)).normalize();
  const onFace = (x, y, out = 0) => { const z = F.z(x, y), p = V(x, y, z); return p.addScaledVector(nrmH(p), out); };
  const faceLine = (pts, r, mat, out = 0.004) => add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y]) => onFace(x, y, out))), 14, r, 5), mat);

  // eyes: deep-set dark dots with a highlight under heavy lids that slide down and slant for the scowl
  const eyes = [], lids = [], hls = [];
  const lidM = M.std(shade(C.skin, -0.1));
  const lashM = M.std('#2a2026', { r: 0.6 });
  const sockM = M.basic('#9a5638', 0.16);
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.CircleGeometry(0.3, 24), sockM), sx * 0.47, 0.06, 0.006).scale.set(1.2, 1.0, 1);
    const e = F.put(add(head, new THREE.SphereGeometry(0.165, 18, 14), M.std('#16111c', { r: 0.2 })), sx * 0.47, 0.0, -0.05);
    e.scale.set(1, 1.3, 0.5);
    eyes.push(e);
    const hl = F.put(add(head, new THREE.SphereGeometry(0.05, 10, 8), M.basic('#ffffff')), sx * 0.47 + 0.055, 0.075, 0.03);
    hl.userData.x = sx * 0.47 + 0.055;
    hls.push(hl);
    // heavy upper lid: a puffy skin lid with a dark lash line on its lower edge
    const lidG = grp(head);
    F.put(lidG, sx * 0.47, 0.0, 0.0);
    const lid = grp(lidG);
    add(lid, new THREE.SphereGeometry(0.21, 18, 12), lidM).scale.set(1.25, 0.62, 0.44);
    add(lid, new THREE.CapsuleGeometry(0.026, 0.4, 4, 8), lashM, 0, -0.118, 0.05).rotation.z = PI / 2;
    lid.userData.sx = sx;
    lids.push(lid);
    // bags under the eyes + crow's feet
    F.put(add(head, new THREE.TorusGeometry(0.15, 0.024, 6, 14, PI * 0.62), skinLine), sx * 0.5, -0.15, 0.004, PI * 1.19);
    for (const [dy, a] of [[0.07, 0.42], [-0.02, 0.05], [-0.11, -0.36]]) {
      F.put(add(head, new THREE.CapsuleGeometry(0.017, 0.09, 2, 5), skinLine), sx * 0.78, dy, 0.004, PI / 2 + sx * a);
    }
  }
  // forehead lines + the frown creases between the brows
  for (const [y, w] of [[0.8, 0.46], [0.905, 0.4], [1.005, 0.3]]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const x = -w + (2 * w * i) / 6; pts.push([x, y + 0.025 * Math.sin(i * 1.7 + y * 9) - 0.05 * (x / w) ** 2]); }
    faceLine(pts, 0.024, skinLine);
  }
  const creases = [];
  for (const sx of [-1, 1]) creases.push(F.put(add(head, new THREE.CapsuleGeometry(0.024, 0.2, 4, 6), skinLine), sx * 0.085, 0.3, 0.004, sx * 0.16));

  // enormous flat brows: each one thick flattened lock swept through control points on the forehead,
  // rounded at both ends (one surface, so no seams; re-laid in place whenever the expression lifts, slants
  // or arches it), with soft tufts at the ends. The path runs on past the end control points by the cap
  // length along the end segments, so each round cap closes just beyond its end point.
  const browPts = (sx) => BROW_XO.map((xo) => {
    const y = BROW_Y + cur.browY + cur.slant * xo + cur.arch * (1 - (xo / 0.42) ** 2);
    return onFace(sx * (BROW_X + xo), y, 0.085);
  });
  const browW = () => 0.92 * BROW_R * cur.browS, browH = () => 0.6 * BROW_R * cur.browS;
  const BROW_LOCK = { segs: 16, radial: 16, capRows: 5, capK: 1 / 0.92, capStart: true }; // (cap length = BROW_R * browS)
  const browOut = (Q) => nrmH(Q);
  const browPath = (P) => {
    const ext = BROW_R * cur.browS;
    const end = (a, b) => a.clone().addScaledVector(b.clone().sub(a).normalize(), -ext);
    return [end(P[0], P[1]), ...P, end(P[3], P[2])];
  };
  const brows = [];
  for (const sx of [-1, 1]) {
    const b = grp(head);
    b.userData.sx = sx;
    b.userData.lock = add(b, lockGeo(browPath(browPts(sx)), browW, browH, browOut, BROW_LOCK), browM);
    // [control point, along, up, tilt from 'up' toward 'away', radius, length]
    b.userData.tufts = [[0, 0.03, 0.1, 0.45, 0.075, 0.22], [3, 0.05, 0.02, 1.2, 0.072, 0.2], [3, 0.02, 0.1, 0.62, 0.07, 0.19]].map(([at, dx, dy, a, r, h]) => {
      const m = add(b, new THREE.SphereGeometry(1, 10, 8), browM);
      m.userData = { at, dx, dy, a, r, h };
      return m;
    });
    brows.push(b);
  }
  const layBrow = (b) => {
    const sx = b.userData.sx, P = browPts(sx);
    lockGeo(browPath(P), browW, browH, browOut, { ...BROW_LOCK, into: b.userData.lock.geometry });
    for (const m of b.userData.tufts) {
      // in-plane frame at the end: u points away from the brow, v up the forehead; tilt a from v toward u
      const { at, dx, dy, a, r, h } = m.userData;
      const end = P[at], u = end.clone().sub(P[at === 0 ? 1 : 2]).normalize();
      const v = nrmH(end).cross(u).normalize();
      if (v.y < 0) v.negate();
      const dir = v.clone().multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a)).normalize();
      m.position.copy(end).addScaledVector(u, dx * cur.browS).addScaledVector(v, dy * cur.browS).addScaledVector(dir, h * 0.25);
      m.quaternion.setFromUnitVectors(UP, dir);
      m.scale.set(r * cur.browS, h * 0.5 * cur.browS, r * 0.75 * cur.browS);
    }
  };

  // big bulbous nose on a broad bridge, nostril wings; heavy cheeks resting on the beard
  F.put(add(head, new THREE.SphereGeometry(0.2, 16, 12), skin), 0, -0.08, -0.08).scale.set(0.85, 1.3, 0.75);
  F.put(add(head, new THREE.SphereGeometry(0.37, 22, 16), ruddy), 0, -0.34, 0.1).scale.set(1.1, 0.93, 0.92);
  const cheekM = M.std(mix(C.skin, '#f08a88', 0.1));
  const blushM = M.basic('#f27f8c', 0.32);
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.SphereGeometry(0.15, 12, 10), ruddy), sx * 0.27, -0.46, 0.03).scale.set(1, 0.85, 0.8);
    F.put(add(head, new THREE.SphereGeometry(0.33, 18, 14), cheekM), sx * 0.84, -0.52, -0.04).scale.set(1.12, 0.9, 0.62);
    F.put(add(head, new THREE.CircleGeometry(0.17, 18), blushM), sx * 0.86, -0.48, 0.17).scale.set(1.25, 0.85, 1);
  }

  // ---- the mouth sits on a small skin pad that bulges out of the lower face, in the opening between the
  // moustache and the beard, so it faces forward instead of down. Every mouth is sunk into the pad: open
  // mouths are a dark ellipsoid cavity inside a closed ring of lips swept along the pad; closed mouths are a
  // dark lip line over a pouting lower lip, swept along the pad with round ends (no open torus arcs).
  // Pink lips on a dark inside read on the black beard from across the room.
  const PAD = V(0, -1.05, 0.64), FP = ellipsoid(0.43, 0.42, 0.46);
  named('mouth', add(head, new THREE.SphereGeometry(1, 22, 14), skin, PAD.x, PAD.y, PAD.z)).scale.set(FP.ax, FP.ay, FP.az);
  const nrmP = (p) => V(p.x / FP.ax ** 2, p.y / FP.ay ** 2, p.z / FP.az ** 2).normalize();
  const onPad = (x, y) => V(x, y, FP.z(x, y));
  const lipM = M.std(C.lip, { r: 0.6 }), inM = M.std(C.mouth, { r: 0.7 });
  const mouth = grp(head, PAD.x, PAD.y, PAD.z); // mouth pieces live in pad coordinates
  const mouths = { frown: grp(mouth), flat: grp(mouth), o: grp(mouth), talk: grp(mouth) };
  // a lip roll along [x, y] points on the pad, round at both ends; w across the lip, h out of the pad
  const lipRoll = (parent, pts, w, h, mat) => add(parent, lockGeo(pts.map(([x, y]) => onPad(x, y)), () => w, () => h, (P) => nrmP(P), { segs: 12, radial: 8, capRows: 3, capStart: true }), mat);
  const arc = (y0, half, sag, n = 7) => Array.from({ length: n }, (_, i) => { const x = -half + (2 * half * i) / (n - 1); return [x, y0 - sag * (x / half) ** 2]; });
  // a closed ring of lips round (0, y0) on the pad, and the dark cavity sunk into the pad inside it
  const RING_N = 36, RING_R = 8;
  const lipRing = (parent, y0, rx, ry, r) => {
    const pts = [];
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; pts.push(onPad(rx * Math.cos(a), y0 + ry * Math.sin(a))); }
    const crv = new THREE.CatmullRomCurve3(pts, true);
    const m = add(parent, new THREE.TubeGeometry(crv, RING_N, r, RING_R, true), lipM);
    m.userData.crv = crv;
    return m;
  };
  const placeHole = (m, y0, rx, ry, d = 0.08) => FP.put(m, 0, y0, -0.55 * d).scale.set(rx, ry, d);
  const cavity = (parent, y0, rx, ry) => {
    const m = add(parent, new THREE.SphereGeometry(1, 18, 12), inM);
    placeHole(m, y0, rx, ry);
    return m;
  };
  // grumpy: a downturned lip line over a pouting lower lip
  lipRoll(mouths.frown, arc(0.07, 0.25, 0.12), 0.042, 0.03, inM);
  lipRoll(mouths.frown, arc(-0.02, 0.19, 0.09), 0.066, 0.052, lipM);
  // neutral: a flat, tight line
  lipRoll(mouths.flat, arc(0.05, 0.22, 0.015), 0.038, 0.028, inM);
  lipRoll(mouths.flat, arc(-0.03, 0.16, -0.01), 0.058, 0.048, lipM);
  // surprised: a big round O, taller than wide (the jaw drops and the moustache lifts to make room)
  cavity(mouths.o, -0.07, 0.2, 0.25);
  lipRing(mouths.o, -0.07, 0.22, 0.27, 0.058);
  // talking: an open mouth with teeth and a tongue; animate() opens and shuts it from the upper lip down,
  // moving the lower half of the ring along the pad (so the lips never sink into it or float off it)
  const TALK = { y: -0.02, rx: 0.27, ry: 0.19 };
  const talkHole = cavity(mouths.talk, TALK.y, 0.25, 0.17);
  const talkRing = lipRing(mouths.talk, TALK.y, TALK.rx, TALK.ry, 0.05);
  const tongue = add(mouths.talk, new THREE.SphereGeometry(1, 12, 8), M.std(C.tongue));
  FP.put(add(mouths.talk, new THREE.CapsuleGeometry(0.038, 0.22, 4, 8), M.std('#fffaf0')), 0, TALK.y + 0.115, 0, PI / 2); // teeth
  const ringBase = talkRing.geometry.attributes.position.array.slice();
  const ringC = Array.from({ length: RING_N + 1 }, (_, i) => talkRing.userData.crv.getPointAt(i / RING_N));
  const topY = TALK.y + TALK.ry;
  const openMouth = (s) => {
    // s: 1 wide open .. ~0.25 nearly shut; every point keeps its height below the upper lip times s
    const pa = talkRing.geometry.attributes.position;
    for (let i = 0; i <= RING_N; i++) {
      const c = ringC[i], y = topY + (c.y - topY) * s, dz = FP.z(c.x, y) - FP.z(c.x, c.y);
      for (let j = 0; j <= RING_R; j++) {
        const q = 3 * (i * (RING_R + 1) + j);
        pa.array[q + 1] = ringBase[q + 1] + (y - c.y);
        pa.array[q + 2] = ringBase[q + 2] + dz;
      }
    }
    pa.needsUpdate = true;
    const cy = topY - TALK.ry * s;
    placeHole(talkHole, cy, 0.25, 0.17 * s);
    FP.put(tongue, 0, cy - 0.08 * s, -0.012).scale.set(0.14, 0.075 * Math.max(0.5, s), 0.05);
  };
  openMouth(1);

  // ---- the beard: a shell over the jaw and cheeks (open around the mouth), a full bushy mass growing
  // from under the lip down onto the chest in a few broad soft lobes with a rounded end, and a drooping
  // moustache merging into it
  const beardTop = line([[0, 0.885], [0.16, 0.875], [0.28, 0.83], [0.38, 0.765], [0.47, 0.705], [0.6, 0.66], [0.8, 0.62], [1.05, 0.56], [1.3, 0.49], [1.75, 0.455]]);
  // bushy at the jaw corners (jowls), so the beard grows out of the jaw instead of hanging like a bib
  const jowl = (phi, th) => smooth(0.58 * PI, 0.74 * PI, th) * (1 - 0.6 * smooth(0.9 * PI, PI, th)) * Math.exp(-(((Math.abs(phi) - 0.72) / 0.42) ** 2));
  const beardK = (phi, th) => 1.05 + 0.09 * smooth(0.55 * PI, 0.85 * PI, th) * (0.5 + 0.5 * Math.cos(phi) ** 2) + 0.1 * jowl(phi, th);
  add(head, shellGeo(F, { phi0: -1.8, phi1: 1.8, top: beardTop, bottom: () => 0.97 * PI, k: beardK, segU: 56, segV: 12, rim: 0.95 }), hairM);
  const beardG = grp(head, 0, BEARD_Y, 0.38); // (the jaw: it drops when the mouth opens)
  beardG.rotation.x = -0.1;
  const BP = profile([[0, -1.64], [0.34, -1.61], [0.6, -1.51], [0.83, -1.32], [1.0, -1.04], [1.1, -0.68], [1.1, -0.32], [0.98, -0.06], [0.76, 0.06], [0.44, 0.12], [0, 0.14]], 24);
  named('beard', add(beardG, beardGeo(BP, { seg: 70, sz: 0.62, lobes: 10, amp: 0.075, drop: 0.24, notch: 0.1, notchW: 0.42 }), hairM));
  // a dark mass under the chin, behind the beard's top, so no gap opens onto the collar when the jaw drops
  add(head, new THREE.SphereGeometry(1, 16, 10), hairDeep, 0, -1.36, 0.16).scale.set(0.98, 0.34, 0.62);
  // the moustache: two bushy lobes from under the nose drooping into the beard, bridged in the middle
  // (it lifts a little with the upper lip when the mouth opens)
  const stache = grp(head);
  for (const sx of [-1, 1]) {
    const pts = [[-0.06, -0.59], [0.3, -0.665], [0.55, -0.79], [0.7, -0.98], [0.72, -1.16]].map(([x, y], i) => onFace(sx * x, y, 0.09 - 0.015 * i));
    add(stache, lockGeo(pts, taper(0.245, 0.65), taper(0.14, 0.7), (P) => nrmH(P), { segs: 20, radial: 10 }), hairM);
  }
  F.put(add(stache, new THREE.SphereGeometry(0.2, 14, 10), hairM), 0, -0.6, 0.11).scale.set(1.25, 0.95, 0.7);

  // ---- hair: long, black, a bit unkempt; parted off-centre, broad locks sweeping back over the temples
  // (lower on his right), a mane down the back and locks over the shoulders onto the chest.
  // The cap carries the parting (a groove and a little notch in the hairline) off-centre on his left.
  const PART = 0.17; // lateral position of the parting, as a fraction of the head's half-width
  const capLine = line([[0, 0.17], [0.25, 0.185], [0.5, 0.215], [0.75, 0.255], [0.95, 0.3], [1.15, 0.38], [1.35, 0.48], [1.75, 0.6], [2.3, 0.67], [PI, 0.69]],
    (phi) => -0.03 * Math.exp(-(((phi - 0.32) / 0.08) ** 2)));
  const groove = (phi, th) => {
    const xs = Math.sin(th) * Math.sin(phi), zs = Math.sin(th) * Math.cos(phi);
    return 0.06 * Math.exp(-(((xs - PART) / 0.06) ** 2)) * smooth(-0.2, 0.25, zs);
  };
  // (soft lumps over the crown: a bit unkempt, never spiky)
  const lumps = (phi, th) => 0.022 * Math.sin(3 * phi + 1.1) * Math.sin(4.2 * th + 0.4) * smooth(0.02 * PI, 0.12 * PI, th);
  const capK = (phi, th) => 1.075 + 0.055 * Math.max(0, Math.cos(th)) + 0.07 * smooth(0.35 * PI, 0.65 * PI, th) * smooth(1.2, 2.4, Math.abs(phi)) + lumps(phi, th) - groove(phi, th);
  add(head, shellGeo(F, { bottom: capLine, k: capK, segU: 84, segV: 16, rim: 0.95 }), hairM);
  const onCap = (phi, th, extra = 0.02) => F.at(phi, th * PI, capK(phi, th * PI) + extra);
  const sweep = (path, w, h, mat, extra = 0) => named('hair', add(head, lockGeo(path.map(([p, t]) => onCap(p, t, extra)), taper(w, 0.72), taper(h, 0.8), (P) => nrmH(P), { segs: 18, radial: 9 }), mat));
  // his right (the big side of the parting) sweeps lower across the forehead corner, his left stays higher;
  // a second lock on each side runs back over the head
  sweep([[0.25, 0.125], [0.0, 0.155], [-0.35, 0.18], [-0.7, 0.235], [-1.02, 0.3], [-1.23, 0.39], [-1.37, 0.48]], 0.27, 0.12, hairM);
  sweep([[0.24, 0.05], [-0.3, 0.08], [-0.95, 0.15], [-1.65, 0.27], [-2.2, 0.41], [-2.5, 0.55]], 0.34, 0.09, hair2);
  sweep([[0.4, 0.12], [0.62, 0.15], [0.88, 0.205], [1.12, 0.28], [1.29, 0.37], [1.41, 0.47]], 0.24, 0.12, hairM);
  sweep([[0.42, 0.05], [0.85, 0.08], [1.4, 0.15], [1.95, 0.28], [2.38, 0.42], [2.62, 0.56]], 0.32, 0.09, hair2);

  // locks that leave the head: built in upper-body coordinates, pushed clear of the body, arms and mug
  const headOut = (P) => nrmH(tmp.copy(P).sub(HEAD));
  const drapeOut = (P) => {
    const k = smooth(HEAD.y - 0.7, HEAD.y - 1.6, P.y);
    return headOut(P).multiplyScalar(1 - k).add(bodyOut(P).multiplyScalar(k)).normalize();
  };
  const hairLock = (ctrl, W, H, mat, off, out = drapeOut, capK2 = 1, sq = 2.8) => {
    // sample the path, keep every sample clear of the body (push + smooth passes), then sweep the lock
    let pts = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5).getSpacedPoints(16);
    for (let pass = 0; pass < 3; pass++) {
      pts = pts.map((p, i) => (p.y < HEAD.y - 0.9 ? pushOut(p, off(i / (pts.length - 1))) : p));
      if (pass < 2) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : p.clone().add(pts[i - 1]).add(pts[i + 1]).multiplyScalar(1 / 3)));
    }
    const g = lockGeo(pts, W, H, out, { segs: 20, radial: 10, capK: capK2, sq });
    g.translate(-HEAD.x, -HEAD.y, -HEAD.z);
    return named('hair', add(head, g, mat));
  };
  const hAt = (phi, th, k) => F.at(phi, th * PI, k).add(HEAD);
  const bAt = (phi, y, off) => { const r = radiusAt(J, y) + off, c = Math.cos(phi); return V(r * Math.sin(phi), y, r * c * SZJ - (c < 0 ? hump(y) * Math.pow(-c, 1.5) : 0)); };

  // the mane down the back, from the crown to the shoulder blades, over a dark under-layer
  const backPhis = [PI - 1.05, PI - 0.7, PI - 0.35, PI, PI + 0.35, PI + 0.7, PI + 1.05];
  backPhis.forEach((phi, i) => {
    const tipY = 5.05 + (rand() - 0.5) * 0.36 + (i % 2 ? 0.14 : -0.06);
    const ctrl = [hAt(phi, 0.26, 0.97), hAt(phi, 0.4, 1.17), hAt(phi, 0.58, 1.22), bAt(phi, 6.85, 0.3), bAt(phi, 6.0, 0.24), bAt(phi + (rand() - 0.5) * 0.12, tipY, 0.28)];
    // alternate locks lie a little further out, so neighbours overlap in layers instead of cutting through each other
    const lift = i % 2 ? 0.07 : 0;
    hairLock(ctrl, maneW(i % 2 ? 0.5 : 0.56), taper(0.12, 0.75), i % 3 === 1 ? hair2 : hairM, (u) => 0.2 * (1 - u) + 0.22 + lift);
  });
  hairLock([hAt(PI, 0.4, 0.9), hAt(PI, 0.6, 1.1), bAt(PI, 6.85, 0.16), bAt(PI, 6.0, 0.12), bAt(PI, 5.3, 0.12)], taper(1.25, 0.88), taper(0.1, 0.85), hairDeep, () => 0.16, drapeOut, 0.25);

  // A broad soft sheet of hair between two edge paths (inner edge c = -1, outer edge c = +1, control points
  // matched one to one). Each column interpolates the edges, is sampled, kept clear of the body (pushOut) and
  // smoothed along and across, then stops at its own length (cut(c): world units taken off its end), so the
  // sheet ends in a row of soft rounded lobes. The half-thickness H fades to 0 at the side edges (a flat
  // superellipse, so they are blunt and rounded, not knife-thin) and over the last capLen of every column,
  // so the front and back faces close into a rounded rim; grooves [[c, depth, width]] dent the front along
  // a column, bulge rounds the sheet across its width.
  const drape = (inner, outer, mat, { nc = 12, nr = 11, capRows = 4, capLen = 0.34, H = 0.075, off = 0.3, cut = () => 0, grooves = [], bulge = 0.04, fwd = 1.5 } = {}) => {
    const cols = [];
    for (let j = 0; j <= nc; j++) {
      // (columns crowd toward the side edges, so the rounded rim is resolved)
      const c0 = -1 + (2 * j) / nc, c = 0.45 * c0 + 0.55 * Math.sin((c0 * PI) / 2);
      const crv = new THREE.CatmullRomCurve3(inner.map((p, k) => p.clone().lerp(outer[k], (c + 1) / 2)), false, 'catmullrom', 0.5);
      const L = crv.getLength(), ue = clamp(1 - cut(c) / L, 0.3, 1), vc = 1 - Math.min(0.3, capLen / (ue * L));
      const rows = [];
      for (let i = 0; i < nr; i++) rows.push({ v: (vc * i) / nr, f: 1 });
      for (let k = 0; k <= capRows; k++) { const a = (k / capRows) * (PI / 2); rows.push({ v: vc + (1 - vc) * Math.sin(a), f: Math.cos(a) }); }
      for (const r of rows) r.p = crv.getPointAt(r.v * ue);
      cols.push({ c, rows });
    }
    const NR = nr + capRows + 1, at = (j, i) => cols[j].rows[i].p;
    for (let pass = 0; pass < 3; pass++) {
      for (const col of cols) for (const r of col.rows) if (r.p.y < HEAD.y - 0.9) pushOut(r.p, off, fwd);
      if (pass === 2) break;
      const next = cols.map((col, j) => col.rows.map((r, i) => {
        if (i === 0 || i === NR - 1) return r.p.clone();
        const q = r.p.clone().multiplyScalar(2).add(at(j, i - 1)).add(at(j, i + 1));
        if (j === 0 || j === nc || i > nr * 0.7) return q.multiplyScalar(0.25);
        return q.add(at(j - 1, i)).add(at(j + 1, i)).multiplyScalar(1 / 6);
      }));
      cols.forEach((col, j) => col.rows.forEach((r, i) => r.p.copy(next[j][i])));
    }
    // mid-surface normals (facing away from the body), then the front and back faces
    const A = new THREE.Vector3(), D = new THREE.Vector3();
    const nrm = cols.map((col, j) => col.rows.map((r, i) => {
      A.subVectors(at(Math.min(nc, j + 1), i), at(Math.max(0, j - 1), i));
      D.subVectors(at(j, Math.min(NR - 1, i + 1)), at(j, Math.max(0, i - 1)));
      const n = new THREE.Vector3().crossVectors(A, D).normalize();
      return n.dot(drapeOut(r.p)) < 0 ? n.negate() : n;
    }));
    const groove = (c) => grooves.reduce((g, [gc, d, w]) => g * (1 - d * Math.exp(-(((c - gc) / w) ** 2))), 1);
    const RING = 2 * nc, pos = [], idx = [];
    for (let i = 0; i < NR; i++) for (let k = 0; k < RING; k++) {
      const front = k <= nc, j = front ? k : RING - k, { c } = cols[j], r = cols[j].rows[i], n = nrm[j][i];
      const h = H * Math.max(0, 1 - Math.abs(c) ** 3) ** (1 / 3) * r.f * (front ? groove(c) : -1) + bulge * (1 - c * c);
      pos.push(r.p.x + n.x * h - HEAD.x, r.p.y + n.y * h - HEAD.y, r.p.z + n.z * h - HEAD.z);
    }
    // wind the triangles so they face outward (checked on the middle of the front face)
    const P3 = (q) => V(pos[3 * q], pos[3 * q + 1], pos[3 * q + 2]), mi = Math.floor(nr / 2) * RING + Math.floor(nc / 2);
    const flip = A.subVectors(P3(mi + 1), P3(mi)).cross(D.subVectors(P3(mi + RING), P3(mi))).dot(nrm[Math.floor(nc / 2)][Math.floor(nr / 2)]) < 0;
    for (let i = 0; i < NR - 1; i++) for (let k = 0; k < RING; k++) {
      const a = i * RING + k, b = i * RING + ((k + 1) % RING), c2 = a + RING, d = b + RING;
      if (flip) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return named('hair', add(head, g, mat));
  };
  // how much a lock's end is cut back across its width: soft round lobes [[c, radius, height]] and rounded corners
  const lobed = (spec, notch, corner) => (c) => {
    let keep = 1;
    for (const [cc, r, a] of spec) { const t2 = ((c - cc) / r) ** 2; if (t2 < 1) keep *= 1 - a * (1 - t2) ** 0.7; }
    return notch * keep + corner * (1 - Math.sqrt(Math.max(0, 1 - c * c)));
  };

  // long hair beside the face: one soft mass per side falling over the front of the shoulder onto the chest.
  // A continuous dark under-layer from the temple down to the chest, then three broad flat locks of different
  // lengths overlapping on top of it, each ending in two broad soft lobes, the overlaps reading as grooves
  for (const sx of [-1, 1]) {
    const S = (x, y, z) => V(sx * x, y, z);
    const onHead = (phi, th, k) => hAt(sx * phi, th, k);
    // a lock rooted around azimuth phi (±dphi) on the side of the head, falling through body points
    // [x, y, z, half-width]; its outer edge wraps back a little more than its inner edge
    const lock = (phi, dphi, pts, mat, opt) => drape(
      [onHead(phi - dphi, 0.3, 0.96), onHead(phi - dphi * 1.1, 0.47, 1.12), ...pts.map(([x, y, z, w]) => S(x - w, y, z - 0.06 * w))],
      [onHead(phi + dphi, 0.32, 0.96), onHead(phi + dphi * 1.1, 0.5, 1.14), ...pts.map(([x, y, z, w]) => S(x + w, y, z - 0.3 * w))],
      mat, opt);
    // the dark under-layer, temple to chest, from beside the beard round to the top of the shoulder; it ends
    // in a plain rounded edge a little above the lock tips
    drape([onHead(0.92, 0.3, 0.96), onHead(0.98, 0.47, 1.1), S(1.3, 7.45, 1.0), S(1.14, 6.8, 1.12), S(1.04, 6.15, 1.16), S(1.0, 5.85, 1.16)],
      [onHead(1.66, 0.36, 0.96), onHead(1.7, 0.52, 1.15), S(1.92, 7.3, 0.55), S(2.02, 6.7, 0.78), S(1.96, 6.1, 0.92), S(1.92, 5.9, 0.94)],
      hairDeep, { nc: 8, H: 0.08, off: 0.2, bulge: 0.06, cut: lobed([], 0, 0.3) });
    // the three locks on top: inner, outer and (longest, lying over both) middle, each with two broad soft
    // lobes at the end; his two sides differ a little (shorter on the mug side, clear of the forearm)
    const k = sx > 0 ? 1 : 0;
    lock(1.04, 0.14, [[1.44, 7.42, 1.0, 0.3], [1.3, 6.8, 1.2, 0.48], [1.22, 6.1, 1.3, 0.58], [1.2, 5.52 - 0.1 * k, 1.34, 0.6]], hairM,
      { off: 0.3, cut: lobed([[-0.42, 0.75, 0.9], [0.46, 0.7, 0.75]], 0.17, 0.2), grooves: [[0.02, 0.3, 0.2]] });
    // (on the mug side the outer and middle locks keep to the top of the arm)
    lock(1.44, 0.15, [[1.8, 7.3, 0.7, 0.28], [1.8 - 0.06 * (1 - k), 6.72, 0.98, 0.44], [1.74 - 0.1 * (1 - k), 6.05, 1.14, 0.52 - 0.08 * (1 - k)], [1.7 - 0.14 * (1 - k), 5.66 + 0.08 * k, 1.18, 0.54 - 0.12 * (1 - k)]], hair2,
      { off: 0.27, cut: lobed([[-0.38, 0.8, 0.85], [0.52, 0.65, 0.9]], 0.15, 0.22), grooves: [[0.12, 0.3, 0.2]] });
    lock(1.22, 0.13, [[1.62, 7.38, 0.9, 0.26], [1.52 - 0.04 * (1 - k), 6.76, 1.16, 0.44], [1.44 - 0.1 * (1 - k), 6.0, 1.28, 0.56 - 0.07 * (1 - k)], [1.42 - 0.1 * (1 - k), 5.42 - 0.14 * k, 1.32, 0.58 - 0.07 * (1 - k)]], hairM,
      { off: 0.36, cut: lobed([[-0.5, 0.7, 0.8 + 0.1 * k], [0.4, 0.75, 0.9 - 0.1 * k]], 0.18, 0.2), grooves: [[-0.08, 0.32, 0.2]] });
    // over the shoulder: on the side of the raised arm it rests on the shoulder top, on the mug side it
    // falls behind the arm (never wrapping around an arm)
    hairLock(sx > 0
      ? [hAt(1.6, 0.45, 0.95), hAt(1.66, 0.58, 1.2), V(1.8, 7.3, 0.1), V(1.92, 7.08, -0.08)]
      : [hAt(-1.6, 0.45, 0.95), hAt(-1.66, 0.58, 1.2), V(-1.86, 7.25, 0.05), V(-2.0, 6.6, -0.2), V(-1.95, 6.02, -0.4)],
    taper(0.4, 0.64), taper(0.13, 0.8), hairM, () => 0.28);
    hairLock([hAt(sx * 1.85, 0.48, 0.95), hAt(sx * 1.85, 0.62, 1.2), V(sx * 1.5, 6.9, -0.7), V(sx * 1.45, 6.2, -0.98), V(sx * 1.38, 5.5, -1.1)],
      taper(0.42, 0.64), taper(0.12, 0.8), hair2, () => 0.28);
  }

  finishShadows(root);
  steam.forEach((s) => { s.castShadow = false; });

  // ---- expressions + animation
  let expr = 'grumpy';
  let started = false, t = 0, blink = 2.5, mouthOpen = 1;
  // body language that goes with the face: the head tips back and the lecturing hand flies up when startled;
  // the jaw (the whole beard) drops and the moustache lifts as the mouth opens
  const pose = (talk) => {
    head.rotation.x = cur.tilt + (talk ? Math.sin(t * 6.1) * 0.025 : 0);
    left.fore.rotation.z = 1.98 + (talk ? Math.sin(t * 9) * 0.22 : Math.sin(t * 1.2) * 0.04) + cur.startle * 0.25;
    left.sh.rotation.z = 0.88 + (talk ? Math.sin(t * 4.5) * 0.05 : 0) + cur.startle * 0.12;
    const open = mouths.talk.visible ? mouthOpen : 0;
    beardG.position.y = BEARD_Y - JAW * (cur.jaw + 0.6 * open);
    stache.position.y = 0.055 * cur.lift + 0.02 * open;
  };
  let browKey = ''; // the brow values the brows were last laid with: they are only re-laid when these move
  const apply = (blinking) => {
    const key = [cur.browY, cur.slant, cur.arch, cur.browS].map((v) => v.toFixed(5)).join();
    if (key !== browKey) { browKey = key; brows.forEach(layBrow); }
    const lidY = 0.34 - cur.lid * 0.3;
    eyes.forEach((e, i) => {
      e.scale.set(cur.eyeX, blinking ? 0.12 : 1.3 * cur.eyeY, 0.5);
      hls[i].visible = !blinking;
      F.put(hls[i], hls[i].userData.x, Math.min(0.075 + 0.2 * (cur.eyeY - 1), lidY - 0.185), 0.03);
    });
    for (const c of creases) { c.visible = cur.crease > 0.05; c.scale.set(1, Math.max(0.01, cur.crease), 1); }
    for (const lid of lids) {
      const kk = cur.lid;
      lid.visible = kk > 0.03 || blinking;
      lid.position.y = blinking ? 0.0 : lidY;
      lid.rotation.z = blinking ? 0 : lid.userData.sx * 0.32 * Math.min(1, kk * 2);
      lid.scale.set(cur.eyeX, blinking ? 1.45 : 1, 1);
    }
  };
  const showMouth = () => {
    const which = expr === 'grumpy' ? 'frown' : expr === 'surprised' ? 'o' : expr === 'talking' ? 'talk' : 'flat';
    for (const [k, m] of Object.entries(mouths)) m.visible = k === which;
  };
  root.userData.expression = () => expr;
  root.userData.setExpression = (name) => {
    expr = Object.prototype.hasOwnProperty.call(EXPRESSIONS, name) ? name : 'neutral'; // ('toString' etc. are unknown too)
    showMouth();
    if (!started) { Object.assign(cur, EXPRESSIONS[expr]); apply(false); pose(false); }
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
    if (talk) {
      for (const [key, m] of Object.entries(mouths)) m.visible = key === 'talk';
      mouthOpen = 0.25 + 0.75 * Math.abs(Math.sin(t * 11 + Math.sin(t * 3.1) * 2));
      openMouth(mouthOpen);
    } else showMouth();
    // breathing, a grumpy little bob while talking, the stoop settling
    const breath = Math.sin(t * 1.5);
    body.position.y = breath * 0.03 + (talk ? Math.abs(Math.sin(t * 6.5)) * 0.06 : 0);
    lean.rotation.x = LEAN + breath * 0.008 + (talk ? Math.sin(t * 3.2) * 0.012 : 0);
    head.rotation.z = Math.sin(t * 0.8) * 0.018 + (talk ? Math.sin(t * 5.3) * 0.02 : 0);
    pose(talk);
    steamAt(t + 0.4);
  };
  root.userData.setExpression('grumpy');
  return root;
}
