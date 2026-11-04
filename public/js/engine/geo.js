// Small geometry/material helpers shared by the world builders.
import * as THREE from 'three';

export const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
export const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function add(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function group(parent, x = 0, y = 0, z = 0, s = 1, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  parent.add(g);
  return g;
}

// Rounded box (extruded rounded rectangle with bevel), centred on the origin.
export function rbox(w, h, d, rad) {
  rad = Math.min(rad, w / 2 - 0.001, h / 2 - 0.001);
  const s = new THREE.Shape();
  const x = -w / 2 + rad, y = -h / 2 + rad, W = w - 2 * rad, H = h - 2 * rad;
  s.moveTo(x, y);
  s.absarc(x + W, y, rad, -Math.PI / 2, 0);
  s.absarc(x + W, y + H, rad, 0, Math.PI / 2);
  s.absarc(x, y + H, rad, Math.PI / 2, Math.PI);
  s.absarc(x, y, rad, Math.PI, Math.PI * 1.5);
  const depth = Math.max(0.0001, d - 2 * rad);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: rad * 0.9, bevelThickness: rad, bevelSegments: 4, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Deterministic RNG (Park-Miller), so every region looks the same each visit.
export function createRng(seed = 11) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of ['map', 'emissiveMap', 'normalMap']) if (m[k]) m[k].dispose();
        m.dispose();
      }
    }
  });
}
