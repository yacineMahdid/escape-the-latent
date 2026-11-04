// The player: a humans.js model (or a stand-in if that module is missing) that walks on the diorama.
import * as THREE from 'three';
import { moveOnSurface } from '../engine/walk.js';
import { input } from '../engine/input.js';

let humans = null;
export async function loadHumans() {
  if (humans !== null) return humans;
  try { humans = await import('../engine/humans.js'); } catch (e) { console.warn('humans.js unavailable, using a stand-in', e); humans = false; }
  return humans;
}

// Jean-Lafontaine de Becancourt: the model in engine/scientist.js, else false (callers then use
// scientistStandIn()). The old Einstein-style model in humans.js is never used.
let scientistBuilder = null;
export async function loadScientist() {
  if (scientistBuilder !== null) return scientistBuilder;
  try { scientistBuilder = (await import('../engine/scientist.js')).buildScientist || false; }
  catch (e) { console.warn('scientist.js unavailable, using the stand-in', e); scientistBuilder = false; }
  return scientistBuilder;
}

// Fallback figure (~10 units, feet at 0, faces +z): a grumpy old man with long black hair, a black
// beard, big black brows, a sweater and his coffee mug. Same userData API as the real model.
export function scientistStandIn() {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body); // animate() bobs this, never the root the scene positions
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const black = m(0x211c22), skin = m(0xe2b08c), sweater = m(0x7a6a3a);
  const add = (geo, mat, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent.add(o); return o; };
  add(new THREE.CapsuleGeometry(0.55, 2.4, 6, 12), m(0x4a4250), -0.65, 1.6, 0);
  add(new THREE.CapsuleGeometry(0.55, 2.4, 6, 12), m(0x4a4250), 0.65, 1.6, 0);
  add(new THREE.CapsuleGeometry(1.7, 2.6, 8, 20), sweater, 0, 4.9, 0).scale.set(1, 1, 0.82);
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.5, 2.2, 6, 12), sweater, sx * 1.95, 5.1, 0.3).rotation.z = sx * 0.35;
  const mug = add(new THREE.CylinderGeometry(0.48, 0.44, 1.0, 20), m(0xfffdf6), -2.3, 4.1, 1.0);
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 20), m(0xe8566a), 0, 0.2, 0, mug);
  const head = new THREE.Group(); head.position.set(0, 8.2, 0.2); body.add(head);
  add(new THREE.SphereGeometry(1.55, 28, 20), skin, 0, 0, 0, head).scale.set(1.05, 1, 1);
  add(new THREE.SphereGeometry(1.68, 24, 18), black, 0, 0.25, -0.35, head).scale.set(1.08, 1.02, 1);
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.5, 2.6, 6, 12), black, sx * 1.45, -1.3, -0.35, head).rotation.z = sx * -0.12;
  add(new THREE.SphereGeometry(1.25, 22, 16), black, 0, -1.05, 0.55, head).scale.set(1.05, 1.15, 0.75);
  add(new THREE.SphereGeometry(0.42, 16, 12), m(0xd99a7c), 0, -0.15, 1.5, head);
  const mouth = add(new THREE.SphereGeometry(0.2, 12, 8), m(0x5a2030), 0, -0.82, 1.55, head); mouth.scale.set(1.6, 0.5, 0.5);
  const brows = [];
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(0.17, 12, 10), m(0x1e1824), sx * 0.55, 0.22, 1.42, head).scale.set(1, 1.3, 0.6);
    const b = add(new THREE.CapsuleGeometry(0.2, 0.75, 6, 10), black, sx * 0.6, 0.62, 1.38, head); b.rotation.z = Math.PI / 2; b.userData.sx = sx; brows.push(b);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  let t = 0; let expr = 'grumpy';
  const pose = () => brows.forEach((b) => { const sx = b.userData.sx; b.position.y = expr === 'surprised' ? 0.85 : expr === 'grumpy' ? 0.52 : 0.64; b.rotation.z = Math.PI / 2 + (expr === 'surprised' ? sx * 0.15 : expr === 'grumpy' ? -sx * 0.35 : 0); });
  g.userData.setExpression = (e) => { expr = ['grumpy', 'neutral', 'surprised', 'talking'].includes(e) ? e : 'neutral'; pose(); };
  g.userData.expression = () => expr;
  g.userData.parts = { head, brows, mug };
  g.userData.animate = (dt, { talking = false } = {}) => { t += dt; body.position.y = Math.sin(t * 1.5) * 0.04; mouth.scale.y = talking || expr === 'talking' ? 0.5 + Math.abs(Math.sin(t * 11)) * 1.2 : expr === 'surprised' ? 1.4 : 0.5; };
  pose();
  return g;
}

function standIn(params = {}) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 6, 12), m(params.topColor || '#4f86d8')); body.position.y = 0.7; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), m(params.skin || '#f0c4a0')); head.position.y = 1.45; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.52, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), m(params.hairColor || '#3b2a20')); hair.position.y = 1.5; g.add(hair);
  for (const sx of [-0.16, 0.16]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), m('#1e1824')); e.position.set(sx, 1.45, 0.46); e.scale.y = 1.4; g.add(e); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  let t = 0;
  g.userData.animate = (dt, { moving }) => { t += dt; body.position.y = 0.7 + (moving ? Math.abs(Math.sin(t * 10)) * 0.06 : Math.sin(t * 2) * 0.01); };
  return g;
}

export async function createPlayer(character) {
  const h = await loadHumans();
  const model = h && h.buildHuman ? h.buildHuman(character || {}) : standIn(character || {});
  const pos = { x: 0, y: 0, z: 0 };
  let facing = 1;
  const SPEED = 4.6;
  return {
    model,
    pos,
    get facing() { return facing; },
    place(x, y, z) { pos.x = x; pos.y = y; pos.z = z; model.position.set(x, y, z); },
    // world: { zones, colliders }
    update(dt, world, frozen = false) {
      let moving = false;
      if (!frozen) {
        const a = input.axis();
        if (a.x || a.z) {
          const len = Math.hypot(a.x, a.z);
          const next = moveOnSurface(world, pos, (a.x / len) * SPEED * dt, (a.z / len) * SPEED * dt * 0.85);
          moving = Math.abs(next.x - pos.x) + Math.abs(next.z - pos.z) > 1e-4;
          pos.x = next.x; pos.z = next.z;
          pos.y += (next.y - pos.y) * Math.min(1, dt * 18);
          if (a.x) facing = a.x > 0 ? 1 : -1;
        }
      }
      model.position.set(pos.x, pos.y, pos.z);
      if (model.userData.animate) model.userData.animate(dt, { moving, speed: moving ? 1 : 0, facing });
      if (!model.userData.handlesFacing) {
        const target = moving ? facing * 0.9 : facing * 0.25;
        model.rotation.y += (target - model.rotation.y) * Math.min(1, dt * 10);
      }
      return moving;
    },
  };
}
