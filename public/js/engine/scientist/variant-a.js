// Variant A, "the hermit": Jean-Lafontaine de Becancourt, a grumpy old man (no scientist costume).
// Long straight black hair with a centre parting, falling past the shoulders in heavy locks; a very full,
// bushy black beard down onto the chest; huge shaggy black brows; tired, deep-set eyes with bags; a big nose;
// a chunky olive cable-knit sweater with a rolled neck, old corduroy trousers and felt slippers.
// Same toy style as humans.js: primitives, lathes and tubes only.
//   buildScientist() -> THREE.Group, feet at y = 0, faces +z, ~9.9 units tall, head centre at y ~8.3
import * as THREE from 'three';
import { materials, add, grp, ellipsoid, shellGeo, profile, revolveGeo, taperTubeGeo, surfaceArc, rng, curve, mix, clamp, smooth, finishShadows, PI, TAU, DS } from '../toyparts.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------------------------
// geometry helpers (deterministic)

// indexed surface from a (rows + 1) x cols grid of points whose columns wrap around; smooth normals
function gridGeo(rows, cols, at, flip = false) {
  const pos = [], idx = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j < cols; j++) pos.push(...at(i, j));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const j1 = (j + 1) % cols;
    const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j, d = (i + 1) * cols + j1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// surface of revolution with vertical ribs (knit bands, corduroy): radius * (1 + amp cos(ribs phi)), squashed in z
function ribRevolveGeo(pts, { seg = 96, sz = 1, ribs = 0, amp = 0 } = {}) {
  return gridGeo(pts.length - 1, seg, (i, j) => {
    const p = pts[i], phi = (j / seg) * TAU, r = p.x * (1 + amp * Math.cos(ribs * phi));
    return [r * Math.sin(phi), p.y, r * Math.cos(phi) * sz];
  });
}

// a ribbed ring lying in the xz plane (roll neck, slipper cuffs); the seam is at the back
function ribTorusGeo(R, r, { ribs = 24, amp = 0.1, sz = 1, segU = 96, segV = 14 } = {}) {
  return gridGeo(segU, segV, (i, j) => {
    const u = PI + (i / segU) * TAU, v = (j / segV) * TAU;
    const rr = r * (1 + amp * Math.cos(ribs * u)), d = R + rr * Math.cos(v);
    return [d * Math.sin(u), rr * Math.sin(v), d * Math.cos(u) * sz];
  }, true);
}

// A flat lock of hair (or beard) along a smooth curve: elliptical section with half-width w(u) across and
// half-thickness t(u) along out(P) (away from what the lock lies on); both ends rounded.
function lockGeo(pts, { w, t, out, segs = 26, radial = 12, tip = 0.14, root = 0.07 }) {
  const crv = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const us = [], ks = [];
  const NR = 4, NT = 6, NB = Math.max(4, segs - NR - NT);
  for (let i = 0; i < NR; i++) { const a = (i / NR) * (PI / 2); us.push(root * (1 - Math.cos(a))); ks.push(Math.sin(a)); }
  for (let i = 0; i < NB; i++) { us.push(root + ((1 - tip - root) * i) / NB); ks.push(1); }
  for (let i = 0; i <= NT; i++) { const a = (i / NT) * (PI / 2); us.push(1 - tip + tip * Math.sin(a)); ks.push(Math.cos(a)); }
  const rows = us.map((u, i) => {
    const P = crv.getPointAt(u), T = crv.getTangentAt(u);
    const O = out(P, u).clone();
    O.addScaledVector(T, -O.dot(T)).normalize();
    const S = V().crossVectors(T, O).normalize();
    return { P, O, S, w: Math.max(0.002, w(u) * ks[i]), t: Math.max(0.002, t(u) * ks[i]) };
  });
  return gridGeo(rows.length - 1, radial, (i, j) => {
    const r = rows[i], a = (j / radial) * TAU, c = Math.cos(a) * r.w, s = Math.sin(a) * r.t;
    return [r.P.x + r.S.x * c + r.O.x * s, r.P.y + r.S.y * c + r.O.y * s, r.P.z + r.S.z * c + r.O.z * s];
  }, true);
}

// merge [{ geo, m: Matrix4 }] into one geometry (fewer meshes for knit cables, brows, wrinkles)
function mergeGeos(list) {
  const pos = [], nor = [], idx = [];
  const v = V(), nm = new THREE.Matrix3();
  let base = 0;
  for (const { geo, m = new THREE.Matrix4() } of list) {
    nm.getNormalMatrix(m);
    const P = geo.attributes.position, N = geo.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    base += P.count;
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
const mat4 = (p, e = new THREE.Euler(), s = V(1, 1, 1)) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(e), s);

// radius of a sampled profile at height y
function radiusAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.y - y) * (b.y - y) <= 0) { const u = (y - a.y) / (b.y - a.y || 1); return a.x + (b.x - a.x) * u; }
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Jean-Lafontaine de Becancourt

const SZ = 0.82;              // torso depth / width
const WAIST = 2.9;            // the upper body hunches about this height
const HEAD = V(0, 8.3, 0.32); // head centre (pushed forward: old, hunched)
const HR = 1.42, HS = [1.08, 0.97, 1.0];
const HUNCH = 0.07;

const EXPRESSIONS = {
  neutral: { browY: 0.0, browRot: 0.12, browS: 1.0, eyeY: 1.0, eyeX: 1.0, lid: 0.26, crease: 0.15 },
  grumpy: { browY: -0.12, browRot: 0.44, browS: 1.06, eyeY: 0.86, eyeX: 1.0, lid: 0.58, crease: 1 },
  surprised: { browY: 0.3, browRot: -0.2, browS: 1.04, eyeY: 1.3, eyeX: 1.16, lid: 0, crease: 0 },
  talking: { browY: -0.05, browRot: 0.3, browS: 1.02, eyeY: 0.95, eyeX: 1.0, lid: 0.36, crease: 0.55 },
};

export function buildScientist() {
  const M = materials();
  const rand = rng(19580312);
  const C = {
    skin: '#efc09c', wrinkle: '#c98d69', socket: '#9a5a44', blush: '#ff8aa8',
    hair: '#28232f', hair2: '#201c26', beard: '#2f2829', brow: '#1e1a1f', part: '#d9a585',
    knit: '#7f8548', knitD: '#6a6f3b', knitL: '#949a58',
    cord: '#6f5338', slipper: '#7b3636', fleece: '#efe3c8', sole: '#3b2a22',
    mug: '#f4f0e6', mugRim: '#2f4f86', coffee: '#4a2a14',
  };
  const skin = M.std(C.skin);
  const hairM = M.std(C.hair, { r: 0.72, side: DS });
  const hair2M = M.std(C.hair2, { r: 0.72, side: DS });
  const beardM = M.std(C.beard, { r: 0.8, side: DS });
  const browM = M.std(C.brow, { r: 0.9 });
  const knit = M.std(C.knit, { r: 0.95 });
  const knitD = M.std(C.knitD, { r: 0.95, side: DS });
  const knitL = M.std(C.knitL, { r: 0.9 });
  const wrinkleM = M.std(C.wrinkle, { r: 0.9 });

  const root = new THREE.Group();
  root.name = 'jean-lafontaine';
  const body = grp(root);

  // ---- legs: old corduroy trousers, felt slippers with a fleece cuff
  const legPts = profile([[0, 0.36], [0.46, 0.38], [0.56, 0.52], [0.58, 1.2], [0.57, 2.2], [0.54, 2.85], [0.3, 3.05], [0, 3.1]], 14);
  const legGeo = ribRevolveGeo(legPts, { seg: 48, ribs: 16, amp: 0.035 });
  const cordM = M.std(C.cord, { r: 0.95 });
  const cuffSlipper = ribTorusGeo(0.46, 0.14, { ribs: 16, amp: 0.16, segU: 40, segV: 8 });
  for (const sx of [-1, 1]) {
    add(body, legGeo, cordM, sx * 0.66, 0, 0).name = 'leg';
    const sl = grp(body, sx * 0.68, 0, 0.3);
    add(sl, new THREE.SphereGeometry(0.62, 24, 16), M.std(C.slipper, { r: 0.9 }), 0, 0.3, 0.06).scale.set(0.95, 0.52, 1.45);
    add(sl, new THREE.CylinderGeometry(0.6, 0.6, 0.12, 24), M.std(C.sole, { r: 0.8 }), 0, 0.06, 0.06).scale.set(0.97, 1, 1.47);
    add(sl, cuffSlipper, M.std(C.fleece, { r: 1 }), -sx * 0.02, 0.53, -0.28);
  }

  // ---- upper body (pivots at the waist for the hunch); `uo` is in plain body coordinates
  const upper = grp(body, 0, WAIST, 0);
  upper.rotation.x = HUNCH;
  const uo = grp(upper, 0, -WAIST, 0);

  // chunky sweater: barrel torso, ribbed hem, rounded upper back, ribbed roll neck, cables down the front
  const torsoPts = profile([[0, 2.55], [1.18, 2.58], [1.52, 2.95], [1.67, 3.7], [1.7, 4.5], [1.63, 5.35], [1.5, 6.0], [1.3, 6.55], [0.98, 6.98], [0.5, 7.28], [0, 7.34]], 26);
  add(uo, revolveGeo(torsoPts, { seg: 56, sz: SZ }), knit).name = 'torso';
  add(uo, ribRevolveGeo(profile([[1.44, 2.48], [1.57, 2.56], [1.61, 2.75], [1.61, 3.0], [1.57, 3.1]], 8), { seg: 120, sz: SZ, ribs: 40, amp: 0.03 }), knitD);
  const HUMP = { c: V(0, 6.2, -0.62), r: [1.18, 0.92, 0.66] };
  add(uo, new THREE.SphereGeometry(1, 24, 14), knit, HUMP.c.x, HUMP.c.y, HUMP.c.z).scale.set(...HUMP.r);
  const COLLAR = { c: V(0, 7.02, 0.1), R: 0.98, r: 0.32, sz: 0.86 };
  add(uo, ribTorusGeo(COLLAR.R, COLLAR.r, { ribs: 30, amp: 0.1, sz: COLLAR.sz, segU: 90, segV: 12 }), knitD, COLLAR.c.x, COLLAR.c.y, COLLAR.c.z).name = 'collar';
  // cables: a raised band per cable with two strands twisting over it, framed by purl ridges
  const onTorso = (phi, y, o) => { const r = radiusAt(torsoPts, y), n = V(Math.sin(phi), 0, Math.cos(phi) / SZ).normalize(); return V(r * Math.sin(phi), y, r * Math.cos(phi) * SZ).addScaledVector(n, o); };
  const ends = (r0, k = 10) => (u) => r0 * Math.min(1, Math.sin(PI * Math.min(u, 1 - u) * k));
  const cables = [], bands = [];
  for (const pc of [-0.86, -0.34, 0.34, 0.86]) {
    const line = (dphi, o, y0 = 3.12, y1 = 6.2, n = 24) => { const pts = []; for (let i = 0; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / n; pts.push(onTorso(pc + dphi / radiusAt(torsoPts, y), y, o)); } return new THREE.CatmullRomCurve3(pts); };
    bands.push({ geo: taperTubeGeo(line(0, 0), ends(0.15, 14), 24, 8) });
    for (const sd of [-1, 1]) bands.push({ geo: taperTubeGeo(line(sd * 0.27, 0), ends(0.045, 14), 16, 4) });
    for (const ph of [0, PI]) {
      const pts = [];
      for (let y = 3.16; y <= 6.16; y += 0.06) {
        const w = (TAU * (y - 3.16)) / 0.5 + ph;
        pts.push(onTorso(pc + (0.075 / radiusAt(torsoPts, y)) * Math.sin(w), y, 0.13 + 0.03 * Math.cos(w)));
      }
      cables.push({ geo: taperTubeGeo(new THREE.CatmullRomCurve3(pts), ends(0.075, 12), 44, 5) });
    }
  }
  add(uo, mergeGeos(bands), knitD);
  add(uo, mergeGeos(cables), knitL);

  // ---- arms: the right hand holds his coffee mug, the left one raises a lecturing finger
  const cuffGeo = ribRevolveGeo(profile([[0.4, -0.16], [0.47, -0.12], [0.48, 0], [0.47, 0.12], [0.4, 0.16]], 6), { seg: 54, ribs: 18, amp: 0.05 });
  const arm = (sx, [ax, az], [fx, fz]) => {
    const sh = grp(uo, sx * 1.42, 6.86, 0.2);
    sh.rotation.set(ax, 0, az);
    add(sh, new THREE.SphereGeometry(0.53, 20, 14), knit, 0, -0.04, 0).name = 'shoulder';
    add(sh, new THREE.CapsuleGeometry(0.47, 1.0, 6, 16), knit, 0, -0.85, 0).name = 'arm';
    const fore = grp(sh, 0, -1.72, 0);
    fore.rotation.set(fx, 0, fz);
    add(fore, new THREE.CapsuleGeometry(0.43, 0.72, 6, 16), knit, 0, -0.6, 0).name = 'arm';
    add(fore, cuffGeo, knitD, 0, -1.16, 0);
    const hand = grp(fore, 0, -1.5, 0);
    add(hand, new THREE.SphereGeometry(0.43, 20, 14), skin).scale.set(1, 1.05, 0.9);
    hand.children[0].name = 'hand';
    return { sh, fore, hand };
  };
  const right = arm(-1, [0.05, -0.42], [-1.95, -0.15]);
  const left = arm(1, [-0.15, 0.88], [0, 1.98]);
  // lecturing finger + thumb (in the raised hand's frame +x points toward his face and -y up along the forearm)
  const finger = add(left.hand, new THREE.CapsuleGeometry(0.12, 0.42, 6, 10), skin, 0.15, -0.52, 0.06);
  finger.rotation.z = -0.12;
  add(left.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.36, -0.12, 0.16).scale.set(0.9, 1.3, 0.9);
  add(left.hand, new THREE.CapsuleGeometry(0.12, 0.32, 6, 10), skin, -0.04, -0.2, 0.3).rotation.z = PI / 2;
  add(right.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.32, -0.1, 0.22);

  // enamel camping mug in the right hand, kept upright in body space
  root.updateMatrixWorld(true);
  const handPos = uo.worldToLocal(right.hand.getWorldPosition(V()));
  const mug = grp(uo);
  mug.position.copy(handPos).add(V(0.32, 0.45, 0.4));
  const mugM = M.std(C.mug, { r: 0.45 });
  const rimM = M.std(C.mugRim, { r: 0.45 });
  add(mug, new THREE.CylinderGeometry(0.45, 0.42, 0.92, 26), mugM).name = 'mug';
  add(mug, new THREE.TorusGeometry(0.44, 0.045, 8, 28), rimM, 0, 0.46, 0).rotation.x = PI / 2;
  add(mug, new THREE.CylinderGeometry(0.425, 0.425, 0.08, 26), rimM, 0, -0.43, 0);
  add(mug, new THREE.CylinderGeometry(0.41, 0.41, 0.02, 24), M.std(C.coffee, { r: 0.3 }), 0, 0.4, 0);
  add(mug, new THREE.TorusGeometry(0.24, 0.07, 8, 16, PI * 1.25), mugM, -0.48, 0.0, 0).rotation.z = PI * 0.375 + PI / 2;
  for (const [a, y, s] of [[0.5, 0.12, 0.06], [1.1, -0.2, 0.045]]) {
    const chip = add(mug, new THREE.CircleGeometry(s, 10), rimM, Math.sin(a) * 0.442, y, Math.cos(a) * 0.442);
    chip.rotation.y = a;
  }
  const steam = [];
  for (let i = 0; i < 3; i++) {
    const s = add(mug, new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), 0, 0.6, 0);
    s.userData.off = i / 3;
    steam.push(s);
  }

  // ---- body solids the hair and beard drape over (body coordinates)
  const solids = [];
  const ellSolid = (c, rx, ry, rz) => solids.push((q, m) => ((q.x - c.x) / (rx + m)) ** 2 + ((q.y - c.y) / (ry + m)) ** 2 + ((q.z - c.z) / (rz + m)) ** 2 < 1);
  solids.push((q, m) => {
    if (q.y < 2.55 || q.y > 7.34) return false;
    const R = radiusAt(torsoPts, q.y) + m;
    return (q.x / R) ** 2 + (q.z / (R * SZ)) ** 2 < 1;
  });
  ellSolid(HUMP.c, ...HUMP.r);
  ellSolid(COLLAR.c, COLLAR.R + COLLAR.r, COLLAR.r, (COLLAR.R + COLLAR.r) * COLLAR.sz);
  for (const s of [right, left]) {
    const p = uo.worldToLocal(s.sh.getWorldPosition(V()));
    ellSolid(p.add(V(0, -0.04, 0)), 0.53, 0.53, 0.53);
    for (const y of [-0.45, -0.85, -1.25]) ellSolid(uo.worldToLocal(s.sh.localToWorld(V(0, y, 0))), 0.47, 0.47, 0.47);
  }
  const inside = (q, m) => solids.some((f) => f(q, m));
  const pushOut = (q, dir, m) => { for (let i = 0; i < 160 && inside(q, m); i++) q.addScaledVector(dir, 0.015); return q; };

  // ---- big head
  const head = grp(uo, HEAD.x, HEAD.y, HEAD.z);
  add(head, new THREE.SphereGeometry(HR, 40, 30), skin).scale.set(...HS);
  head.children[0].name = 'skull';
  const F = ellipsoid(HR * HS[0], HR * HS[1], HR * HS[2]);
  ellSolid(HEAD, F.ax * 1.04, F.ay * 1.04, F.az * 1.04);

  // tired, deep-set eyes: darker sockets, dot eyes with a highlight, heavy lids, bags, crow's feet
  const socketM = new THREE.MeshStandardMaterial({ color: C.socket, roughness: 0.9, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const eyes = [], lids = [], hls = [];
  const EYE = { x: 0.44, y: 0.02 };
  const wrinkles = [];
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.CircleGeometry(0.29, 28), socketM), sx * EYE.x, EYE.y + 0.03, 0.006).scale.set(1.12, 0.95, 1);
    const e = F.put(add(head, new THREE.SphereGeometry(0.165, 18, 14), M.std('#16111c', { r: 0.2 })), sx * EYE.x, EYE.y, -0.03);
    e.scale.set(1, 1.35, 0.5);
    eyes.push(e);
    hls.push(F.put(add(head, new THREE.SphereGeometry(0.05, 10, 8), M.basic('#ffffff')), sx * EYE.x + 0.055, EYE.y + 0.1, 0.05));
    const lidG = grp(head);
    F.put(lidG, sx * EYE.x, EYE.y, 0.025);
    const lid = add(lidG, new THREE.SphereGeometry(0.21, 18, 12), skin);
    lid.scale.set(1.32, 0.62, 0.32);
    lid.userData.sx = sx;
    lids.push(lid);
    // puffy bag + two tired lines under the eye
    F.put(add(head, new THREE.SphereGeometry(0.17, 16, 10), M.std(mix(C.skin, C.socket, 0.18))), sx * EYE.x, EYE.y - 0.2, -0.025).scale.set(1.3, 0.55, 0.35);
    const lineAt = (x, y, r, arc, roll) => { const o = new THREE.Object3D(); F.put(o, x, y, 0.004, roll); o.updateMatrix(); wrinkles.push({ geo: new THREE.TorusGeometry(r, 0.022, 5, 14, arc), m: o.matrix.clone() }); };
    lineAt(sx * EYE.x, EYE.y - 0.14, 0.15, PI * 0.8, PI * 1.1);
    // crow's feet
    for (const d of [-0.5, 0.5]) {
      const o = new THREE.Object3D();
      F.put(o, sx * 0.71, EYE.y + 0.03 + d * 0.1, 0.004, PI / 2 + sx * d * 0.5);
      o.updateMatrix();
      wrinkles.push({ geo: new THREE.CapsuleGeometry(0.02, 0.11, 3, 6), m: o.matrix.clone() });
    }
  }
  // forehead lines
  for (const [y, w] of [[0.74, 0.34], [0.87, 0.27]]) wrinkles.push({ geo: surfaceArc(F, -w, w, Math.acos(y / F.ay), 1.004, 0.021) });
  add(head, mergeGeos(wrinkles), wrinkleM);
  // frown creases between the brows (grumpy)
  const creases = [];
  for (const sx of [-1, 1]) {
    const c = F.put(add(head, new THREE.CapsuleGeometry(0.024, 0.18, 4, 6), wrinkleM), sx * 0.09, 0.3, 0.008, sx * 0.25);
    creases.push(c);
  }

  // huge shaggy brows: a chunky bar of blobs with tufts, following the forehead
  const brows = [];
  for (const sx of [-1, 1]) {
    const b = grp(head);
    F.put(b, sx * 0.52, 0.42, 0.11);
    const bm = grp(b);
    bm.userData.sx = sx;
    const parts = [];
    for (const [x, y, r] of [[-0.28, -0.04, 0.12], [-0.12, 0.01, 0.18], [0.07, 0.04, 0.2], [0.27, 0.03, 0.19], [0.44, -0.03, 0.15]]) {
      parts.push({ geo: new THREE.SphereGeometry(r, 12, 8), m: mat4(V(sx * x, y, -0.35 * x * x), new THREE.Euler(0, 0, sx * -0.1 * x), V(1.25, 0.82, 0.62)) });
    }
    for (const [x, y, dx, dy, len, rad] of [[-0.22, 0.09, 0.25, 1, 0.24, 0.08], [0.04, 0.12, 0.45, 1, 0.26, 0.085], [0.28, 0.09, 0.75, 1, 0.24, 0.08], [0.5, 0.0, 1, 0.4, 0.28, 0.09], [0.46, -0.1, 1, -0.25, 0.22, 0.075]]) {
      const dir = V(sx * dx, dy, 0.15).normalize();
      parts.push({ geo: new THREE.SphereGeometry(rad, 8, 6), m: mat4(V(sx * x, y, -0.35 * x * x).addScaledVector(dir, len * 0.28), new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir)), V(1, len / (2 * rad), 0.8)) });
    }
    add(bm, mergeGeos(parts), browM).name = 'brow';
    brows.push(bm);
  }

  // big bulbous nose
  const noseM = M.std(mix(C.skin, '#e0806e', 0.3));
  F.put(add(head, new THREE.SphereGeometry(0.3, 22, 16), noseM), 0, -0.27, 0.1).scale.set(1.08, 0.92, 0.95);
  for (const sx of [-1, 1]) F.put(add(head, new THREE.SphereGeometry(0.13, 12, 10), noseM), sx * 0.22, -0.37, 0.02).scale.set(1, 0.8, 0.8);
  // heavy cheeks with a little colour
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.SphereGeometry(0.3, 18, 12), skin), sx * 0.8, -0.26, -0.15).scale.set(1.15, 0.85, 0.7);
    F.put(add(head, new THREE.CircleGeometry(0.2, 20), M.basic(C.blush, 0.32)), sx * 0.86, -0.22, 0.07).scale.set(1.2, 0.85, 1);
  }

  // a soft lower lip / chin bump: gives the opening in the beard a floor that faces forward
  add(head, new THREE.SphereGeometry(1, 16, 10), M.std(mix(C.skin, '#d07a6a', 0.18)), 0, -1.14, 0.74).scale.set(0.58, 0.2, 0.26);
  // mouth (one visible at a time), in the opening of the beard under the moustache
  const mouthM = M.std('#6a2a3a', { r: 0.5 });
  const mouth = grp(head);
  F.put(mouth, 0, -0.9, 0.06);
  const mouths = {
    frown: add(mouth, new THREE.TorusGeometry(0.19, 0.05, 8, 20, PI), mouthM, 0, -0.07, 0),
    flat: add(mouth, new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), mouthM),
    o: grp(mouth),
    talk: grp(mouth),
  };
  mouths.flat.rotation.z = PI / 2;
  add(mouths.o, new THREE.TorusGeometry(0.12, 0.045, 8, 20), mouthM).scale.set(1, 1.2, 1);
  add(mouths.o, new THREE.CircleGeometry(0.12, 20), M.std('#3a1420'), 0, 0, -0.01).scale.set(1, 1.2, 1);
  add(mouths.talk, new THREE.SphereGeometry(0.19, 16, 12), M.std('#4a1a28', { r: 0.6 })).scale.set(1.3, 1, 0.35);
  add(mouths.talk, new THREE.SphereGeometry(0.09, 12, 8), M.std('#ff8aa8'), 0, -0.08, 0.04).scale.set(1.2, 0.6, 0.4);

  // ---- the beard: a shell over cheeks, jaw and chin (open around the mouth), a moustache that merges
  // into it, and heavy locks falling onto the chest over a filler mass
  const topC = curve([[0, 0.83], [0.16, 0.825], [0.3, 0.78], [0.45, 0.69], [0.62, 0.62], [0.9, 0.585], [1.2, 0.55], [1.5, 0.52], [2.0, 0.52]]);
  const beardTop = (phi) => (topC(Math.abs(phi)) + 0.008 * Math.sin(phi * 15)) * PI;
  const beardK = (phi, th) => 1.0 + 0.05 * smooth(beardTop(phi), beardTop(phi) + 0.05 * PI, th) + 0.12 * smooth(0.6 * PI, 0.93 * PI, th) * (0.55 + 0.45 * Math.cos(phi) ** 2);
  add(head, shellGeo(F, { phi0: -2.0, phi1: 2.0, top: beardTop, bottom: () => 0.985 * PI, k: beardK, segU: 72, segV: 14, rim: 0.97 }), M.std(C.beard, { r: 0.8 })).name = 'beard-shell';
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.SphereGeometry(0.3, 18, 12), beardM), sx * 0.26, -0.55, 0.07, sx * 0.3).scale.set(1.45, 0.5, 0.75);
    F.put(add(head, new THREE.SphereGeometry(0.19, 14, 10), beardM), sx * 0.54, -0.73, 0.04, sx * 0.95).scale.set(1.2, 0.72, 0.8);
  }
  F.put(add(head, new THREE.SphereGeometry(0.18, 14, 10), beardM), 0, -0.5, 0.06).scale.set(1.2, 0.55, 0.7);
  const FILL = { c: V(0, -1.8, 0.7), r: [1.0, 0.85, 0.6] };
  add(head, new THREE.SphereGeometry(1, 22, 14), beardM, FILL.c.x, FILL.c.y, FILL.c.z).scale.set(...FILL.r);
  // under the jaw at the sides (closes the gap between the jaw and the side locks seen from above)
  const JAW = [V(-0.75, -1.3, 0.6), V(0.75, -1.3, 0.6)], JR = [0.42, 0.38, 0.42];
  for (const c of JAW) add(head, new THREE.SphereGeometry(1, 14, 10), beardM, c.x, c.y, c.z).scale.set(...JR);
  head.children.slice(-2).forEach((o) => { o.name = 'beard'; });
  const beardLocks = [
    [[[0, -1.3, 1.0], [0, -1.6, 1.22], [0, -2.0, 1.27], [0, -2.4, 1.22], [0, -2.72, 1.1]], 0.46, 0.18],
    [[[0.48, -1.22, 0.95], [0.55, -1.52, 1.16], [0.55, -1.95, 1.2], [0.48, -2.32, 1.16], [0.38, -2.58, 1.08]], 0.44, 0.18],
    [[[0.9, -0.95, 0.78], [0.98, -1.3, 0.98], [0.92, -1.75, 1.07], [0.76, -2.12, 1.06], [0.64, -2.34, 1.0]], 0.38, 0.18],
  ];
  const beardPaths = [];
  for (const [pts, w, t] of beardLocks) {
    for (const sx of pts[0][0] === 0 ? [1] : [-1, 1]) {
      const path = pts.map(([x, y, z]) => {
        const q = V(sx * x + (rand() - 0.5) * 0.03, y, z).add(HEAD);
        if (y < -1.2) pushOut(q, V(0, 0, 1), t + 0.02);
        return q.sub(HEAD);
      });
      const out = (P) => V(P.x * 0.55, 0.1, 1).normalize();
      add(head, lockGeo(path, { w: () => w, t: () => t, out, segs: 22, radial: 8, tip: 0.15, root: 0.12 }), beardM).name = 'beard';
      beardPaths.push({ path, r: Math.max(w, t) });
    }
  }
  // the beard is part of what the front hair has to fall around
  ellSolid(FILL.c.clone().add(HEAD), ...FILL.r);
  for (const c of JAW) ellSolid(c.clone().add(HEAD), ...JR);
  for (const { path, r } of beardPaths) for (const p of path) ellSolid(p.clone().add(HEAD), r, r, r);

  // ---- long straight black hair: a cap with a centre parting, and heavy locks falling past the shoulders
  const capC = curve([[0, 0.15], [0.35, 0.18], [0.7, 0.25], [0.92, 0.35], [1.02, 0.52], [1.12, 0.65], [1.4, 0.71], [2.2, 0.74], [PI, 0.76]]);
  const groove = (phi, th) => { const xs = Math.sin(th) * Math.sin(phi), zs = Math.sin(th) * Math.cos(phi); return 0.085 * Math.exp(-((xs / 0.09) ** 2)) * smooth(-0.35, 0.1, zs); };
  add(head, shellGeo(F, { bottom: (phi) => capC(Math.abs(phi)) * PI, k: (phi, th) => 1.06 + 0.04 * Math.max(0, Math.cos(th)) - groove(phi, th), segU: 96, segV: 16, rim: 0.95 }), hairM).name = 'hair-cap';
  const partPts = [];
  for (let i = 0; i <= 8; i++) partPts.push(F.at(0, (0.16 - 0.16 * (i / 8)) * PI, 1.012));
  for (let i = 1; i <= 3; i++) partPts.push(F.at(PI, 0.035 * i * PI, 1.012));
  add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(partPts), 24, 0.022, 6), M.std(C.part));

  // outward direction for a hair lock: the head normal on the skull, horizontal from the body axis below it
  const hairOut = (P) => {
    const n1 = V(P.x / F.ax ** 2, P.y / F.ay ** 2, P.z / F.az ** 2).normalize();
    const n2 = V(P.x, 0, P.z + HEAD.z).normalize();
    return n1.lerp(n2, smooth(-0.2, -0.9, P.y)).normalize();
  };
  const hairLock = (wps, { k = 1.15, yEnd = null, w = 0.28, t = 0.15, pull = 0.45, fwd = 0, mat = hairM }) => {
    const pts = wps.map(([phi, th]) => F.at(phi, th * PI, k).add(HEAD));
    if (yEnd != null) {
      const R0 = pts[pts.length - 1];
      const a = Math.atan2(R0.x, R0.z), dir = V(Math.sin(a), 0, Math.cos(a));
      let d = Math.hypot(R0.x, R0.z);
      const n = Math.max(2, Math.ceil((R0.y - yEnd) / 0.3)), dy = (R0.y - yEnd) / n;
      const side = V(dir.z, 0, -dir.x).multiplyScalar(w * 0.9);
      const blocked = (q) => inside(q, t + 0.08) || inside(q.clone().add(side), t + 0.06) || inside(q.clone().sub(side), t + 0.06);
      for (let i = 1; i <= n; i++) {
        d -= pull * dy;
        const q = V(dir.x * d, R0.y - dy * i, dir.z * d);
        const pd = dir.clone().add(V(0, 0, fwd)).normalize();
        for (let j = 0; j < 160 && blocked(q); j++) q.addScaledVector(pd, 0.015);
        d = Math.hypot(q.x, q.z);
        pts.push(q);
      }
    }
    const local = pts.map((p) => p.sub(HEAD));
    let len = 0;
    for (let i = 1; i < local.length; i++) len += local[i].distanceTo(local[i - 1]);
    const m = add(head, lockGeo(local, { w: () => w, t: () => t, out: hairOut, radial: 8, segs: clamp(Math.round(len / 0.15), 14, 32), tip: clamp(0.4 / len, 0.08, 0.3), root: 0.06 }), mat);
    m.name = 'hair';
    return m;
  };
  for (const s of [-1, 1]) {
    const S = (wps) => wps.map(([p, th]) => [s * p, th]);
    hairLock(S([[0.08, 0.14], [0.4, 0.18], [0.76, 0.27], [0.98, 0.38], [1.1, 0.48], [1.16, 0.58]]), { k: 1.15, yEnd: 5.75, w: 0.31, t: 0.12, fwd: 2.5 });
    // (shorter on the side of the raised arm, so it rests on the shoulder instead of draping over the arm)
    hairLock(S([[0.12, 0.07], [0.6, 0.12], [1.05, 0.25], [1.22, 0.4], [1.27, 0.52], [1.29, 0.6]]), { k: 1.17, yEnd: s > 0 ? 6.6 : 6.05, w: 0.34, t: 0.13, pull: 0.25, fwd: 2.5, mat: hair2M });
    hairLock(S([[0.18, 0.04], [0.9, 0.1], [1.45, 0.25], [1.6, 0.4], [1.62, 0.52]]), { k: 1.15, yEnd: 7.55, w: 0.36, t: 0.13 });
    hairLock(S([[0.5, 0.03], [1.5, 0.12], [1.95, 0.3], [2.0, 0.42], [2.0, 0.52]]), { k: 1.14, yEnd: 7.5, w: 0.36, t: 0.13, mat: hair2M });
  }
  for (const [pe, yEnd, mat] of [[2.3, 5.4, hairM], [-2.3, 5.35, hairM], [2.68, 5.15, hair2M], [-2.68, 5.2, hair2M], [3.0, 5.05, hairM], [-3.0, 5.1, hairM], [PI, 5.0, hair2M]]) {
    hairLock([[pe, 0.05], [pe, 0.22], [pe, 0.38], [pe, 0.5]], { k: 1.15, yEnd, w: 0.4, t: 0.14, pull: 0.2, mat });
  }
  // a few stray hairs: unkempt, not frizzy
  for (const [phi, th, side] of [[2.5, 0.14, 1]]) {
    const p0 = F.at(phi, th * PI, 1.16), n = F.normal(phi, th * PI);
    const sd = V(Math.cos(phi), 0, -Math.sin(phi)).multiplyScalar(side);
    const p1 = p0.clone().addScaledVector(n, 0.22).addScaledVector(sd, 0.08).add(V(0, 0.06, 0));
    const p2 = p1.clone().addScaledVector(n, 0.12).addScaledVector(sd, 0.18).add(V(0, -0.04, 0));
    add(head, taperTubeGeo(new THREE.CatmullRomCurve3([p0, p1, p2]), (u) => 0.045 * (1 - u) + 0.008, 14, 6), hairM).name = 'hair-stray';
  }

  finishShadows(root);
  steam.forEach((s) => { s.castShadow = false; });

  // ---- expressions + animation
  let expr = 'grumpy';
  const cur = { ...EXPRESSIONS.grumpy };
  let started = false, t = 0, blink = 2.5;
  const apply = (blinking) => {
    for (const b of brows) {
      const sx = b.userData.sx;
      b.position.set(0, cur.browY, 0);
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
      lid.scale.set(1.32 * cur.eyeX, 0.62, 0.32);
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
    if (talk) {
      for (const [key, m] of Object.entries(mouths)) m.visible = key === 'talk';
      mouths.talk.scale.set(1, 0.2 + 0.8 * Math.abs(Math.sin(t * 11 + Math.sin(t * 3.1) * 2)), 1);
    } else showMouth();
    // breathing, a grumpy little bob while talking, the old hunch
    const breath = Math.sin(t * 1.5);
    body.position.y = breath * 0.03 + (talk ? Math.abs(Math.sin(t * 6.5)) * 0.05 : 0);
    upper.rotation.x = HUNCH + breath * 0.008 + (talk ? Math.sin(t * 3.2) * 0.01 : 0);
    head.rotation.z = Math.sin(t * 0.8) * 0.015 + (talk ? Math.sin(t * 5.3) * 0.022 : 0);
    head.rotation.x = (talk ? Math.sin(t * 6.1) * 0.025 : 0) + (expr === 'surprised' ? -0.035 : 0.015);
    // the lecturing finger wags while he talks
    left.fore.rotation.z = 1.98 + (talk ? Math.sin(t * 9) * 0.22 : Math.sin(t * 1.2) * 0.04) + (expr === 'surprised' ? 0.25 : 0);
    left.sh.rotation.z = 0.88 + (talk ? Math.sin(t * 4.5) * 0.05 : 0) + (expr === 'surprised' ? 0.2 : 0);
    for (const s of steam) {
      const u = (t * 0.45 + s.userData.off) % 1;
      s.position.set(0.25 * u + Math.sin(u * 7 + s.userData.off * 9) * 0.07, 0.55 + u * 0.75, 0.05);
      s.scale.setScalar(0.7 + u * 0.9);
      s.material.opacity = 0.42 * Math.sin(u * PI);
    }
  };
  root.userData.setExpression('grumpy');
  return root;
}
