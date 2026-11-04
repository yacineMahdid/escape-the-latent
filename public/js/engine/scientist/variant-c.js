// Jean-Lafontaine de Becancourt, variant C: "the old grump in a jacket".
// Long messy black hair with big chunky locks over the shoulders and a cowlick, a long black beard
// tapering to a slight point, enormous flat brows over heavy-lidded eyes, a big bulbous nose, heavy
// cheeks, a dark turtleneck under a worn, slightly too big corduroy jacket, dark trousers, old boots,
// and a hunch. Same toy family as the player: chunky, rounded, matte, dot eyes with a highlight.
import * as THREE from 'three';
import {
  materials, add, grp, ellipsoid, shellGeo, revolveGeo, profile, roundRectGeo, rng, curve, mix,
  shade, clamp, smooth, finishShadows, PI, TAU, DS, UP,
} from '../toyparts.js';

const EXPRESSIONS = {
  neutral: { browY: 0.0, slant: 0.1, arch: 0.02, browS: 1.0, eyeY: 1.0, eyeX: 1.0, lid: 0.32, crease: 0.25, tilt: 0, startle: 0 },
  grumpy: { browY: -0.13, slant: 0.42, arch: -0.03, browS: 1.04, eyeY: 0.92, eyeX: 1.0, lid: 0.6, crease: 1, tilt: 0.02, startle: 0 },
  surprised: { browY: 0.2, slant: -0.1, arch: 0.08, browS: 1.06, eyeY: 1.3, eyeX: 1.16, lid: 0.0, crease: 0, tilt: -0.04, startle: 1 },
  talking: { browY: -0.06, slant: 0.28, arch: 0.0, browS: 1.0, eyeY: 0.96, eyeX: 1.0, lid: 0.42, crease: 0.6, tilt: 0, startle: 0 },
};

const HIP = 2.7; // the hunch pivots here
const LEAN = 0.075; // forward lean of the upper body (the hunch)
const HEAD = new THREE.Vector3(0, 8.32, 0.42); // head centre in upper-body coordinates (pushed forward)
const HR = 1.4, HS = [1.1, 0.96, 1.0];
const SZJ = 0.84; // jacket depth squash
const BROW_X = 0.55, BROW_Y = 0.44;
const BROW_XO = [-0.33, -0.08, 0.18, 0.43]; // brow control points, offset outward from BROW_X
const BROW_R = 0.19;

// radius of a sampled profile (ascending y) at height y
function radiusAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.y - y) * (b.y - y) <= 0) { const u = (y - a.y) / (b.y - a.y || 1); return a.x + (b.x - a.x) * u; }
  }
  return y < pts[0].y ? pts[0].x : pts[pts.length - 1].x;
}

// surface of revolution with corduroy wales (radius ripples around the axis), open at the front by gap(y)
function ribRevolve(pts, { seg = 120, sz = 1, gap = null, ribs = 0, amp = 0 } = {}) {
  const pos = [], idx = [];
  for (const p of pts) {
    const g = gap ? clamp(gap(p.y), 0, TAU - 0.01) : 0;
    for (let i = 0; i <= seg; i++) {
      const phi = g / 2 + ((TAU - g) * i) / seg;
      const r = p.x * (1 + amp * Math.cos(ribs * phi));
      pos.push(r * Math.sin(phi), p.y, r * Math.cos(phi) * sz);
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
  return g;
}

// a band lying on a revolved surface between azimuths from(y) < to(y), pushed out by dr (lapels)
function bandGeo(pts, { sz = 1, from, to, dr = 0.03, seg = 12 }) {
  const pos = [], idx = [];
  for (const p of pts) {
    const a0 = from(p.y), a1 = to(p.y);
    for (let i = 0; i <= seg; i++) {
      const phi = a0 + ((a1 - a0) * i) / seg, r = p.x + dr;
      pos.push(r * Math.sin(phi), p.y, r * Math.cos(phi) * sz);
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
  return g;
}

// a flattened, tapering lock of hair along a curve: half-width W(u) across, half-thickness H(u) along
// out(P, u) (the direction the lock lies against), rounded tip. Outward-facing triangles.
function lockGeo(pts, W, H, out, { segs = 22, radial = 10 } = {}) {
  const crv = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const pos = [], nor = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const prev = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    crv.getPointAt(u, P);
    crv.getTangentAt(u, T);
    N.copy(out(P, u));
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-8) N.copy(prev);
    N.normalize();
    prev.copy(N);
    B.crossVectors(T, N).normalize();
    const w = Math.max(0.003, W(u)), h = Math.max(0.003, H(u));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      pos.push(P.x + w * c * B.x + h * s * N.x, P.y + w * c * B.y + h * s * N.y, P.z + w * c * B.z + h * s * N.z);
      const nx = (c / w) * B.x + (s / h) * N.x, ny = (c / w) * B.y + (s / h) * N.y, nz = (c / w) * B.z + (s / h) * N.z;
      const L = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / L, ny / L, nz / L);
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
// lock width profiles: full at the root, a soft rounded point at the tip
const tipped = (w0, w1 = w0 * 0.55, p = 3) => (u) => (w0 + (w1 - w0) * u) * Math.sqrt(Math.max(0, 1 - u ** p));

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const line = (pts, extra) => { const c = curve(pts); return (phi) => (c(Math.abs(phi)) + (extra ? extra(phi) : 0)) * PI; };

export function buildScientist() {
  const M = materials();
  const C = {
    skin: '#efc29d', hair: '#25212a', hair2: '#302a35', hairDeep: '#1b181f', brow: '#201c24',
    knit: '#3e5d66', cord: '#a8794a', lapel: '#8d6339', patch: '#6b4a34', button: '#3e2a20',
    pants: '#3b3846', boot: '#6a4530', sole: '#2e2018', scuff: '#8c6345',
    mug: '#f4ecdc', band: '#d4513f', coffee: '#5a3418', mouth: '#4a1e28', lip: '#c4686a', tongue: '#e8808e',
  };
  const skin = M.std(C.skin);
  const skinLine = M.std(shade(C.skin, -0.24), { r: 0.9 });
  const ruddy = M.std(mix(C.skin, '#e07a68', 0.38));
  const hairM = M.std(C.hair, { r: 0.72, side: DS });
  const hair2 = M.std(C.hair2, { r: 0.7, side: DS });
  const hairDeep = M.std(C.hairDeep, { r: 0.8, side: DS });
  const browM = M.std(C.brow, { r: 0.8 });
  const knit = M.std(C.knit, { r: 0.95 });
  const cord = M.std(C.cord, { r: 0.95, side: DS });
  const lapelM = M.std(C.lapel, { r: 0.92, side: DS });
  const rand = rng(48151623);
  const cur = { ...EXPRESSIONS.grumpy }; // the blended expression currently shown

  const root = new THREE.Group();
  root.name = 'becancourt';
  const body = grp(root);

  // ---- legs: dark trousers over old boots (round toes, worn soles, a scuffed toe cap, laces)
  const pantsM = M.std(C.pants, { r: 0.9 });
  const bootM = M.std(C.boot, { r: 0.62 });
  for (const sx of [-1, 1]) {
    add(body, new THREE.CapsuleGeometry(0.56, 1.7, 5, 14), pantsM, sx * 0.68, 1.95, 0);
    add(body, new THREE.CylinderGeometry(0.62, 0.68, 0.32, 18), pantsM, sx * 0.7, 1.0, 0.03);
    add(body, new THREE.CylinderGeometry(0.56, 0.6, 0.7, 18), bootM, sx * 0.7, 0.52, 0.06);
    add(body, new THREE.TorusGeometry(0.57, 0.07, 8, 20), M.std(shade(C.boot, -0.2), { r: 0.6 }), sx * 0.7, 0.86, 0.06).rotation.x = PI / 2;
    add(body, new THREE.SphereGeometry(0.64, 20, 14), bootM, sx * 0.72, 0.36, 0.42).scale.set(0.95, 0.56, 1.32);
    add(body, new THREE.CylinderGeometry(0.62, 0.62, 0.14, 20), M.std(C.sole, { r: 0.8 }), sx * 0.72, 0.07, 0.38).scale.set(0.97, 1, 1.42);
    add(body, new THREE.SphereGeometry(0.2, 12, 8), M.std(C.scuff, { r: 0.9 }), sx * 0.62, 0.5, 1.06).scale.set(1.25, 0.6, 0.45);
    for (const y of [0.6, 0.76]) {
      const lace = add(body, new THREE.CapsuleGeometry(0.035, 0.32, 4, 6), M.std('#e8dcc0'), sx * 0.7, y, 0.66);
      lace.rotation.z = PI / 2 + sx * 0.12;
    }
  }

  // ---- upper body, hunched forward from the hips
  const lean = grp(body, 0, HIP, 0);
  lean.rotation.x = LEAN;
  const up = grp(lean, 0, -HIP, 0);

  // dark turtleneck
  const T = profile([[0, 2.45], [1.15, 2.48], [1.45, 2.8], [1.58, 3.6], [1.6, 4.4], [1.54, 5.3], [1.42, 6.0], [1.18, 6.68], [0.86, 7.08], [0.6, 7.28], [0, 7.34]], 20);
  add(up, revolveGeo(T, { seg: 40, sz: 0.8 }), knit);
  const roll = add(up, new THREE.TorusGeometry(0.64, 0.22, 10, 28), knit, 0, 7.22, 0.05);
  roll.rotation.x = PI / 2;
  roll.scale.set(1, 0.85, 1);

  // the corduroy jacket: oversized, boxy, open at the front, hanging a bit off the shoulders
  const J = profile([[1.8, 1.85], [1.76, 2.3], [1.72, 3.1], [1.74, 4.1], [1.72, 5.1], [1.64, 5.9], [1.46, 6.55], [1.14, 7.02], [0.84, 7.26], [0.68, 7.34]], 19);
  const jacketGap = (y) => (y > 4.25 ? 0.07 + Math.pow((y - 4.25) / 3.1, 1.25) * 1.25 : 0.07 + (4.25 - y) * 0.11);
  add(up, ribRevolve(J, { seg: 176, sz: SZJ, gap: jacketGap, ribs: 44, amp: 0.009 }), cord);
  // wide lapels lying back from the opening
  const lapW = (y) => 0.6 * smooth(4.3, 6.1, y) * (1 - 0.4 * smooth(6.7, 7.3, y));
  const lapPts = J.filter((p) => p.y > 4.28);
  add(up, bandGeo(lapPts, { sz: SZJ, from: (y) => jacketGap(y) / 2 - 0.01, to: (y) => jacketGap(y) / 2 + lapW(y) + 0.001, dr: 0.035 }), lapelM);
  add(up, bandGeo(lapPts, { sz: SZJ, from: (y) => -(jacketGap(y) / 2 + lapW(y) + 0.001), to: (y) => -jacketGap(y) / 2 + 0.01, dr: 0.035 }), lapelM);
  const onJacket = (phi, y, out = 0.02) => { const r = radiusAt(J, y) + out; return V(r * Math.sin(phi), y, r * Math.cos(phi) * SZJ); };
  const yawOn = (phi) => Math.atan2(SZJ * Math.sin(phi), Math.cos(phi));
  // two big buttons on the closing edge
  for (const y of [4.12, 3.2]) {
    const phi = -(jacketGap(y) / 2 + 0.13);
    const b = add(up, new THREE.CylinderGeometry(0.14, 0.14, 0.07, 14), M.std(C.button, { r: 0.5 }));
    b.position.copy(onJacket(phi, y, 0.04));
    b.rotation.set(PI / 2, yawOn(phi), 0, 'YXZ');
  }
  // baggy patch pockets with flaps
  for (const sx of [-1, 1]) {
    const phi = sx * 0.78;
    const pk = add(up, roundRectGeo(0.82, 0.66, 0.14, 0.05), M.std(shade(C.cord, -0.05), { r: 0.95 }));
    pk.position.copy(onJacket(phi, 2.75, 0.04));
    pk.rotation.y = yawOn(phi);
    const flap = add(up, roundRectGeo(0.9, 0.22, 0.08, 0.06), lapelM);
    flap.position.copy(onJacket(phi, 3.12, 0.07));
    flap.rotation.set(-0.12, yawOn(phi), 0, 'YXZ');
  }

  // ---- arms in big corduroy sleeves: right hand holds the mug, left hand lectures with a raised finger
  const upperSleeve = ribRevolve(profile([[0.3, -1.98], [0.47, -1.84], [0.51, -1.5], [0.53, -0.8], [0.53, -0.2], [0.42, 0.16], [0.001, 0.26]], 12), { seg: 40, ribs: 10, amp: 0.03 });
  const foreSleeve = ribRevolve(profile([[0.5, -1.28], [0.52, -1.2], [0.48, -1.0], [0.46, -0.6], [0.47, -0.1], [0.37, 0.2], [0.001, 0.3]], 11), { seg: 40, ribs: 10, amp: 0.03 });
  const patchM = M.std(C.patch, { r: 0.98 });
  const arm = (sx, upperRot, foreRot) => {
    const sh = grp(up, sx * 1.38, 6.62, 0.3);
    sh.rotation.set(upperRot[0], 0, upperRot[1]);
    add(sh, new THREE.SphereGeometry(0.6, 18, 14), cord, 0, -0.02, 0).scale.set(1, 0.95, 1);
    add(sh, upperSleeve, cord);
    const fore = grp(sh, 0, -1.74, 0);
    fore.rotation.set(foreRot[0], 0, foreRot[1]);
    add(fore, foreSleeve, cord);
    add(fore, new THREE.CylinderGeometry(0.4, 0.4, 0.26, 16), knit, 0, -1.32, 0);
    const hand = grp(fore, 0, -1.62, 0);
    add(hand, new THREE.SphereGeometry(0.44, 18, 14), skin).scale.set(1, 1.05, 0.9);
    // elbow patch on the point of the elbow (opposite the forearm)
    const fd = new THREE.Vector3(0, -1, 0).applyEuler(fore.rotation);
    const pd = fd.clone().setY(0).multiplyScalar(-1);
    if (pd.lengthSq() > 1e-4) {
      pd.normalize();
      const p = add(sh, new THREE.SphereGeometry(0.3, 14, 10), patchM);
      p.position.set(0, -1.68, 0).addScaledVector(pd, 0.47);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pd);
      p.scale.set(0.9, 1.25, 0.3);
    }
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

  // mug in the right hand (kept upright against the hunch)
  root.updateMatrixWorld(true);
  const toUp = (o, v = new THREE.Vector3()) => up.worldToLocal(o.getWorldPosition(v));
  const handPos = toUp(right.hand);
  const mug = grp(up);
  mug.position.copy(handPos).add(V(0.42, 0.42, 0.12));
  mug.rotation.x = -LEAN;
  const mugM = M.std(C.mug, { r: 0.5 });
  add(mug, new THREE.CylinderGeometry(0.46, 0.42, 0.95, 24), mugM);
  add(mug, new THREE.CylinderGeometry(0.47, 0.47, 0.16, 24), M.std(C.band, { r: 0.5 }), 0, 0.18, 0);
  add(mug, new THREE.CylinderGeometry(0.41, 0.41, 0.02, 24), M.std(C.coffee, { r: 0.3 }), 0, 0.46, 0);
  add(mug, new THREE.TorusGeometry(0.26, 0.08, 8, 16), mugM, -0.5, 0.02, 0);
  // a chip off the rim: he has had this mug for decades
  add(mug, new THREE.SphereGeometry(0.06, 8, 6), M.std(shade(C.mug, -0.25)), 0.22, 0.47, 0.38).scale.set(1.2, 0.6, 0.5);
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

  // obstacles the hair must drape over (upper-body coordinates): jacket (analytic), shoulders, arms, hands, mug
  const solids = [];
  for (const a of [right, left]) {
    const s = toUp(a.sh), e = toUp(a.fore), h = toUp(a.hand);
    solids.push({ a: s, b: s, r: 0.62 }, { a: s, b: e, r: 0.55 }, { a: e, b: h, r: 0.52 }, { a: h, b: h, r: 0.5 });
  }
  solids.push({ a: mug.position.clone().add(V(0, -0.5, 0)), b: mug.position.clone().add(V(0, 0.6, 0)), r: 0.6 });
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const pushOut = (P, off) => {
    for (let it = 0; it < 4; it++) {
      if (P.y > 1.85 && P.y < 7.3) {
        const rj = radiusAt(J, P.y) + off, rho = Math.hypot(P.x, P.z / SZJ);
        if (rho < rj) { const k = rj / Math.max(rho, 1e-4); P.x *= k; P.z *= k; }
      }
      for (const s of solids) {
        tmp.subVectors(s.b, s.a);
        const L2 = tmp.lengthSq();
        const t = L2 > 1e-8 ? clamp(tmp2.subVectors(P, s.a).dot(tmp) / L2, 0, 1) : 0;
        const c = tmp2.copy(s.a).addScaledVector(tmp, t);
        const d = P.distanceTo(c), need = s.r + off;
        if (d < need) P.sub(c).multiplyScalar(need / Math.max(d, 1e-4)).add(c);
      }
    }
    return P;
  };

  // ---- the big head
  const head = grp(up, HEAD.x, HEAD.y, HEAD.z);
  add(head, new THREE.SphereGeometry(HR, 44, 32), skin).scale.set(...HS);
  const F = ellipsoid(HR * HS[0], HR * HS[1], HR * HS[2]);
  const nrmH = (p) => V(p.x / (F.ax * F.ax), p.y / (F.ay * F.ay), p.z / (F.az * F.az)).normalize();
  const onFace = (x, y, out = 0) => { const z = F.z(x, y), p = V(x, y, z); return p.addScaledVector(nrmH(p), out); };
  const faceLine = (pts, r, mat, out = 0.004) => add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y]) => onFace(x, y, out))), 14, r, 5), mat);

  // eyes: deep-set dark dots with a highlight, heavy lids that slide down for the scowl
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
    // heavy upper lid: a puffy skin lid with a dark lash line on its lower edge, sliding + slanting
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
      F.put(add(head, new THREE.CapsuleGeometry(0.017, 0.11, 3, 6), skinLine), sx * 0.8, dy, 0.004, PI / 2 + sx * a);
    }
  }
  // forehead lines + the frown creases between the brows
  for (const [y, w] of [[0.76, 0.5], [0.88, 0.44], [0.99, 0.34]]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const x = -w + (2 * w * i) / 6; pts.push([x, y + 0.025 * Math.sin(i * 1.7 + y * 9) - 0.05 * (x / w) ** 2]); }
    faceLine(pts, 0.021, skinLine);
  }
  const creases = [];
  for (const sx of [-1, 1]) {
    const c = F.put(add(head, new THREE.CapsuleGeometry(0.024, 0.2, 4, 6), skinLine), sx * 0.085, 0.3, 0.004, sx * 0.16);
    creases.push(c);
  }

  // enormous flat brows: a chain of three thick, flattened capsules through control points on the
  // forehead (re-laid every frame so they can lift, slant and arch), with bushy tufts at both ends
  const browPts = (sx) => BROW_XO.map((xo) => {
    const y = BROW_Y + cur.browY + cur.slant * xo + cur.arch * (1 - (xo / 0.44) ** 2);
    return onFace(sx * (BROW_X + xo), y, 0.085);
  });
  const brows = [];
  for (const sx of [-1, 1]) {
    const b = grp(head);
    b.userData.sx = sx;
    const P = browPts(sx);
    b.userData.segs = [0, 1, 2].map((i) => {
      const L = P[i].distanceTo(P[i + 1]);
      return add(b, new THREE.CapsuleGeometry(BROW_R, L, 5, 12), browM);
    });
    b.userData.tufts = [[0, 0.04, 0.12, 0.45, 0.075, 0.24], [3, 0.1, 0.03, 1.2, 0.085, 0.28], [3, 0.04, 0.12, 0.62, 0.075, 0.25]].map(([at, dx, dy, a, r, h]) => {
      const m = add(b, new THREE.ConeGeometry(r, h, 7), browM);
      m.userData = { at, dx, dy, a, h };
      return m;
    });
    brows.push(b);
  }
  const bX = new THREE.Vector3(), bY = new THREE.Vector3(), bZ = new THREE.Vector3(), bM = new THREE.Matrix4();
  const layBrow = (b) => {
    const sx = b.userData.sx, P = browPts(sx);
    b.userData.segs.forEach((m, i) => {
      const A = P[i], B2 = P[i + 1];
      m.position.addVectors(A, B2).multiplyScalar(0.5);
      bY.subVectors(B2, A).normalize();
      bZ.copy(nrmH(m.position));
      bZ.addScaledVector(bY, -bZ.dot(bY)).normalize();
      bX.crossVectors(bY, bZ);
      m.quaternion.setFromRotationMatrix(bM.makeBasis(bX, bY, bZ));
      m.scale.set(0.92 * cur.browS, 1, 0.6 * cur.browS);
    });
    for (const m of b.userData.tufts) {
      // in-plane frame at the end: u points away from the brow, v up the forehead; tilt a from v toward u
      const { at, dx, dy, a, h } = m.userData;
      const end = P[at], u = end.clone().sub(P[at === 0 ? 1 : 2]).normalize();
      const v = nrmH(end).cross(u).normalize();
      if (v.y < 0) v.negate();
      const dir = v.clone().multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a)).normalize();
      m.position.copy(end).addScaledVector(u, dx * cur.browS).addScaledVector(v, dy * cur.browS).addScaledVector(dir, h * 0.3);
      m.quaternion.setFromUnitVectors(UP, dir);
    }
  };

  // big bulbous nose on a broad bridge, nostril wings; heavy cheeks resting on the beard
  F.put(add(head, new THREE.SphereGeometry(0.2, 16, 12), skin), 0, -0.08, -0.08).scale.set(0.85, 1.35, 0.75);
  F.put(add(head, new THREE.SphereGeometry(0.37, 22, 16), ruddy), 0, -0.34, 0.1).scale.set(1.1, 0.93, 0.92);
  const cheekM = M.std(mix(C.skin, '#f08a88', 0.1));
  const blushM = M.basic('#f27f8c', 0.32);
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.SphereGeometry(0.15, 12, 10), ruddy), sx * 0.27, -0.46, 0.03).scale.set(1, 0.85, 0.8);
    F.put(add(head, new THREE.SphereGeometry(0.33, 18, 14), cheekM), sx * 0.84, -0.52, -0.04).scale.set(1.12, 0.9, 0.62);
    F.put(add(head, new THREE.CircleGeometry(0.17, 18), blushM), sx * 0.86, -0.48, 0.17).scale.set(1.25, 0.85, 1);
  }

  // mouths (one at a time), sitting in the opening between the mustache and the beard
  const mouthM = M.std(C.mouth, { r: 0.5 });
  const mouth = grp(head);
  F.put(mouth, 0, -0.915, 0.07);
  const mouths = { frown: grp(mouth), flat: grp(mouth), o: grp(mouth), talk: grp(mouth) };
  add(mouths.frown, new THREE.TorusGeometry(0.19, 0.05, 8, 20, PI), mouthM, 0, -0.1, 0);
  add(mouths.flat, new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), mouthM).rotation.z = PI / 2;
  add(mouths.o, new THREE.TorusGeometry(0.12, 0.048, 8, 20), M.std(C.lip, { r: 0.6 })).scale.set(1, 1.22, 1);
  add(mouths.o, new THREE.CircleGeometry(0.12, 20), M.std('#2e0f18'), 0, 0, -0.01).scale.set(1, 1.22, 1);
  add(mouths.talk, new THREE.SphereGeometry(0.21, 16, 12), M.std('#3a1420', { r: 0.6 })).scale.set(1.35, 1, 0.38);
  add(mouths.talk, new THREE.SphereGeometry(0.11, 12, 8), M.std(C.tongue), 0, -0.1, 0.04).scale.set(1.25, 0.6, 0.4);
  add(mouths.talk, new THREE.CapsuleGeometry(0.04, 0.22, 4, 8), M.std('#fffaf0'), 0, 0.13, 0.03).rotation.z = PI / 2;

  // ---- beard: a shell over the jaw and cheeks (open around the mouth), a long mass growing out from under
  // the lower lip and tapering to a slight point, strands down its front, a big drooping mustache
  const beardTop = line([[0, 0.86], [0.14, 0.85], [0.24, 0.8], [0.32, 0.73], [0.4, 0.68], [0.55, 0.645], [0.8, 0.61], [1.05, 0.55], [1.3, 0.48], [1.75, 0.45]]);
  // bushy at the jaw corners (jowls), so the long beard grows out of the jaw beard instead of hanging like a bib
  const jowl = (phi, th) => smooth(0.58 * PI, 0.74 * PI, th) * (1 - 0.6 * smooth(0.9 * PI, PI, th)) * Math.exp(-(((Math.abs(phi) - 0.72) / 0.42) ** 2));
  const beardK = (phi, th) => 1.05 + 0.09 * smooth(0.55 * PI, 0.85 * PI, th) * (0.5 + 0.5 * Math.cos(phi) ** 2) + 0.09 * jowl(phi, th);
  add(head, shellGeo(F, { phi0: -1.8, phi1: 1.8, top: beardTop, bottom: () => 0.97 * PI, k: beardK, segU: 56, segV: 12, rim: 0.95 }), hairM).name = 'beardShell';
  const beardG = grp(head, 0, -1.08, 0.44);
  beardG.rotation.x = -0.1;
  const BP = profile([[0, -2.25], [0.22, -2.12], [0.5, -1.85], [0.78, -1.45], [0.98, -1.0], [1.08, -0.55], [1.06, -0.22], [0.9, -0.04], [0.55, 0.05], [0, 0.08]], 26);
  const BSZ = 0.62;
  add(beardG, revolveGeo(BP, { seg: 44, sz: BSZ }), hairM).name = 'beardMass';
  // strands on the beard's front converging to the point
  const beardOut = (P) => V(P.x, 0, P.z / (BSZ * BSZ));
  for (const s of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const pts = [];
    for (const y of [-0.12, -0.5, -0.95, -1.4, -1.8, -2.08]) {
      const r = radiusAt(BP, y), x = s * r * (0.82 - 0.1 * Math.abs(s)) * (y < -1.7 ? 0.6 : 1);
      pts.push(V(x, y, BSZ * Math.sqrt(Math.max(0, r * r - x * x)) - 0.02));
    }
    add(beardG, lockGeo(pts, tipped(0.2 - 0.03 * Math.abs(s), 0.1), tipped(0.075, 0.05), beardOut, { segs: 18, radial: 8 }), Math.abs(s) > 0.5 ? hairM : hair2);
  }
  // the mustache: two bushy lobes from under the nose drooping into the beard
  for (const sx of [-1, 1]) {
    const pts = [[0.02, -0.58], [0.3, -0.66], [0.55, -0.8], [0.68, -0.99], [0.68, -1.16]].map(([x, y], i) => onFace(sx * x, y, 0.08 - 0.015 * i));
    add(head, lockGeo(pts, tipped(0.235, 0.15, 4), tipped(0.14, 0.1, 4), (P) => nrmH(P), { segs: 20, radial: 10 }), hairM).name = 'mustache';
  }

  // ---- hair: long, black, messy; parted near the middle, thick swoops framing the forehead, a cowlick,
  // a mane of chunky locks down the back and big locks falling over the shoulders onto the chest
  const capLine = line([[0, 0.19], [0.3, 0.215], [0.6, 0.28], [0.85, 0.36], [1.1, 0.46], [1.35, 0.54], [1.7, 0.62], [2.3, 0.67], [PI, 0.69]]);
  const capK = (phi, th) => 1.075 + 0.055 * Math.max(0, Math.cos(th)) + 0.07 * smooth(0.35 * PI, 0.65 * PI, th) * smooth(1.2, 2.4, Math.abs(phi));
  add(head, shellGeo(F, { bottom: capLine, k: capK, segU: 72, segV: 14, rim: 0.95 }), hairM);
  // the parting: a thin line of scalp
  add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0.2, 0.15, 0.1, 0.05].map((th) => F.at(0.07, th * PI, capK(0.07, th * PI) + 0.004))), 8, 0.022, 5), M.std(shade(C.skin, -0.05)));
  const onCap = (phi, th, extra = 0.02) => F.at(phi, th * PI, capK(phi, th * PI) + extra);
  // swoops lying on the cap, framing the forehead
  for (const sx of [-1, 1]) {
    const s1 = [[0.05, 0.14], [0.36, 0.17], [0.72, 0.245], [1.02, 0.35], [1.24, 0.47], [1.4, 0.59]].map(([p, t]) => onCap(sx * p, t, 0.0));
    add(head, lockGeo(s1, tipped(0.26, 0.2, 2), tipped(0.12, 0.1), (P) => nrmH(P), { segs: 18, radial: 9 }), hairM);
    const s2 = [[0.12, 0.05], [0.6, 0.12], [1.25, 0.22], [1.85, 0.34], [2.3, 0.48], [2.55, 0.6]].map(([p, t]) => onCap(sx * p, t, 0.0));
    add(head, lockGeo(s2, tipped(0.36, 0.25, 2), tipped(0.12, 0.1), (P) => nrmH(P), { segs: 18, radial: 9 }), hair2);
  }
  // cowlick: one stubborn fat curl standing up at the front of the parting and flopping forward
  {
    const b0 = onCap(-0.14, 0.13, -0.06);
    const pts = [b0, b0.clone().add(V(0.0, 0.2, -0.03)), b0.clone().add(V(-0.03, 0.42, 0.02)), b0.clone().add(V(-0.05, 0.52, 0.2)), b0.clone().add(V(-0.05, 0.44, 0.36)), b0.clone().add(V(-0.04, 0.3, 0.38))];
    add(head, lockGeo(pts, (u) => 0.17 * (1 - u) ** 0.7 + 0.015, (u) => 0.13 * (1 - u) ** 0.7 + 0.015, () => V(0, 0, 1), { segs: 20, radial: 10 }), hairM);
  }

  // locks that leave the head: built in upper-body coordinates, pushed clear of the body, arms and mug
  const headOut = (P) => nrmH(tmp.copy(P).sub(HEAD));
  const bodyOut = (P) => V(P.x, 0, P.z / (SZJ * SZJ)).normalize();
  const drapeOut = (P) => {
    const k = smooth(HEAD.y - 0.7, HEAD.y - 1.6, P.y);
    return headOut(P).multiplyScalar(1 - k).add(bodyOut(P).multiplyScalar(k)).normalize();
  };
  const frontOut = (P) => drapeOut(P).add(V(0, 0, 1.2)).normalize(); // locks beside the face show their width
  const hairLock = (ctrl, W, H, mat, off, out = drapeOut) => {
    // sample the path, keep every sample clear of the body (push + smooth passes), then sweep the lock
    let pts = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5).getSpacedPoints(16);
    for (let pass = 0; pass < 3; pass++) {
      pts = pts.map((p, i) => (p.y < HEAD.y - 0.9 ? pushOut(p, off(i / (pts.length - 1))) : p));
      if (pass < 2) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : p.clone().add(pts[i - 1]).add(pts[i + 1]).multiplyScalar(1 / 3)));
    }
    const g = lockGeo(pts, W, H, out, { segs: 20, radial: 9 });
    g.translate(-HEAD.x, -HEAD.y, -HEAD.z);
    return add(head, g, mat);
  };
  const hAt = (phi, th, k) => F.at(phi, th * PI, k).add(HEAD);
  const jAt = (phi, y, off) => { const r = radiusAt(J, y) + off; return V(r * Math.sin(phi), y, r * Math.cos(phi) * SZJ); };
  // root narrower (they crowd together on the head), full in the middle, rounded point at the tip
  const maneW = (w0) => (u) => w0 * (0.55 + 0.45 * smooth(0, 0.35, u)) * (1 - 0.3 * u) * Math.sqrt(Math.max(0, 1 - u ** 2.5));

  // the mane down the back, from behind the crown to below the shoulder blades
  const backPhis = [PI - 1.05, PI - 0.7, PI - 0.35, PI, PI + 0.35, PI + 0.7, PI + 1.05];
  backPhis.forEach((phi, i) => {
    const tipY = 5.3 + (rand() - 0.5) * 0.5 + (i % 2 ? 0.18 : -0.1);
    const ctrl = [hAt(phi, 0.26, 0.97), hAt(phi, 0.4, 1.17), hAt(phi, 0.58, 1.22), jAt(phi, 6.85, 0.3), jAt(phi, 6.1, 0.24), jAt(phi + (rand() - 0.5) * 0.12, tipY, 0.3)];
    hairLock(ctrl, maneW(0.52), tipped(0.17, 0.12), i % 3 === 1 ? hair2 : hairM, (u) => 0.22 * (1 - u) + 0.25);
  });
  // an under-layer filling the gaps between the back locks
  hairLock([hAt(PI, 0.4, 0.9), hAt(PI, 0.6, 1.1), jAt(PI, 6.85, 0.2), jAt(PI, 6.0, 0.15), jAt(PI, 5.45, 0.15)], tipped(1.25, 1.1, 3), tipped(0.14, 0.12), hairDeep, () => 0.2);

  // chunky locks falling over the shoulders: one beside the face onto the chest, one over the shoulder
  // top, one behind the shoulder
  for (const sx of [-1, 1]) {
    hairLock([hAt(sx * 1.15, 0.4, 0.95), hAt(sx * 1.28, 0.53, 1.16), V(sx * 1.6, 7.3, 0.9), V(sx * 1.45, 6.7, 1.12), V(sx * 1.22, 6.0, 1.2), V(sx * 1.14, 5.42, 1.24)],
      tipped(0.4, 0.28, 2.5), tipped(0.19, 0.15), hairM, () => 0.26, frontOut);
    hairLock([hAt(sx * 1.45, 0.45, 0.95), hAt(sx * 1.55, 0.58, 1.2), V(sx * 1.7, 7.32, 0.36), V(sx * 1.82, 6.7, 0.8), V(sx * 1.76, 6.0, 1.0)],
      tipped(0.38, 0.26, 2.5), tipped(0.2, 0.15), hair2, () => 0.3);
    hairLock([hAt(sx * 1.85, 0.48, 0.95), hAt(sx * 1.85, 0.62, 1.2), V(sx * 1.5, 6.9, -0.7), V(sx * 1.45, 6.2, -0.98), V(sx * 1.38, 5.65, -1.1)],
      tipped(0.4, 0.28, 2.5), tipped(0.18, 0.14), hairM, () => 0.3);
  }

  finishShadows(root);
  steam.forEach((s) => { s.castShadow = false; });

  // ---- expressions + animation
  let expr = 'grumpy';
  let started = false, t = 0, blink = 2.5;
  const apply = (blinking) => {
    brows.forEach(layBrow);
    const lidY = 0.34 - cur.lid * 0.3;
    eyes.forEach((e, i) => {
      e.scale.set(cur.eyeX, blinking ? 0.12 : 1.3 * cur.eyeY, 0.5);
      hls[i].visible = !blinking;
      F.put(hls[i], hls[i].userData.x, Math.min(0.075, lidY - 0.125 - 0.06), 0.03);
    });
    for (const c of creases) { c.visible = cur.crease > 0.05; c.scale.set(1, Math.max(0.01, cur.crease), 1); }
    head.rotation.x = cur.tilt;
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
      mouths.talk.scale.set(1, 0.3 + 0.7 * Math.abs(Math.sin(t * 11 + Math.sin(t * 3.1) * 2)), 1);
    } else showMouth();
    // breathing, a grumpy little bob while talking, the hunch settling
    const breath = Math.sin(t * 1.5);
    body.position.y = breath * 0.03 + (talk ? Math.abs(Math.sin(t * 6.5)) * 0.06 : 0);
    lean.rotation.x = LEAN + breath * 0.008 + (talk ? Math.sin(t * 3.2) * 0.012 : 0);
    head.rotation.z = Math.sin(t * 0.8) * 0.018 + (talk ? Math.sin(t * 5.3) * 0.02 : 0);
    head.rotation.x = cur.tilt + (talk ? Math.sin(t * 6.1) * 0.025 : 0);
    // the lecturing finger wags while he talks, and flies up when he is startled
    left.fore.rotation.z = 1.98 + (talk ? Math.sin(t * 9) * 0.22 : Math.sin(t * 1.2) * 0.04) + cur.startle * 0.25;
    left.sh.rotation.z = 0.88 + (talk ? Math.sin(t * 4.5) * 0.05 : 0) + cur.startle * 0.12;
    steamAt(t + 0.4);
  };
  root.userData.setExpression('grumpy');
  return root;
}
