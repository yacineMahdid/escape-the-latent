// Artefacts on a paper pedestal: the relic itself comes from engine/landmarks.js (built to the region's
// artefact.look); the simple shapes below are only a fallback for a region without one.
import * as THREE from 'three';
import { buildRelic } from '../engine/landmarks.js';

const TINTS = { attention: 0xffb84d, clip: 0x4fd8e8, mamba: 0x7fdc5a };

export function buildArtefact(regionId, { pedestal = true } = {}) {
  const tint = TINTS[regionId] ?? 0xff7ab8;
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
  if (pedestal) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.5, 24), M(0xf6efdc)); p.position.y = 0.25; g.add(p);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 8, 28), M(tint)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.5; g.add(rim);
  }
  const relic = new THREE.Group(); relic.position.y = pedestal ? 1.35 : 0.6; g.add(relic);
  const model = buildRelic(regionId);
  if (model) {
    relic.add(model);
  } else if (regionId === 'attention') {
    // a lens of many heads: a faceted gem ringed by eight little eyes
    relic.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), M(tint, { emissive: tint, emissiveIntensity: 0.4, flatShading: true })));
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), M(0xfffdf6, { emissive: 0xffffff, emissiveIntensity: 0.3 })); e.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0); relic.add(e); const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M(0x2b2233)); pupil.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.06); relic.add(pupil); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 40), M(tint)); relic.add(ring);
  } else if (regionId === 'clip') {
    // twin frames: a photo and a caption card joined by a glowing thread
    const photo = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.05), M(0xffffff)); photo.position.x = -0.32; relic.add(photo);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), M(0x4fd8e8, { emissive: 0x2aa6b0, emissiveIntensity: 0.4 })); pic.position.set(-0.32, 0, 0.03); relic.add(pic);
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.05), M(0xfff6d0)); card.position.x = 0.32; relic.add(card);
    for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.34 - i * 0.06, 0.025, 0.01), M(0x5a4f66)); l.position.set(0.3, 0.06 - i * 0.06, 0.03); relic.add(l); }
    const thread = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 6, 30, Math.PI), M(tint, { emissive: tint, emissiveIntensity: 0.6 })); thread.position.y = 0.2; relic.add(thread);
  } else if (regionId === 'mamba') {
    // an hourglass with a tiny coiled snake: it keeps only what matters
    const glass = M(0xdff8ff, { transparent: true, opacity: 0.5, roughness: 0.1 });
    for (const sy of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 20, 1, true), glass); c.rotation.x = sy > 0 ? Math.PI : 0; c.position.y = sy * 0.22; relic.add(c); const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 20), M(0xc8956a)); cap.position.y = sy * 0.47; relic.add(cap); }
    const sand = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 16), M(0xf3cf88)); sand.position.y = -0.36; relic.add(sand);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 24), M(tint, { emissive: tint, emissiveIntensity: 0.3 })); coil.rotation.x = Math.PI / 2; coil.position.y = 0.56; relic.add(coil);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), M(tint)); head.position.set(0.2, 0.66, 0); relic.add(head);
  } else {
    relic.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), M(tint, { emissive: tint, emissiveIntensity: 0.4, flatShading: true })));
  }
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.12, depthWrite: false }));
  relic.add(glow);
  g.traverse((o) => { if (o.isMesh && o !== glow) o.castShadow = true; });
  let t = 0;
  g.userData.update = (dt) => { t += dt; model?.userData.update?.(dt, t); relic.rotation.y += dt * 0.9; relic.position.y = (pedestal ? 1.35 : 0.6) + Math.sin(t * 2) * 0.08; glow.scale.setScalar(1 + Math.sin(t * 3) * 0.06); };
  return g;
}

// "The Twin Lens" -> "the Twin Lens"; "Listening Bell" -> "the Listening Bell"
export const theName = (n) => (n ? `the ${n.replace(/^the\s+/i, '')}` : 'the artefact');
