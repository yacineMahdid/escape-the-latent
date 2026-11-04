// Interactive objects that are not people: terminals, boards, mailboxes, signs, machines.
import * as THREE from 'three';
import { rbox } from '../engine/geo.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
const add = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };

export function buildStation(kind = 'machine', { accent = 0xff7ab8 } = {}) {
  const g = new THREE.Group();
  const updaters = [];
  if (kind === 'terminal') {
    add(rbox(1.6, 0.9, 1.0, 0.08), M(0xb9824a), 0, 0.45, 0, g); // desk
    add(rbox(1.2, 0.95, 0.85, 0.16), M(0xf2ead8), 0, 1.4, -0.1, g); // monitor body
    const screen = add(new THREE.PlaneGeometry(0.85, 0.6), new THREE.MeshBasicMaterial({ color: 0x5cf0b8 }), 0, 1.45, 0.33, g);
    add(rbox(1.0, 0.12, 0.4, 0.05), M(0xe6dcc6), 0, 0.97, 0.3, g); // keyboard
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.6 - i * 0.12, 0.04, 0.01), new THREE.MeshBasicMaterial({ color: 0x1e5a44 }), -0.05, 1.6 - i * 0.1, 0.335, g);
    updaters.push((dt, t) => { screen.material.color.setHSL(0.43, 0.8, 0.62 + Math.sin(t * 3) * 0.05); });
  } else if (kind === 'board') {
    for (const sx of [-0.7, 0.7]) add(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), M(0x8a5a36), sx, 1.1, 0, g);
    add(rbox(1.9, 1.3, 0.12, 0.06), M(0xc8956a), 0, 1.45, 0.05, g);
    const cols = [0xfff6d0, 0xffd6e8, 0xd6f0ff, 0xe8ffd6];
    for (let i = 0; i < 6; i++) { const c = add(new THREE.BoxGeometry(0.42, 0.32, 0.02), M(cols[i % 4]), -0.6 + (i % 3) * 0.6, 1.7 - Math.floor(i / 3) * 0.5, 0.13, g); c.rotation.z = (Math.random() - 0.5) * 0.2; add(new THREE.SphereGeometry(0.04, 8, 6), M(accent), c.position.x, c.position.y + 0.12, 0.15, g); }
  } else if (kind === 'mailbox') {
    add(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8), M(0x8a5a36), 0, 0.55, 0, g);
    add(rbox(0.6, 0.5, 0.9, 0.2), M(accent), 0, 1.3, 0, g);
    const flag = add(new THREE.BoxGeometry(0.04, 0.3, 0.2), M(0xffd35a), 0.33, 1.45, 0.1, g);
    updaters.push((dt, t) => { flag.rotation.x = Math.sin(t * 2) * 0.2; });
  } else if (kind === 'sign') {
    add(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), M(0x8a5a36), 0, 0.8, 0, g);
    add(rbox(1.4, 0.8, 0.12, 0.08), M(0xf6d79a), 0, 1.55, 0.05, g);
  } else {
    // a whimsical paper machine: drum + gears + lamp
    add(rbox(1.5, 1.1, 1.1, 0.15), M(0xd8c8f0), 0, 0.55, 0, g);
    const drum = add(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 20), M(accent), 0, 1.45, 0, g); drum.rotation.z = Math.PI / 2;
    const gears = [];
    for (const [x, y, r] of [[-0.85, 1.0, 0.3], [0.85, 1.15, 0.24]]) { const ge = add(new THREE.TorusGeometry(r, 0.07, 6, 10), M(0xffd35a), x, y, 0.35, g); gears.push(ge); }
    const lamp = add(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }), 0, 2.05, 0, g);
    updaters.push((dt, t) => { drum.rotation.x += dt * 0.8; gears.forEach((ge, i) => { ge.rotation.z += dt * (i ? -1.6 : 1.2); }); lamp.scale.setScalar(1 + Math.sin(t * 4) * 0.08); });
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.update = (dt, t) => updaters.forEach((u) => u(dt, t));
  return g;
}
