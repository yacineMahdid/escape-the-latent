// A slowly panning diorama used behind the title card and the ending credits.
import * as THREE from 'three';
import { buildDiorama, ANCHORS } from '../../engine/diorama.js';
import { buildVillager } from '../../engine/villagers.js';

export function createBackdropScene(biome = 'meadow', { cast = [] } = {}) {
  const world = buildDiorama(biome, { seed: 5 });
  const scene = new THREE.Scene();
  scene.add(world.root);
  scene.fog = new THREE.Fog(...world.biome.fog);
  const B = world.biome;
  scene.add(new THREE.HemisphereLight(B.light.sky, B.light.ground, B.light.hi));
  const sun = new THREE.DirectionalLight(B.light.sun, B.light.si); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 22, bottom: -16, near: 1, far: 100 });
  scene.add(sun, sun.target);
  const people = cast.map(([species, anchor, colors]) => { const v = buildVillager({ species, colors }); const a = ANCHORS[anchor]; v.position.set(...a); v.rotation.y = 0.2; scene.add(v); return v; });
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 600);
  let t0 = 0;
  return {
    scene, camera,
    update(dt, t) {
      t0 += dt;
      const x = -8 + Math.sin(t0 * 0.05) * 18;
      camera.position.set(x, 8.5, 24); camera.lookAt(x, 1.2, -3);
      sun.position.set(x - 14, 26, 22); sun.target.position.set(x, 0, -4);
      world.update(dt, t);
      people.forEach((p) => p.userData.animate?.(dt, {}));
    },
    dispose() { scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }); },
  };
}
