// Cute Animal-Crossing-style animal villagers built from primitives.
import * as THREE from 'three';
import { rbox } from './geo.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
const add = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
const hex = (c, d) => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : (c ?? d));

const SPECIES_DEFAULTS = {
  bear: { fur: 0xe0ad7c, inner: 0xc98a5a, muzzle: 0xfbe6cc },
  bunny: { fur: 0xfff4f8, inner: 0xffb3cf, nose: 0xff7ab8 },
  cat: { fur: 0xb8b0d8, inner: 0xffb3cf, muzzle: 0xefeaff, nose: 0xff8aa8 },
  frog: { fur: 0x8fd86a },
  dog: { fur: 0xd9a066, inner: 0x8a5a36, muzzle: 0xfff0dc },
  mouse: { fur: 0xb9b9c6, inner: 0xffb3cf, nose: 0xff8aa8 },
  pig: { fur: 0xffb8c8, inner: 0xff8aa8 },
  duck: { fur: 0xfff6e0 },
  snake: { fur: 0x7fcf6a },
};

export const SPECIES = Object.keys(SPECIES_DEFAULTS);

export function buildVillager(spec = {}) {
  const species = SPECIES_DEFAULTS[spec.species] ? spec.species : 'bear';
  const d = SPECIES_DEFAULTS[species];
  const o = {
    ear: species,
    fur: hex(spec.colors?.fur, d.fur),
    shirt: hex(spec.colors?.shirt, 0x3ec7b5),
    inner: hex(spec.colors?.inner, d.inner ?? 0xffb3cf),
    muzzle: spec.colors?.muzzle ? hex(spec.colors.muzzle) : d.muzzle,
    nose: hex(spec.colors?.nose, d.nose ?? 0x2b2233),
    pants: hex(spec.colors?.pants, 0x5a4a6a),
    shoe: hex(spec.colors?.shoe, 0x6a4a3a),
  };
  if (species === 'snake') return buildSnake(o);
  const g = new THREE.Group();
  const fur = M(o.fur, { roughness: 0.9 });
  const legs = [];
  for (const sx of [-1, 1]) { // each leg (pants + shoe) swings on a hip pivot
    const leg = new THREE.Group(); leg.position.set(sx * 0.19, 0.36, 0); g.add(leg);
    add(new THREE.CapsuleGeometry(0.13, 0.15, 6, 10), M(o.pants), -sx * 0.01, -0.14, 0, leg);
    add(new THREE.SphereGeometry(0.16, 10, 8), M(o.shoe), sx * 0.01, -0.28, 0.06, leg).scale.set(1, 0.6, 1.3);
    legs.push(leg);
  }
  const body = new THREE.Group(); g.add(body);
  add(new THREE.CapsuleGeometry(0.36, 0.35, 8, 16), M(o.shirt), 0, 0.72, 0, body).scale.set(1, 1, 0.85);
  const arms = [];
  for (const sx of [-1, 1]) { const a = add(new THREE.CapsuleGeometry(0.1, 0.28, 6, 10), species === 'duck' ? M(o.fur) : fur, sx * 0.45, 0.75, 0, body); a.rotation.z = sx * 0.5; arms.push(a); }
  if (species === 'duck') for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.14, 10, 8), M(0xffa53a), sx * 0.2, 0.06, 0.1, g).scale.set(1.1, 0.4, 1.6);
  const head = new THREE.Group(); head.position.y = 1.55; body.add(head);
  add(new THREE.SphereGeometry(0.62, 24, 18), fur, 0, 0, 0, head).scale.set(1.08, 0.95, 1);
  const E = o.ear;
  if (E === 'bear') for (const sx of [-1, 1]) { add(new THREE.SphereGeometry(0.2, 14, 10), fur, sx * 0.45, 0.48, -0.05, head); add(new THREE.SphereGeometry(0.11, 10, 8), M(o.inner), sx * 0.45, 0.49, 0.08, head).scale.z = 0.4; }
  if (E === 'bunny') for (const sx of [-1, 1]) { const e = add(new THREE.CapsuleGeometry(0.13, 0.55, 6, 10), fur, sx * 0.2, 0.85, -0.05, head); e.rotation.z = -sx * 0.12; const i = add(new THREE.CapsuleGeometry(0.06, 0.4, 6, 8), M(o.inner), sx * 0.2, 0.86, 0.06, head); i.rotation.z = -sx * 0.12; i.scale.z = 0.5; }
  if (E === 'cat') for (const sx of [-1, 1]) { const e = add(new THREE.ConeGeometry(0.2, 0.35, 4), fur, sx * 0.38, 0.58, 0, head); e.rotation.z = -sx * 0.3; }
  if (E === 'frog') for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.2, 14, 10), fur, sx * 0.3, 0.5, 0.15, head);
  if (E === 'dog') for (const sx of [-1, 1]) { const e = add(new THREE.SphereGeometry(0.22, 12, 10), M(o.inner), sx * 0.6, 0.05, -0.02, head); e.scale.set(0.55, 1.25, 0.8); e.rotation.z = sx * 0.25; }
  if (E === 'mouse') for (const sx of [-1, 1]) { add(new THREE.SphereGeometry(0.3, 16, 12), fur, sx * 0.48, 0.52, -0.08, head).scale.z = 0.35; add(new THREE.SphereGeometry(0.2, 12, 10), M(o.inner), sx * 0.48, 0.52, 0.03, head).scale.z = 0.25; }
  if (E === 'pig') { for (const sx of [-1, 1]) { const e = add(new THREE.ConeGeometry(0.17, 0.3, 4), fur, sx * 0.4, 0.55, 0, head); e.rotation.z = -sx * 0.5; } const sn = add(new THREE.CylinderGeometry(0.17, 0.19, 0.16, 18), M(o.inner), 0, -0.12, 0.6, head); sn.rotation.x = Math.PI / 2; for (const sx of [-0.06, 0.06]) add(new THREE.SphereGeometry(0.035, 8, 6), M(0x6a2a3a), sx, -0.12, 0.69, head); }
  if (E === 'duck') { const tuft = add(new THREE.ConeGeometry(0.1, 0.3, 8), fur, 0, 0.62, 0, head); tuft.rotation.z = 0.3; const beak = add(new THREE.SphereGeometry(0.24, 16, 10), M(0xffa53a), 0, -0.12, 0.55, head); beak.scale.set(1.2, 0.45, 0.9); }
  if (o.muzzle) add(new THREE.SphereGeometry(0.24, 14, 10), M(o.muzzle), 0, -0.18, 0.5, head).scale.set(1.1, 0.75, 0.6);
  const ey = E === 'frog' ? 0.52 : 0.05, ez = E === 'frog' ? 0.32 : 0.56, ex = E === 'frog' ? 0.3 : 0.24;
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.075, 12, 10), M(0x1e1824, { roughness: 0.3 }), sx * ex, ey, ez, head); eye.scale.set(1, 1.35, 0.5); eyes.push(eye);
    add(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), sx * ex + 0.02, ey + 0.04, ez + 0.035, head);
    add(new THREE.CircleGeometry(0.1, 14), new THREE.MeshBasicMaterial({ color: 0xff8aa8, transparent: true, opacity: 0.6 }), sx * 0.42, -0.13, 0.47, head).rotation.y = sx * 0.6;
  }
  if (E === 'frog') add(new THREE.TorusGeometry(0.16, 0.025, 6, 16, Math.PI), M(0x2b2233), 0, -0.12, 0.54, head).rotation.z = Math.PI;
  else if (E !== 'pig' && E !== 'duck') add(new THREE.SphereGeometry(0.07, 10, 8), M(o.nose), 0, -0.08, 0.65, head).scale.set(1.3, 0.9, 0.8);
  if (spec.hat) add(new THREE.CylinderGeometry(0.35, 0.42, 0.25, 16), M(hex(spec.hat)), 0, 0.55, 0, head);
  finish(g, { body, head, arms, eyes, legs });
  return g;
}

function buildSnake(o) {
  const g = new THREE.Group();
  const skin = M(o.fur, { roughness: 0.7 });
  const belly = M(0xfff2b8, { roughness: 0.8 });
  const body = new THREE.Group(); g.add(body);
  // coils
  for (let i = 0; i < 3; i++) { const c = add(new THREE.TorusGeometry(0.55 - i * 0.12, 0.2, 12, 28), skin, 0, 0.2 + i * 0.32, 0, body); c.rotation.x = Math.PI / 2; }
  // neck rising in an S
  const pts = [new THREE.Vector3(0.1, 0.9, 0.1), new THREE.Vector3(0.0, 1.25, 0.15), new THREE.Vector3(-0.08, 1.55, 0.12), new THREE.Vector3(0, 1.75, 0.05)];
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.19, 12), skin, 0, 0, 0, body);
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((v) => v.clone().add(new THREE.Vector3(0, 0, 0.1)))), 16, 0.12, 10), belly, 0, 0, 0, body);
  // scarf in "shirt" colour
  add(new THREE.TorusGeometry(0.22, 0.08, 8, 18), M(o.shirt), 0, 1.62, 0.06, body).rotation.x = Math.PI / 2;
  const head = new THREE.Group(); head.position.set(0, 1.98, 0.08); body.add(head);
  add(new THREE.SphereGeometry(0.42, 22, 16), skin, 0, 0, 0, head).scale.set(1.15, 0.85, 1.05);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.07, 12, 10), M(0x1e1824, { roughness: 0.3 }), sx * 0.2, 0.1, 0.36, head); eye.scale.set(1, 1.35, 0.5); eyes.push(eye);
    add(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), sx * 0.2 + 0.02, 0.14, 0.39, head);
    add(new THREE.CircleGeometry(0.08, 14), new THREE.MeshBasicMaterial({ color: 0xff8aa8, transparent: true, opacity: 0.6 }), sx * 0.3, -0.06, 0.33, head).rotation.y = sx * 0.5;
  }
  add(new THREE.TorusGeometry(0.1, 0.02, 6, 14, Math.PI), M(0x2b2233), 0, -0.08, 0.38, head).rotation.z = Math.PI;
  const tongue = add(new THREE.BoxGeometry(0.04, 0.02, 0.22), M(0xe8566a), 0, -0.16, 0.45, head);
  finish(g, { body, head, arms: [], eyes, tongue });
  return g;
}

function finish(g, parts) {
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  let t = Math.random() * 10, blink = 2 + Math.random() * 3, step = 0;
  const armRest = parts.arms.map((a) => a.rotation.z);
  const legs = parts.legs || [];
  g.userData.parts = parts;
  // walk: 0..1 (blended by the caller); act: null | 'hop' | 'wave' | 'look' | 'happy', actT: seconds into it
  g.userData.animate = (dt, { talking = false, walk = 0, act = null, actT = 0 } = {}) => {
    t += dt;
    if (walk > 0.01) step += dt * 9; else step = 0;
    const sw = Math.sin(step);
    let lift = 0, headYaw = 0;
    if (act === 'hop' || act === 'happy') {
      const T = act === 'hop' ? 0.5 : 0.36, k = (actT % T) / T;
      if (act === 'hop' || actT < T * 2) lift = Math.sin(k * Math.PI) * (act === 'hop' ? 0.28 : 0.16);
    }
    if (act === 'look') headYaw = Math.sin(Math.min(1, actT / 1.8) * Math.PI * 2) * 0.55;
    const bob = talking ? Math.abs(Math.sin(t * 9)) * 0.05 : walk > 0.01 ? Math.abs(sw) * 0.07 * walk : Math.sin(t * 2) * 0.015;
    parts.body.position.y = bob + lift;
    legs.forEach((l, i) => { l.rotation.x = (i ? -sw : sw) * 0.55 * walk; l.position.y = 0.36 + lift; });
    // a little waddle while walking
    parts.body.rotation.z = Math.sin(step) * 0.07 * walk;
    parts.head.rotation.z = Math.sin(t * (talking ? 6 : 1.3)) * (talking ? 0.08 : 0.03);
    parts.head.rotation.y = headYaw;
    parts.arms.forEach((a, i) => {
      a.rotation.x = talking ? Math.sin(t * 8 + i * 3) * 0.4 : (i ? sw : -sw) * 0.5 * walk;
      a.rotation.z = armRest[i];
    });
    if (act === 'wave' && parts.arms[1]) { // the right arm up, waving
      const a = parts.arms[1], up = Math.min(1, actT / 0.25) * Math.min(1, Math.max(0, (1.5 - actT) / 0.25));
      a.rotation.z = armRest[1] + up * 2.2; a.rotation.x = Math.sin(actT * 14) * 0.35 * up;
    }
    if (parts.tongue) parts.tongue.visible = act === 'wave' ? Math.sin(actT * 18) > 0 : Math.sin(t * 3) > 0.6;
    if (!legs.length) parts.body.rotation.z = Math.sin(t * 6) * 0.12 * walk; // the snake sways along
    blink -= dt;
    const closed = blink < 0.12;
    parts.eyes.forEach((e) => { e.scale.y = closed ? 0.15 : 1.35; });
    if (blink < 0) blink = 2 + Math.random() * 3.5;
  };
}
