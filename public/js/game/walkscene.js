// Base for scenes where the player walks around: lights, player, camera follow,
// nearest-interactable prompt, and key actions (act / book / map / menu).
import * as THREE from 'three';
import { input } from '../engine/input.js';
import { isModalOpen } from '../ui/modal.js';
import { showPrompt, hidePrompt } from './hud.js';

export function createWalkScene({ engine, world, player, light, fog, background, camera: camCfg, actions = {} }) {
  const scene = new THREE.Scene();
  scene.add(world.root);
  if (fog) scene.fog = new THREE.Fog(...fog);
  if (background !== undefined) scene.background = new THREE.Color(background);
  scene.add(new THREE.HemisphereLight(light.sky, light.ground, light.hi));
  const sun = new THREE.DirectionalLight(light.sun, light.si);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 20, bottom: -16, near: 1, far: 100 });
  scene.add(sun, sun.target);
  scene.add(player.model);

  const camera = new THREE.PerspectiveCamera(camCfg.fov ?? 32, 16 / 9, 0.1, 600);
  const cam = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
  const interactables = [];
  const extras = []; // objects with userData.update
  let busy = false;
  let cooldownUntil = 0; // swallow the key press that closed a dialogue
  let disposed = false;

  // Camera shots: blend from pose a to pose b (null = the follow camera).
  const tmpCam = new THREE.PerspectiveCamera();
  let shot = null;
  const pose = (pos, look) => { tmpCam.position.set(...pos); tmpCam.lookAt(...look); return { p: tmpCam.position.clone(), q: tmpCam.quaternion.clone() }; };
  const followPose = () => { camCfg.place(tmpCam, cam); return { p: tmpCam.position.clone(), q: tmpCam.quaternion.clone() }; };
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
  function startShot(a, b, ms, hold) {
    return new Promise((resolve) => { shot?.resolve(); shot = { a, b, ms, hold, t0: performance.now(), resolve }; });
  }

  function placeCamera(dt, snap) {
    const k = snap ? 1 : Math.min(1, dt * 4);
    cam.x += (player.pos.x - cam.x) * k; cam.y += (player.pos.y - cam.y) * k; cam.z += (player.pos.z - cam.z) * k;
    if (shot) {
      const u = Math.min(1, (performance.now() - shot.t0) / shot.ms);
      const a = shot.a || followPose(); const b = shot.b || followPose();
      camera.position.lerpVectors(a.p, b.p, ease(u));
      camera.quaternion.slerpQuaternions(a.q, b.q, ease(u));
      if (u >= 1 && !shot.done) { shot.done = true; shot.resolve(); if (!shot.hold) shot = null; }
    } else camCfg.place(camera, cam);
    const dir = light.dir || [-14, 26, 22];
    sun.position.set(cam.x + dir[0], cam.y + dir[1], cam.z + dir[2]);
    sun.target.position.set(cam.x, cam.y, cam.z - 4);
  }

  function nearest() {
    let best = null, bd = Infinity;
    for (const it of interactables) {
      if (it.enabled === false) continue;
      const p = typeof it.pos === 'function' ? it.pos() : it.pos;
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      const dy = Math.abs((p.y ?? 0) - player.pos.y);
      if (d < (it.radius ?? 2.0) && dy < 1.2 && d < bd) { best = it; bd = d; }
    }
    return best;
  }

  async function run(fn) {
    if (busy) return;
    busy = true; hidePrompt();
    try { await fn(); } catch (e) { console.error(e); } finally { busy = false; input.clear(); cooldownUntil = performance.now() + 350; }
  }

  const promptPos = new THREE.Vector3();
  const api = {
    scene, camera, sun, interactables, extras,
    get busy() { return busy; },
    run,
    addInteractable(it) { interactables.push(it); return it; },
    removeInteractable(it) { const i = interactables.indexOf(it); if (i >= 0) interactables.splice(i, 1); },
    snapCamera() { placeCamera(0, true); },
    // move the camera to look at `look` from `pos`, and stay there
    cameraTo(pos, look, ms = 700) { return startShot({ p: camera.position.clone(), q: camera.quaternion.clone() }, pose(pos, look), ms, true); },
    // start at a pose and ease back into the follow camera
    cameraFrom(pos, look, ms = 1000) { const a = pose(pos, look); camera.position.copy(a.p); camera.quaternion.copy(a.q); return startShot(a, null, ms, false); },
    update(dt, t) {
      if (disposed) return;
      world.update?.(dt, t);
      for (const e of extras) e.userData.update?.(dt, t);
      player.update(dt, world, busy || isModalOpen());
      placeCamera(dt, false);
      if (!busy && !isModalOpen() && performance.now() < cooldownUntil) { input.clear(); hidePrompt(); }
      else if (!busy && !isModalOpen()) {
        const it = nearest();
        if (it) {
          const p = typeof it.pos === 'function' ? it.pos() : it.pos;
          promptPos.set(p.x, (p.y ?? 0) + (it.promptHeight ?? 2.6), p.z);
          showPrompt(`${it.icon || '💬'} ${it.label || ''}`.trim(), promptPos, camera, engine.renderer);
          if (input.take('act')) run(() => it.onInteract());
        } else { hidePrompt(); input.take('act'); }
        if (input.take('book')) run(() => actions.book?.());
        if (input.take('map')) run(() => actions.map?.());
        if (input.take('menu')) run(() => actions.menu?.());
      } else hidePrompt();
      actions.tick?.(dt, t);
    },
    dispose() {
      disposed = true; hidePrompt();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } });
    },
  };
  api.player = player;
  if (window.__etl) window.__etl.ws = api; // debug/testing hook
  placeCamera(0, true);
  return api;
}

// Paper Mario-ish follow camera for the layered diorama.
export const dioramaCamera = {
  fov: 32,
  place(camera, c) {
    const x = Math.max(-27, Math.min(30, c.x));
    camera.position.set(x, c.y + 6.6, c.z + 19.5);
    camera.lookAt(x, c.y + 1.4, c.z - 3);
  },
};
