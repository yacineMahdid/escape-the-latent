// The little door: Speck-sized (about 3 units tall, the Speck is 1.9). One sits in the baseboard of
// Becancourt's lab; its twin stands at the entrance of every small world. It really opens.
//   const door = buildLittleDoor({ standalone })   // standalone: free-standing frame on a stone step
//   door.userData.setOpen(true | false)            // animates; door.userData.update(dt) every frame
//   door.userData.openNow(v)                       // jump straight to open (1) or shut (0)
// Origin at the floor, centred on the threshold; the door faces +z.
import * as THREE from 'three';

const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

function archShape(w, h, r) {
  // rectangle with a round top: width w, total height h, arch radius r (= w / 2)
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-w / 2, 0);
  return s;
}

export function buildLittleDoor({ standalone = false, wood = 0xa86a3c, frame = 0x6e4426, glow = 0xffd88a } = {}) {
  const root = new THREE.Group();
  root.name = 'little-door';
  const W = 2.0, H = 3.0, R = 1.0;

  // frame: an arch-shaped ring (outer arch minus inner arch)
  const outer = archShape(W + 0.7, H + 0.35, R + 0.35);
  outer.holes.push(archShape(W, H, R));
  const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 20 });
  frameGeo.translate(0, 0, -0.25);
  const frameMesh = new THREE.Mesh(frameGeo, L(frame));
  root.add(frameMesh);
  // keystone + two little hinges' plates on the frame
  const key = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.62), L(0x8a5a36));
  key.position.set(0, H + 0.12, 0); root.add(key);

  // the glowing passage behind the door
  const passage = new THREE.Mesh(new THREE.ShapeGeometry(archShape(W, H, R), 20), new THREE.MeshBasicMaterial({ color: glow }));
  passage.position.z = -0.2; root.add(passage);
  const passDeep = new THREE.Mesh(new THREE.ShapeGeometry(archShape(W * 0.7, H * 0.78, R * 0.7), 20), new THREE.MeshBasicMaterial({ color: 0xfff3d6 }));
  passDeep.position.z = -0.19; root.add(passDeep);

  // the door leaf, hinged on its left edge
  const hinge = new THREE.Group(); hinge.position.set(-W / 2, 0, 0.05); root.add(hinge);
  const leafShape = archShape(W - 0.08, H - 0.04, R - 0.04);
  const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 20 });
  leafGeo.translate((W - 0.08) / 2, 0.02, -0.08);
  const leaf = new THREE.Mesh(leafGeo, L(wood)); hinge.add(leaf);
  // planks, a round window, a brass knob
  for (const dx of [0.5, 1.0, 1.5]) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.035, H - 0.6, 0.02), L(0x7a4a26)); g.position.set(dx - 0.04, (H - 0.6) / 2 + 0.1, 0.11); hinge.add(g); }
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), new THREE.MeshBasicMaterial({ color: glow })); win.position.set(W / 2 - 0.04, H - 0.85, 0.115); hinge.add(win);
  const winRim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 8, 24), L(0x6e4426)); winRim.position.copy(win.position); hinge.add(winRim);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.03), L(0x6e4426)); bar.position.copy(win.position); bar.position.z += 0.01; hinge.add(bar);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe0b040, roughness: 0.35, metalness: 0.6 }));
  knob.position.set(W - 0.42, 1.35, 0.2); hinge.add(knob);
  for (const y of [0.55, H - 0.9]) { const hp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.04), L(0x3a3440)); hp.position.set(0.2, y, 0.11); hinge.add(hp); }

  // a tiny lantern above and a doormat
  const lantern = new THREE.Group(); lantern.position.set(W / 2 + 0.55, H - 0.2, 0.35); root.add(lantern);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), L(0x3a3440)); rod.position.set(0, 0.25, -0.2); lantern.add(rod);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: glow })); lantern.add(bulb);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 8), L(0x3a3440)); cap.position.y = 0.2; lantern.add(cap);
  const mat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 1.1), L(0xc0483c)); mat.position.set(0, 0.03, 0.95); root.add(mat);
  const matEdge = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.065, 0.85), L(0xe8c070)); matEdge.position.set(0, 0.035, 0.95); root.add(matEdge);

  if (standalone) {
    // free-standing: a stone step and two side buttresses so it looks planted, not floating
    const step = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.3, 1.5), L(0xb9b2a6)); step.position.set(0, 0.15, -0.1); root.add(step);
    root.children.forEach((c) => { if (c !== step && c !== mat && c !== matEdge) c.position.y += 0.3; });
    hinge.position.y = 0.3;
    for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.9), L(0x9a9184)); b.position.set(sx * (W / 2 + 0.55), 1.0, -0.35); root.add(b); }
    mat.position.y = 0.33; matEdge.position.y = 0.335; mat.position.z = 1.2; matEdge.position.z = 1.2;
  }

  root.traverse((o) => { if (o.isMesh && !(o.material instanceof THREE.MeshBasicMaterial)) { o.castShadow = true; o.receiveShadow = true; } });

  let open = 0, target = 0;
  const apply = () => { hinge.rotation.y = -open * 1.75; };
  root.userData.setOpen = (v) => { target = v ? 1 : 0; };
  root.userData.openNow = (v) => { open = target = v ? 1 : 0; apply(); };
  root.userData.isOpen = () => open > 0.5;
  root.userData.update = (dt) => {
    if (open !== target) { open += Math.sign(target - open) * Math.min(Math.abs(target - open), dt * 2.6); apply(); }
    bulb.scale.setScalar(1 + Math.sin(performance.now() / 300) * 0.04);
  };
  apply();
  return root;
}
