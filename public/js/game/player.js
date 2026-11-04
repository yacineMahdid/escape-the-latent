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
