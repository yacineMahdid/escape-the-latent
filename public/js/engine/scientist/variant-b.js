// Variant B, "the rumpled cardigan": Jean-Lafontaine de Becancourt, a grumpy old man.
// Long wavy black hair swept back from a high, slightly receding forehead, hanging to the shoulders and
// curling out at the ends; a dense black beard trimmed square at the bottom; wild bushy brows; sunken
// cheeks and forehead lines; a worn burgundy cardigan with elbow patches and big buttons over a plain
// collarless shirt; baggy trousers and scuffed shoes. Coffee mug in his right hand, lecturing finger up.
//   buildScientist() -> THREE.Group: feet at y = 0, faces +z, ~10 units tall, head centre at y ~8.25.
//   userData: setExpression(name), expression(), animate(dt, { talking }), parts.
import * as THREE from 'three';
import {
  materials, add, grp, ellipsoid, shellGeo, revolveGeo, profile, taperTubeGeo, roundRectGeo,
  rng, curve, mix, shade, clamp, smooth, finishShadows, PI, TAU, DS,
} from '../toyparts.js';

const EXPRESSIONS = {
  neutral: { browY: 0.0, browRot: 0.14, browIn: 0.0, browS: 1.0, eyeY: 1.0, eyeX: 1.0, lid: 0.3, crease: 0.25 },
  grumpy: { browY: -0.15, browRot: 0.5, browIn: 0.06, browS: 1.06, eyeY: 0.85, eyeX: 1.0, lid: 0.5, crease: 1 },
  surprised: { browY: 0.25, browRot: -0.28, browIn: -0.05, browS: 1.1, eyeY: 1.3, eyeX: 1.2, lid: 0.0, crease: 0 },
  talking: { browY: -0.07, browRot: 0.32, browIn: 0.03, browS: 1.0, eyeY: 0.95, eyeX: 1.0, lid: 0.35, crease: 0.6 },
};

// radius of a sampled (y-ascending) profile at height y
function radiusAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.y - y) * (b.y - y) <= 0) { const u = (y - a.y) / (b.y - a.y || 1); return a.x + (b.x - a.x) * u; }
  }
  return pts[0].x;
}

// Long hair hanging from the head: for each azimuth phi in [phi0, phi1] the sheet follows the (inflated)
// head from polar angle top(phi) down to the equator, then drops, flaring out, to y = yEnd(phi).
// Every vertex goes through drape() so the hair rests on the shoulders and back instead of passing through.
function maneGeo(F, { phi0, phi1, top, kEq, yEnd, kEnd, drape, segU = 72, segA = 8, segB = 12 }) {
  const pos = [], idx = [];
  const R = segA + segB + 1;
  for (let i = 0; i <= segU; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segU;
    const s = Math.sin(phi), c = Math.cos(phi);
    const t0 = top(phi), ke = kEq(phi), ye = yEnd(phi), kb = kEnd(phi);
    for (let j = 0; j <= segA; j++) {
      const u = j / segA, th = t0 + (PI / 2 - t0) * u;
      const p = drape(F.at(phi, th, 1.05 + (ke - 1.05) * Math.sin((u * PI) / 2)));
      pos.push(p.x, p.y, p.z);
    }
    for (let j = 1; j <= segB; j++) {
      const u = j / segB, k = ke + (kb - ke) * u * u;
      const p = drape(new THREE.Vector3(F.ax * k * s, ye * u, F.az * k * c));
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < segU; i++) for (let j = 0; j < R - 1; j++) { const a = i * R + j, b = a + R; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A hair lock: a tube along a curve whose radius follows radius(u), closed at the tip with a round cap.
function lockGeo(curve, radius, segs = 32, radial = 10, capRings = 4) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], idx = [];
  const ring = (P, N, B, T, r, along, tilt) => {
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      const rx = c * N.x + s * B.x, ry = c * N.y + s * B.y, rz = c * N.z + s * B.z;
      pos.push(P.x + T.x * along + r * rx, P.y + T.y * along + r * ry, P.z + T.z * along + r * rz);
      nor.push(rx * ct + T.x * st, ry * ct + T.y * st, rz * ct + T.z * st);
    }
  };
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    ring(curve.getPointAt(u), frames.normals[i], frames.binormals[i], frames.tangents[i], Math.max(0.0005, radius(u)), 0, 0);
  }
  const P1 = curve.getPointAt(1), r1 = radius(1);
  for (let k = 1; k <= capRings; k++) {
    const a = ((k / capRings) * PI) / 2;
    ring(P1, frames.normals[segs], frames.binormals[segs], frames.tangents[segs], Math.max(0.0005, r1 * Math.cos(a)), r1 * Math.sin(a), a);
  }
  const rows = segs + 1 + capRings;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function buildScientist() {
  const M = materials();
  const rand = rng(1104);
  const C = {
    skin: '#ebbb98', hair: '#2f282e', hairHi: '#655966', brow: '#1f191d',
    card: '#8b3a45', shirt: '#efe6d3', pants: '#5c5549', shoe: '#6a4430', sole: '#3a2418',
    patch: '#5f4531', button: '#d7b47c', lip: '#c97d72', mouth: '#4a1a24',
  };
  const skin = M.std(C.skin);
  const hairM = M.std(C.hair, { r: 0.78, side: DS });
  const hairM2 = M.std(mix(C.hair, '#6a5f68', 0.12), { r: 0.75 });
  const hairHi = M.std(C.hairHi, { r: 0.7 });
  const beardM = M.std(C.hair, { r: 0.85, side: DS });
  const browM = M.std(C.brow, { r: 0.9 });
  const card = M.std(C.card, { r: 0.95, side: DS });
  const cardRib = M.std(shade(C.card, -0.18), { r: 0.95 });
  const skinLine = M.std(shade(C.skin, -0.26));
  const crowM = M.std(shade(C.skin, -0.16));

  const root = new THREE.Group();
  root.name = 'becancourt';
  const body = grp(root);

  // ---- baggy trousers with turn-ups, scuffed shoes
  const pantsM = M.std(C.pants, { r: 0.95 });
  for (const sx of [-1, 1]) {
    add(body, new THREE.CapsuleGeometry(0.58, 1.95, 8, 16), pantsM, sx * 0.66, 1.8, 0);
    add(body, new THREE.CylinderGeometry(0.61, 0.64, 0.24, 18), M.std(shade(C.pants, -0.12)), sx * 0.66, 0.8, 0);
    add(body, new THREE.SphereGeometry(0.62, 20, 14), M.std(C.shoe, { r: 0.6 }), sx * 0.7, 0.34, 0.3).scale.set(0.98, 0.56, 1.45);
    add(body, new THREE.CylinderGeometry(0.6, 0.6, 0.12, 20), M.std(C.sole), sx * 0.7, 0.06, 0.3).scale.set(0.98, 1, 1.45);
    const n = new THREE.Vector3(0, 0.87, 0.5).normalize();
    const scuff = add(body, new THREE.SphereGeometry(0.15, 10, 8), M.std(mix(C.shoe, '#d8c0a0', 0.38)), sx * 0.62, 0.52, 1.02);
    scuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    scuff.scale.set(1.3, 0.22, 0.85);
  }

  // ---- torso: a slight old-man hunch pivoting at the waist
  const WAIST = 3.2, HUNCH = 0.1, SZ = 0.8;
  const spine = grp(body, 0, WAIST, 0);
  spine.rotation.x = HUNCH;
  const upper = grp(spine, 0, -WAIST, 0);
  const shirtPts = profile([[0, 2.6], [1.1, 2.62], [1.45, 2.95], [1.58, 3.6], [1.6, 4.4], [1.54, 5.3], [1.44, 6.0], [1.24, 6.55], [0.85, 6.95], [0.42, 7.12], [0, 7.16]], 20);
  add(upper, revolveGeo(shirtPts, { seg: 36, sz: SZ }), M.std(C.shirt));
  // the cardigan: open in a V above V0, buttoned below
  const cardPts = profile([[1.74, 2.4], [1.7, 2.9], [1.69, 3.6], [1.71, 4.4], [1.63, 5.3], [1.53, 6.0], [1.33, 6.56], [0.98, 6.96], [0.7, 7.08]], 24);
  const V0 = 4.85;
  const cardGap = (y) => (y > V0 ? (y - V0) * 0.78 : 0);
  const cardR = (y) => radiusAt(cardPts, y);
  add(upper, revolveGeo(cardPts, { seg: 52, sz: SZ, gap: cardGap }), card);
  // ribbed button band along the opening and down the front, ribbed hem
  const edge = (sx, y) => { const a = cardGap(y) / 2, r = cardR(y) + 0.02; return new THREE.Vector3(sx * r * Math.sin(a), y, r * Math.cos(a) * SZ); };
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let y = V0; y <= 7.06; y += 0.2) pts.push(edge(sx, Math.min(y, 7.06)));
    add(upper, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.1, 8), cardRib);
  }
  {
    const pts = [];
    for (let y = 2.42; y <= V0 + 0.001; y += 0.3) pts.push(edge(1, y));
    add(upper, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.1, 8), cardRib);
  }
  const hem = add(upper, new THREE.TorusGeometry(1.74, 0.11, 8, 48), cardRib, 0, 2.42, 0);
  hem.rotation.x = PI / 2; hem.scale.set(1, SZ, 1);
  // big buttons (one replaced long ago with an odd one)
  const btnM = M.std(C.button, { r: 0.5 });
  [4.55, 3.95, 3.35, 2.8].forEach((y, i) => {
    const b = add(upper, new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16), i === 1 ? M.std('#5a6e8c', { r: 0.5 }) : btnM, 0, y, cardR(y) * SZ + 0.14);
    b.rotation.x = PI / 2;
  });
  // a darned patch on the chest, sewn on with big cream stitches
  {
    const x = 0.88, y = 4.75, r = cardR(y), z = r * SZ * Math.sqrt(1 - (x / r) ** 2);
    const darn = grp(upper, x, y, z + 0.01);
    darn.rotation.set(0, Math.atan2(x / (r * r), z / (r * SZ) ** 2), -0.18);
    add(darn, roundRectGeo(0.5, 0.42, 0.1, 0.035), M.std('#9c7a56', { r: 1 }));
    const stitchM = M.std('#f3e6c8', { r: 0.8 });
    for (const [sx2, sy2, rz] of [[-0.27, 0.06, 0], [0.27, -0.04, 0], [0.04, 0.23, PI / 2], [-0.06, -0.23, PI / 2]]) {
      add(darn, new THREE.CapsuleGeometry(0.022, 0.1, 3, 6), stitchM, sx2, sy2, 0.04).rotation.z = rz + 0.6;
    }
  }
  // saggy patch pockets
  for (const sx of [-1, 1]) {
    const pk = add(upper, roundRectGeo(0.8, 0.72, 0.14, 0.06), M.std(shade(C.card, -0.06)), sx * 0.98, 3.32, 1.12);
    pk.rotation.set(0.04, sx * 0.52, sx * 0.05);
  }

  // ---- arms in baggy sleeves; right hand holds the mug, left hand lectures
  const SH = { x: 1.36, y: 6.45, z: 0.14, r: 0.5 };
  const patchM = M.std(C.patch, { r: 1 });
  const arm = (sx, upperRot, foreRot) => {
    const sh = grp(upper, sx * SH.x, SH.y, SH.z);
    sh.rotation.set(upperRot[0], 0, upperRot[1]);
    add(sh, new THREE.SphereGeometry(SH.r, 18, 14), card, 0, -0.03, 0);
    add(sh, new THREE.CapsuleGeometry(0.46, 1.0, 8, 14), card, 0, -0.85, 0);
    const fore = grp(sh, 0, -1.72, 0);
    fore.rotation.set(foreRot[0], 0, foreRot[1]);
    add(fore, new THREE.CapsuleGeometry(0.43, 0.72, 8, 14), card, 0, -0.6, 0);
    add(fore, new THREE.CylinderGeometry(0.4, 0.43, 0.32, 16), cardRib, 0, -1.12, 0);
    const hand = grp(fore, 0, -1.5, 0);
    add(hand, new THREE.SphereGeometry(0.42, 18, 14), skin).scale.set(1, 1.05, 0.9);
    // suede patch on the point of the elbow
    const foreDir = new THREE.Vector3(0, -1, 0).applyEuler(fore.rotation);
    const pointDir = new THREE.Vector3(0, 1, 0).add(foreDir).negate().normalize().add(new THREE.Vector3(sx * 0.45, 0, 0.45)).normalize();
    const patch = add(sh, new THREE.SphereGeometry(0.3, 14, 10), patchM);
    patch.position.set(0, -1.35, 0).addScaledVector(pointDir, 0.38);
    patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pointDir);
    patch.scale.set(0.8, 1.0, 0.45);
    return { sh, fore, hand };
  };
  const right = arm(-1, [-0.35, -0.25], [-1.4, 0]);
  const left = arm(1, [-0.25, 0.88], [0, 1.98]);
  // lecturing finger + thumb (in the raised hand's frame +x points toward his face, -y up the forearm)
  const finger = add(left.hand, new THREE.CapsuleGeometry(0.115, 0.42, 6, 10), skin, 0.15, -0.52, 0.06);
  finger.rotation.z = -0.12;
  add(left.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.36, -0.12, 0.16).scale.set(0.9, 1.3, 0.9);
  const knuckles = add(left.hand, new THREE.CapsuleGeometry(0.12, 0.32, 6, 10), skin, -0.04, -0.2, 0.3);
  knuckles.rotation.z = PI / 2;
  add(right.hand, new THREE.SphereGeometry(0.15, 10, 8), skin, 0.32, -0.1, 0.22);

  // mug in the right hand (kept upright despite the hunch)
  root.updateMatrixWorld(true);
  const handPos = upper.worldToLocal(right.hand.getWorldPosition(new THREE.Vector3()));
  const mug = grp(upper);
  mug.position.copy(handPos).add(new THREE.Vector3(0.4, 0.4, 0.12));
  mug.rotation.x = -HUNCH;
  const mugM = M.std('#f1ead9', { r: 0.5 });
  add(mug, new THREE.CylinderGeometry(0.46, 0.42, 0.95, 24), mugM);
  add(mug, new THREE.CylinderGeometry(0.47, 0.47, 0.15, 24), M.std('#4a78b8', { r: 0.5 }), 0, 0.2, 0);
  add(mug, new THREE.CylinderGeometry(0.41, 0.41, 0.02, 24), M.std('#4a2a16', { r: 0.3 }), 0, 0.46, 0);
  add(mug, new THREE.TorusGeometry(0.26, 0.08, 8, 16), mugM, -0.5, 0.02, 0);
  const steam = [];
  for (let i = 0; i < 3; i++) {
    const s = add(mug, new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 0, 0.6, 0);
    s.userData.off = i / 3;
    steam.push(s);
  }

  // ---- the big head
  const HY = 8.3, HZ = 0.36, HR = 1.42;
  const head = grp(upper, 0, HY, HZ);
  add(head, new THREE.SphereGeometry(HR, 40, 30), skin).scale.set(1.04, 1, 0.97);
  const F = ellipsoid(HR * 1.04, HR, HR * 0.97);

  // eyes: deep-set under the brows, with heavy lids and bags
  const EX = 0.47, EY = 0.06;
  const eyes = [], lids = [], hls = [];
  const lidM = M.std(mix(C.skin, '#c07a6a', 0.14));
  const bagM = M.std(mix(C.skin, '#9a6a7a', 0.16));
  for (const sx of [-1, 1]) {
    F.put(add(head, new THREE.CircleGeometry(0.3, 24), M.basic(mix(C.skin, '#6a3a30', 0.55), 0.3)), sx * EX, EY + 0.05, 0.006).scale.set(1.2, 1, 1);
    const e = F.put(add(head, new THREE.SphereGeometry(0.165, 18, 14), M.std('#16111c', { r: 0.2 })), sx * EX, EY, -0.03);
    e.scale.set(1, 1.3, 0.5);
    eyes.push(e);
    hls.push(F.put(add(head, new THREE.SphereGeometry(0.05, 10, 8), M.basic('#ffffff')), sx * EX + 0.055, EY + 0.09, 0.045));
    const lidG = grp(head);
    F.put(lidG, sx * EX, EY, 0.03);
    const lid = add(lidG, new THREE.SphereGeometry(0.2, 18, 12), lidM);
    lid.scale.set(1.3, 0.62, 0.32);
    lid.userData.sx = sx;
    lids.push(lid);
    F.put(add(head, new THREE.SphereGeometry(0.17, 16, 10), bagM), sx * EX, EY - 0.25, -0.035).scale.set(1.35, 0.42, 0.42);
    // crow's feet
    for (const a of [-0.32, 0.3]) F.put(add(head, new THREE.CapsuleGeometry(0.017, 0.07, 3, 6), crowM), sx * (EX + 0.3), EY + 0.02 + a * 0.16, 0.0, PI / 2 + sx * a);
    // ruddy cheekbones and a hollow below them
    F.put(add(head, new THREE.CircleGeometry(0.2, 20), M.basic('#e07f7a', 0.3)), sx * 0.9, -0.1, 0.008).scale.set(1.2, 0.8, 1);
    F.put(add(head, new THREE.CircleGeometry(0.2, 18), M.basic(mix(C.skin, '#5a3020', 0.6), 0.16)), sx * 0.8, -0.34, 0.006).scale.set(0.9, 1.3, 1);
  }

  // wild bushy brows with stray hairs (rigid groups re-seated on the forehead every frame)
  const BX = 0.5, BY = 0.5;
  const brows = [];
  for (const sx of [-1, 1]) {
    const b = grp(head);
    b.userData.sx = sx;
    const z0 = F.z(BX, BY);
    for (const [x, y, r] of [[-0.42, -0.04, 0.13], [-0.27, 0.02, 0.17], [-0.1, 0.06, 0.19], [0.08, 0.075, 0.2], [0.26, 0.055, 0.19], [0.42, 0.0, 0.16], [0.57, -0.08, 0.12]]) {
      const t = add(b, new THREE.SphereGeometry(r, 12, 9), browM, x * sx, y + (rand() - 0.5) * 0.03, (F.z(BX + x, BY) - z0) * 0.9);
      t.scale.set(1.2, 0.85, 0.62);
      t.rotation.z = sx * (x * 0.3 + (rand() - 0.5) * 0.3);
    }
    for (const [x, y, ang, len] of [[0.5, 0.1, 0.75, 0.2], [0.16, 0.19, 0.25, 0.17], [0.66, -0.05, 1.3, 0.18]]) {
      const c = add(b, new THREE.ConeGeometry(0.036, len, 6), browM, (x + Math.sin(ang) * len * 0.4) * sx, y + Math.cos(ang) * len * 0.4, (F.z(BX + x, BY) - z0) * 0.9 + 0.03);
      c.rotation.z = -sx * ang;
    }
    brows.push(b);
  }
  // forehead lines (old age) and the frown creases between the brows
  const lineGeo = (y0, w, wig) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const x = -w + (2 * w * i) / 6, y = y0 + wig * Math.sin(i * 1.7); pts.push(new THREE.Vector3(x, y, F.z(x, y) + 0.004)); }
    return taperTubeGeo(new THREE.CatmullRomCurve3(pts), (u) => 0.022 * Math.sin(PI * u) ** 0.5, 24, 5);
  };
  add(head, lineGeo(0.8, 0.4, 0.018), skinLine);
  add(head, lineGeo(0.91, 0.46, 0.022), skinLine);
  add(head, lineGeo(1.02, 0.36, 0.015), skinLine);
  const creases = [];
  for (const sx of [-1, 1]) {
    const c = F.put(add(head, new THREE.CapsuleGeometry(0.022, 0.18, 4, 6), skinLine), sx * 0.09, 0.4, 0.0, sx * 0.18);
    creases.push(c);
  }

  // a big old nose
  const noseM = M.std(mix(C.skin, '#d9776a', 0.28));
  F.put(add(head, new THREE.CapsuleGeometry(0.13, 0.3, 6, 10), skin), 0, 0.05, 0.03);
  F.put(add(head, new THREE.SphereGeometry(0.3, 20, 14), noseM), 0, -0.22, 0.12).scale.set(1.12, 1.0, 0.95);
  for (const sx of [-1, 1]) F.put(add(head, new THREE.SphereGeometry(0.14, 14, 10), noseM), sx * 0.21, -0.3, 0.05);

  // ---- the beard: a shell over the jaw and cheeks + a square-trimmed block resting on the chest
  const beardTop = curve([[0, 0.6], [0.6, 0.6], [0.9, 0.575], [1.15, 0.5], [1.35, 0.42], [1.7, 0.4]]);
  add(head, shellGeo(F, {
    phi0: -1.7, phi1: 1.7, top: (phi) => beardTop(Math.abs(phi)) * PI, bottom: () => 0.97 * PI,
    k: (phi, th) => 1.05 + 0.08 * smooth(0.62 * PI, 0.85 * PI, th), segU: 56, segV: 12, rim: 0.98,
  }), beardM);
  const bellPts = profile([[0, -2.2], [0.5, -2.19], [0.9, -2.14], [1.08, -2.02], [1.18, -1.8], [1.27, -1.4], [1.3, -1.0], [1.18, -0.62], [0.8, -0.3]], 24);
  const BZ = 0.42, BSZ = 0.72;
  add(head, revolveGeo(bellPts, { seg: 40, sz: BSZ }), beardM, 0, 0, BZ);
  // bushy vertical lumps over its front (the bottom stays a square trim)
  for (const [x, y, len] of [[-0.86, -1.4, 0.5], [-0.44, -1.44, 0.56], [0, -1.42, 0.58], [0.44, -1.45, 0.56], [0.86, -1.4, 0.5]]) {
    const r = radiusAt(bellPts, y), zr = BSZ * Math.sqrt(Math.max(0, r * r - x * x));
    const lump = add(head, new THREE.SphereGeometry(0.3, 14, 10), beardM, x, y, BZ + zr - 0.055);
    lump.rotation.y = Math.atan2(x, zr / (BSZ * BSZ));
    lump.scale.set(1.0, len / 0.3, 0.34);
  }
  // drooping mustache merging into it
  for (const sx of [-1, 1]) F.put(add(head, new THREE.SphereGeometry(0.3, 18, 12), beardM), sx * 0.31, -0.5, 0.15, -sx * 0.4).scale.set(1.6, 0.72, 0.8);
  F.put(add(head, new THREE.SphereGeometry(0.22, 14, 10), beardM), 0, -0.44, 0.15).scale.set(1.3, 0.75, 0.8);

  // mouths, seated on the beard's front (one visible at a time)
  const MY = -0.86;
  const bellZ = (y) => BZ + radiusAt(bellPts, y) * BSZ;
  const mouth = grp(head, 0, MY, bellZ(MY) + 0.02);
  mouth.rotation.x = Math.atan((bellZ(MY + 0.05) - bellZ(MY - 0.05)) / 0.1);
  const lipM = M.std(C.lip, { r: 0.6 });
  const inM = M.std(C.mouth, { r: 0.6 });
  const mouths = { frown: grp(mouth), flat: grp(mouth), o: grp(mouth), talk: grp(mouth) };
  // frown: a pouting pink lower lip (an upside-down U) on the black beard
  const pout = add(mouths.frown, new THREE.TorusGeometry(0.22, 0.085, 10, 24, PI), lipM, 0, -0.12, 0);
  pout.scale.set(1.1, 0.9, 0.8);
  add(mouths.flat, new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), lipM, 0, -0.03, 0).rotation.z = PI / 2;
  add(mouths.flat, new THREE.CapsuleGeometry(0.04, 0.44, 4, 8), inM, 0, 0.04, 0.04).rotation.z = PI / 2;
  add(mouths.o, new THREE.TorusGeometry(0.17, 0.07, 10, 22), lipM).scale.set(1, 1.25, 1);
  add(mouths.o, new THREE.CircleGeometry(0.17, 22), M.std('#3a1420'), 0, 0, 0.01).scale.set(1, 1.25, 1);
  add(mouths.talk, new THREE.SphereGeometry(0.24, 16, 12), M.std('#3a1420', { r: 0.6 })).scale.set(1.25, 1, 0.35);
  add(mouths.talk, new THREE.TorusGeometry(0.24, 0.055, 8, 24), lipM).scale.set(1.25, 1, 1);
  add(mouths.talk, new THREE.SphereGeometry(0.13, 12, 8), M.std('#e07a8a'), 0, -0.11, 0.04).scale.set(1.2, 0.6, 0.4);

  // ---- hair: swept back from a high, slightly receding forehead
  const hl = curve([[0, 0.205], [0.3, 0.2], [0.55, 0.168], [0.8, 0.235], [1.05, 0.34], [1.3, 0.44], [1.7, 0.5], [2.3, 0.56], [PI, 0.6]]);
  const hairline = (phi) => hl(Math.abs(phi)) * PI;
  const scalpK = (phi, th) => 1.065 + 0.05 * Math.cos(th) ** 2 + 0.06 * smooth(0.12 * PI, 0.4 * PI, th) * smooth(0.55, 1.25, Math.abs(phi))
    + 0.06 * Math.exp(-(((th - hairline(phi) - 0.07 * PI) / (0.07 * PI)) ** 2)) * smooth(1.4, 0.4, Math.abs(phi));
  add(head, shellGeo(F, { bottom: hairline, k: scalpK, segU: 64, segV: 16, rim: 0.94 }), hairM);
  // combed-back strands running from the hairline over the crown (x: lateral offset, beta: 0 front, PI/2 top)
  const scalpAt = (x, beta, lift) => {
    const at = (kk) => { const q = Math.sqrt(Math.max(0.01, kk * kk - (x / F.ax) ** 2)); return new THREE.Vector3(x, F.ay * q * Math.sin(beta), F.az * q * Math.cos(beta)); };
    let k = 1.1, phi = 0, th = 0;
    for (let it = 0; it < 3; it++) {
      const p = at(k);
      phi = Math.atan2(p.x / F.ax, p.z / F.az);
      th = Math.acos(clamp(p.y / (F.ay * k), -1, 1));
      k = scalpK(phi, th);
    }
    return { p: at(k + lift), phi, th };
  };
  for (let i = 0; i < 5; i++) {
    const x0 = -0.6 + i * 0.3, pts = [];
    for (let j = 0; j <= 20; j++) {
      const sp = scalpAt(x0 * (1 + (0.3 * j) / 20), 0.2 * PI + (0.66 * PI * j) / 20, -0.032);
      if (sp.th < hairline(sp.phi) - 0.03 * PI) pts.push(sp.p);
    }
    if (pts.length > 3) add(head, taperTubeGeo(new THREE.CatmullRomCurve3(pts), (u) => 0.08 * Math.sin(PI * u) ** 0.5, 28, 6), hairHi);
  }

  // drape: keep hair (points in the head frame) outside the cardigan and the shoulder caps
  const caps = [-1, 1].map((sx) => new THREE.Vector3(sx * SH.x, SH.y - HY, SH.z - HZ));
  const drape = (p, m = 0.05) => {
    const yu = p.y + HY, zu = p.z + HZ;
    if (yu > 2.4 && yu < 7.08) {
      const r = cardR(yu) + m, e = Math.hypot(p.x / r, zu / (r * SZ));
      if (e < 1) { p.x /= e; p.z = zu / e - HZ; }
    }
    for (const c of caps) if (p.distanceTo(c) < SH.r + m) p.sub(c).setLength(SH.r + m).add(c);
    return p;
  };
  // the long mane (an under-layer for the locks): sides and back, down past the shoulders
  const back = (phi) => Math.abs(phi - PI); // 0 at the back, ~2.2 beside the face
  const kEq = (phi) => 1.08 + 0.05 * smooth(1.6, 0.2, back(phi));
  const kEnd = (phi) => kEq(phi) + 0.05 + 0.07 * smooth(0.6, 1.6, back(phi));
  const yEnd = (phi) => -1.4 - 1.05 * smooth(1.75, 0.35, back(phi));
  add(head, maneGeo(F, { phi0: 1.15, phi1: 2 * PI - 1.15, top: () => 0.3 * PI, kEq, yEnd, kEnd, drape, segU: 56, segA: 7, segB: 9 }), hairM);
  // fat wavy locks over it, each flipping outward at the end into a rounded curl
  const lockR = (R) => (u) => R * (0.55 + 0.45 * Math.sin((Math.min(1, u / 0.35) * PI) / 2)) * (1 - 0.5 * smooth(0.68, 1, u));
  const lock = (phi, R, drop, ph, mat = hairM) => {
    const s = Math.sin(phi), c = Math.cos(phi);
    const ke = kEq(phi) + 0.03, kb = kEnd(phi) + 0.03, ye = yEnd(phi) - 0.12 - drop;
    const pts = [];
    for (let j = 0; j <= 4; j++) { const u = j / 4, th = 0.33 * PI + (PI / 2 - 0.33 * PI) * u; pts.push(F.at(phi, th, 1.03 + (ke - 1.03) * Math.sin((u * PI) / 2))); }
    for (let j = 1; j <= 5; j++) { const u = j / 5, k = ke + (kb - ke) * u * u + 0.05 * Math.sin(u * PI * 2 + ph) * smooth(0, 0.3, u); pts.push(new THREE.Vector3(F.ax * k * s, ye * u, F.az * k * c)); }
    const out = new THREE.Vector3(s, 0, c), tip = pts[pts.length - 1].clone();
    pts.push(tip.clone().addScaledVector(out, 0.17).add(new THREE.Vector3(0, -0.09, 0)), tip.clone().addScaledVector(out, 0.38).add(new THREE.Vector3(0, 0.06, 0)));
    pts.forEach((p) => drape(p, R * 0.85));
    return add(head, lockGeo(new THREE.CatmullRomCurve3(pts), lockR(R), 32, 10), mat);
  };
  [1.25, 1.6, 1.95, 2.3, 2.65, 2.95].forEach((phi, i) => {
    for (const sx of [-1, 1]) lock(sx > 0 ? phi : 2 * PI - phi, 0.3 + rand() * 0.05, rand() * 0.18, rand() * 6, (i + (sx > 0 ? 0 : 1)) % 2 ? hairM2 : hairM);
  });
  lock(PI, 0.36, 0.1, 1);
  // locks falling beside the face onto the front of the shoulders
  for (const sx of [-1, 1]) {
    for (const [dp, R, dz, dy] of [[0, 0.3, 0.1, 0], [0.18, 0.27, -0.14, 0.12]]) {
      const pts = [
        F.at(sx * (0.98 + dp), 0.3 * PI, 1.06), F.at(sx * (1.04 + dp), 0.42 * PI, 1.13), F.at(sx * (1.08 + dp), 0.53 * PI, 1.16),
        new THREE.Vector3(sx * 1.58, -0.8, 0.6 + dz), new THREE.Vector3(sx * 1.6, -1.35 + dy, 0.5 + dz),
        new THREE.Vector3(sx * 1.6, -1.8 + dy, 0.45 + dz), new THREE.Vector3(sx * 1.8, -2.02 + dy, 0.45 + dz), new THREE.Vector3(sx * 2.02, -1.92 + dy, 0.42 + dz),
      ];
      pts.forEach((p) => drape(p, R * 0.85));
      add(head, lockGeo(new THREE.CatmullRomCurve3(pts), lockR(R), 36, 10), dp ? hairM : hairM2);
    }
  }

  finishShadows(root);
  steam.forEach((s) => { s.castShadow = false; });

  // ---- expressions + animation
  let expr = 'grumpy';
  const cur = { ...EXPRESSIONS.grumpy };
  let started = false, t = 0, blink = 2.5, talkOpen = 0;
  const apply = (blinking) => {
    for (const b of brows) {
      const sx = b.userData.sx;
      F.put(b, sx * (BX - cur.browIn), BY + cur.browY, 0.13, sx * cur.browRot);
      b.scale.setScalar(cur.browS);
    }
    eyes.forEach((e, i) => {
      e.scale.set(cur.eyeX, blinking ? 0.12 : 1.3 * cur.eyeY, 0.5);
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
    if (talk) {
      for (const [key, m] of Object.entries(mouths)) m.visible = key === 'talk';
      talkOpen = 0.2 + 0.8 * Math.abs(Math.sin(t * 11 + Math.sin(t * 3.1) * 2));
      mouths.talk.scale.set(1, talkOpen, 1);
    } else showMouth();
    // breathing, a grumpy little bob while talking
    const breath = Math.sin(t * 1.5);
    body.position.y = breath * 0.035 + (talk ? Math.abs(Math.sin(t * 6.5)) * 0.06 : 0);
    spine.rotation.x = HUNCH + (talk ? Math.sin(t * 3.2) * 0.012 : 0);
    head.rotation.z = Math.sin(t * 0.8) * 0.02 + (talk ? Math.sin(t * 5.3) * 0.03 : 0);
    head.rotation.x = (talk ? Math.sin(t * 6.1) * 0.03 : 0) + (expr === 'surprised' ? -0.05 : 0.02);
    // the lecturing finger wags while he talks
    left.fore.rotation.z = 1.98 + (talk ? Math.sin(t * 9) * 0.22 : Math.sin(t * 1.2) * 0.04) + (expr === 'surprised' ? 0.25 : 0);
    left.sh.rotation.z = 0.88 + (talk ? Math.sin(t * 4.5) * 0.05 : 0) + (expr === 'surprised' ? 0.2 : 0);
    for (const s of steam) {
      const u = (t * 0.45 + s.userData.off) % 1;
      s.position.set(-0.3 * u + Math.sin(u * 7 + s.userData.off * 9) * 0.06, 0.55 + u * 0.7, 0.1);
      s.scale.setScalar(0.7 + u * 0.9);
      s.material.opacity = 0.4 * Math.sin(u * PI);
    }
  };
  root.userData.setExpression('grumpy');
  return root;
}
