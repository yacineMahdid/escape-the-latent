// The Banana Bet (Pairadise / CLIP, challenge e1): an environmental puzzle played on the island itself.
// Skipper Brine's Sticker Snapper is an ImageNet model: 1000 fixed stickers learned from his catalogue.
// Ten unlabelled props stand around the island, every one with the same '📷 Snap' prompt, so the
// player has to look: six bananas in disguise, one plain catalogue banana and three yellow look-alikes.
// Snap one: a camera flash, a ✓ / ✗ paper flag pops up beside it, then Brine reads out both verdicts
// (his Snapper's sticker, your Lens's name) with a silly reaction. Only a banana the Snapper gets
// wrong counts: 4 of them with 6 shots of film. Out of film, Brine gloats and the bet restarts.
// The paper (§3.3, Fig. 13, whose example class is the banana): an ImageNet ResNet-101 and zero-shot
// CLIP both score 76.2% on ImageNet, but on natural distribution shifts the ResNet collapses (Sketch
// 25.2, ImageNet-R 37.7, ObjectNet 32.6, ImageNet-A 2.7) while CLIP holds (60.2, 88.9, 72.3, 77.1).
// The player builds that robustness test out of the island; the plain banana is in distribution (a
// tie) and the look-alikes are the Snapper's shortcut (yellow + curved = banana).
// Spec: content/extra-draft/clip.json, challenge e1 (positions, looks, verdicts, flow).
// Test hook: every prop's interactable has it.id = prop id (label 'Snap'); it.enabled is false once
// snapped (until the film runs out and the bet restarts).
import { taperTubeGeo } from '../engine/toyparts.js';

const INK = '#2b2233';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const easeBack = (u) => { const c = 1.9; const v = Math.min(1, Math.max(0, u)) - 1; return 1 + (c + 1) * v * v * v + c * v * v; };

// A banana outline in canvas units (y down): the belly is the lower edge, the tips curve up.
function bananaOutline(cx, cy, len, thick, bend) {
  const R = len / bend, top = [], bot = [];
  for (let i = 0; i <= 28; i++) {
    const u = i / 28, a = -bend / 2 + bend * u;
    const x = cx + R * Math.sin(a), y = cy - R * (1 - Math.cos(a));
    const nx = Math.sin(a), ny = Math.cos(a); // outward (belly) normal
    const h = thick * (0.14 + 0.86 * Math.pow(Math.sin(Math.PI * u), 0.6));
    top.push([x - nx * h, y - ny * h]); bot.push([x + nx * h, y + ny * h]);
  }
  const tip0 = [cx + R * Math.sin(-bend / 2), cy - R * (1 - Math.cos(bend / 2))];
  const tip1 = [cx + R * Math.sin(bend / 2), tip0[1]];
  return { pts: [...top, ...bot.reverse()], tip0, tip1, stemDir: [-Math.cos(bend / 2), -Math.sin(bend / 2)] };
}
function outlinePath(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }

// A pencil drawing of a banana: grey hatching, a sketchy outline, no colour.
function drawSketch(g, W, H) {
  g.fillStyle = '#fbf6e6'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(150,130,100,.10)'; for (let i = 0; i < 260; i++) g.fillRect((i * 97) % W, (i * 61) % H, 2, 2);
  const B = bananaOutline(W * 0.5, H * 0.66, W * 0.7, H * 0.16, 1.3);
  g.save(); outlinePath(g, B.pts); g.clip();
  g.strokeStyle = 'rgba(70,70,80,.5)'; g.lineWidth = 1.6;
  for (let x = -H; x < W; x += 8) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.75, 0); g.stroke(); }
  g.strokeStyle = 'rgba(70,70,80,.35)';
  for (let x = 0; x < W + H; x += 13) { g.beginPath(); g.moveTo(x, H * 0.95); g.lineTo(x - H * 0.6, H * 0.35); g.stroke(); }
  g.restore();
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 3; k++) { g.save(); g.translate((k - 1) * 1.7, (1 - k) * 1.1); g.strokeStyle = k === 1 ? '#45454e' : 'rgba(70,70,80,.55)'; g.lineWidth = k === 1 ? 3.4 : 1.6; outlinePath(g, B.pts); g.stroke(); g.restore(); }
  // the ridge along its back, the stem and the dark tip
  g.strokeStyle = 'rgba(60,60,70,.6)'; g.lineWidth = 1.8;
  g.beginPath(); const mid = B.pts.slice(4, 25); mid.forEach(([x, y], i) => (i ? g.lineTo(x, y + 10) : g.moveTo(x, y + 10))); g.stroke();
  const [sx, sy] = B.tip0, [dx, dy] = B.stemDir;
  g.lineWidth = 7; g.strokeStyle = '#4a4a54'; g.beginPath(); g.moveTo(sx + 4, sy + 2); g.lineTo(sx + dx * 18, sy + dy * 18); g.stroke();
  g.fillStyle = '#3a3a44'; g.beginPath(); g.arc(B.tip1[0] - 2, B.tip1[1] + 3, 4.5, 0, 7); g.fill();
  // a scribbled shadow and the artist's initial
  g.strokeStyle = 'rgba(70,70,80,.4)'; g.lineWidth = 2;
  for (let i = 0; i < 7; i++) { const y = H * 0.86 + (i % 2) * 4; g.beginPath(); g.moveTo(W * 0.3 + i * 14, y); g.lineTo(W * 0.3 + i * 14 + 22, y - 2); g.stroke(); }
  g.fillStyle = 'rgba(60,60,70,.55)'; g.font = 'italic 18px Georgia, serif'; g.fillText('B.', W - 34, H - 14);
}

// A cartoon banana with a huge smile and stick arms, flat bright colours.
function drawPainting(g, W, H) {
  g.fillStyle = '#8fdcff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7bcd5d'; g.fillRect(0, H * 0.78, W, H);
  g.fillStyle = '#fff2a0'; g.beginPath(); g.arc(W * 0.87, H * 0.15, 17, 0, 7); g.fill();
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = 6;
  // stick arms (waving) and legs, drawn first so the banana sits on top
  const limb = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  limb([[70, 122], [44, 104], [32, 72]]); limb([[188, 120], [214, 98], [222, 64]]);
  limb([[112, 162], [106, 188]]); limb([[146, 162], [152, 188]]);
  g.fillStyle = '#ffffff'; for (const [x, y] of [[32, 66], [222, 58]]) { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.lineWidth = 4; g.stroke(); }
  g.fillStyle = '#e8566a'; for (const [x, y] of [[100, 190], [158, 190]]) { g.beginPath(); g.ellipse(x, y, 12, 7, 0, 0, 7); g.fill(); g.lineWidth = 4; g.stroke(); }
  const B = bananaOutline(W * 0.5, H * 0.66, W * 0.64, H * 0.2, 1.35);
  g.fillStyle = '#ffe14d'; outlinePath(g, B.pts); g.fill();
  g.save(); outlinePath(g, B.pts); g.clip(); g.fillStyle = '#fff3a6'; g.beginPath(); g.ellipse(W * 0.5, H * 0.43, 60, 12, 0, 0, 7); g.fill(); g.restore();
  g.lineWidth = 6; g.strokeStyle = INK; outlinePath(g, B.pts); g.stroke();
  const [sx, sy] = B.tip0, [dx, dy] = B.stemDir;
  g.lineWidth = 10; g.strokeStyle = '#7a5a2a'; g.beginPath(); g.moveTo(sx + 5, sy + 3); g.lineTo(sx + dx * 16, sy + dy * 16); g.stroke();
  g.fillStyle = '#5a3a1a'; g.beginPath(); g.arc(B.tip1[0] - 3, B.tip1[1] + 4, 6, 0, 7); g.fill();
  // face: big eyes and a HUGE smile
  for (const ex of [108, 150]) {
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(ex, 112, 11, 13, 0, 0, 7); g.fill(); g.lineWidth = 3; g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(ex + 2, 115, 5.5, 0, 7); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex + 4, 112, 2, 0, 7); g.fill();
  }
  g.fillStyle = '#ff9ab8'; for (const cx of [88, 172]) { g.beginPath(); g.ellipse(cx, 128, 9, 5, 0, 0, 7); g.fill(); }
  g.beginPath(); g.moveTo(98, 128); g.quadraticCurveTo(129, 172, 160, 128); g.closePath();
  g.fillStyle = '#5a1a2a'; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  g.fillStyle = '#ff6a8a'; g.beginPath(); g.ellipse(129, 145, 13, 6, 0, 0, 7); g.fill();
}

function drawTag(g, W, H) {
  g.fillStyle = '#fff6dc'; g.beginPath(); g.moveTo(14, 4); g.lineTo(W - 4, 4); g.lineTo(W - 4, H - 4); g.lineTo(14, H - 4); g.lineTo(4, H / 2); g.closePath(); g.fill();
  g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(16, H / 2, 4, 0, 7); g.fill();
  g.font = 'bold 26px "Trebuchet MS", Verdana, sans-serif'; g.textBaseline = 'middle'; g.fillText('No. 954', 28, H / 2 + 1);
}

function drawFlag(good) {
  return (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(W - 6, 6); g.lineTo(W - 32, H / 2); g.lineTo(W - 6, H - 6); g.lineTo(6, H - 6); g.closePath();
    g.fillStyle = good ? '#7bcd5d' : '#9a9aa6'; g.fill();
    g.lineWidth = 6; g.lineJoin = 'round'; g.strokeStyle = INK; g.stroke();
    g.lineCap = 'round';
    const mark = () => { g.beginPath(); if (good) { g.moveTo(34, 58); g.lineTo(54, 78); g.lineTo(92, 30); } else { g.moveTo(40, 32); g.lineTo(84, 78); g.moveTo(84, 32); g.lineTo(40, 78); } };
    mark(); g.strokeStyle = INK; g.lineWidth = 22; g.stroke();
    mark(); g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.stroke();
  };
}

export default {
  mount(w, spec, api) {
    const { THREE } = w;
    const need = spec.need ?? 4;
    const FILM = spec.film ?? 6;
    const giver = spec.speaker || 'brine';
    const ia = spec.interactable || {};
    let n = 0, film = FILM, solved = false, destroyed = false;

    const root = new THREE.Group(); root.name = 'banana-bet';
    w.scene.add(root);
    const UP = new THREE.Vector3(0, 1, 0);
    const shared = new Set();   // flag parts reused by every flag: disposed on destroy
    const tweens = new Set();   // { t, dur, fn(u) }, driven by w.onUpdate
    const loops = [];           // idle animations fn(dt, t)

    // ---------- small builders (chunky toy style: MeshStandardMaterial, roughness ~0.8) ----------
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
    const mesh = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
    const group = (par, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); par.add(g); return g; };
    const stick = (par, a, b, r, mat) => {
      const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
      const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat, 0, 0, 0, par);
      m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
    };
    const canvasTex = (wpx, hpx, draw) => {
      const c = document.createElement('canvas'); c.width = wpx; c.height = hpx; draw(c.getContext('2d'), wpx, hpx);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    };
    const leafGeo = (len, wid) => {
      const s = new THREE.Shape(); s.moveTo(0, 0);
      s.bezierCurveTo(len * 0.28, wid, len * 0.72, wid, len, 0); s.bezierCurveTo(len * 0.72, -wid, len * 0.28, -wid, 0, 0);
      return new THREE.ShapeGeometry(s, 10);
    };
    // A rounded plate w x h (corner radius rad) and d thick, centred: exact size, unlike geo.js rbox.
    const plate = (w, h, d, rad, bev = 0.008) => {
      const s = new THREE.Shape(), x = -w / 2 + bev, y = -h / 2 + bev, W = w - 2 * bev, H = h - 2 * bev;
      const q = Math.min(rad, W / 2 - 0.0005, H / 2 - 0.0005);
      s.moveTo(x + q, y); s.lineTo(x + W - q, y); s.absarc(x + W - q, y + q, q, -Math.PI / 2, 0);
      s.lineTo(x + W, y + H - q); s.absarc(x + W - q, y + H - q, q, 0, Math.PI / 2);
      s.lineTo(x + q, y + H); s.absarc(x + q, y + H - q, q, Math.PI / 2, Math.PI);
      s.lineTo(x, y + q); s.absarc(x + q, y + q, q, Math.PI, Math.PI * 1.5);
      const dep = Math.max(0.0005, d - 2 * bev);
      const geo = new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 10 });
      geo.translate(0, 0, -dep / 2); return geo;
    };
    // A real banana along x (stem end at -x), belly down like a smile, resting on y = 0.
    function banana(par, len = 0.7, thick = 0.09, o = {}) {
      const bend = o.bend ?? 1.15, R = len / bend;
      const g = group(par);
      const pts = [];
      for (let i = 0; i <= 8; i++) { const a = -bend / 2 + (bend * i) / 8; pts.push(new THREE.Vector3(R * Math.sin(a), thick + R * (1 - Math.cos(a)), 0)); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const radius = (u) => thick * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * u), 0.55));
      const skin = M(o.color ?? 0xffd84a, { roughness: o.rough ?? 0.55 });
      const tipM = M(o.tip ?? 0x4a3420, { roughness: 0.7 });
      mesh(taperTubeGeo(curve, radius, 32, 10), skin, 0, 0, 0, g);
      const p1 = curve.getPointAt(1);
      mesh(new THREE.SphereGeometry(thick * 0.31, 10, 8), tipM, p1.x, p1.y, p1.z, g);
      const p0 = curve.getPointAt(0), out = curve.getTangentAt(0).negate();
      mesh(new THREE.SphereGeometry(thick * 0.3, 10, 8), skin, p0.x, p0.y, p0.z, g);
      const sl = thick * 1.3;
      const st = mesh(new THREE.CylinderGeometry(thick * 0.17, thick * 0.24, sl, 8), M(o.stem ?? 0x8a7a3a), 0, 0, 0, g);
      st.position.copy(p0).addScaledVector(out, sl / 2); st.quaternion.setFromUnitVectors(UP, out);
      const e = p0.clone().addScaledVector(out, sl);
      mesh(new THREE.SphereGeometry(thick * 0.19, 8, 6), tipM, e.x, e.y, e.z, g);
      return { g, curve, radius, center: new THREE.Vector3(0, thick + R, 0) };
    }

    // ---------- the ten props: each builds into its group (base at y = 0, facing +z) ----------
    const BUILD = {
      // ImageNet Sketch: a pencil drawing on an easel
      sketch(g) {
        const wood = M(0x9a6a40);
        stick(g, [-0.34, 0, 0.16], [-0.1, 1.32, 0], 0.03, wood);
        stick(g, [0.34, 0, 0.16], [0.1, 1.32, 0], 0.03, wood);
        stick(g, [0, 0, -0.42], [0, 1.24, -0.02], 0.028, wood);
        mesh(plate(0.98, 0.05, 0.13, 0.02), wood, 0, 0.555, 0.12, g);
        const paper = M(0xfbf6e6, { roughness: 0.95 });
        const sheet = mesh(new THREE.BoxGeometry(0.9, 0.7, 0.015), [paper, paper, paper, paper, M(0xffffff, { map: canvasTex(256, 200, drawSketch), roughness: 0.95 }), paper], 0, 0.93, 0.1, g);
        sheet.rotation.x = -0.12;
        const pencil = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 6), M(0x5a5a64), 0.24, 0.6, 0.15, g); pencil.rotation.z = Math.PI / 2;
        mesh(new THREE.ConeGeometry(0.018, 0.05, 6), M(0xe8c89a), 0.395, 0.6, 0.15, g).rotation.z = -Math.PI / 2;
        return { flag: [0.68, 0, 0.12] };
      },
      // ImageNet-R (cartoon, painting): a smiling cartoon banana in a pink frame
      painting(g) {
        const wood = M(0x9a6a40);
        mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), wood, 0, 0.4, 0, g);
        mesh(plate(0.32, 0.08, 0.32, 0.03), wood, 0, 0.04, 0, g);
        const back = M(0xf0e6d0);
        mesh(new THREE.BoxGeometry(1.0, 0.8, 0.04), [back, back, back, back, M(0xffffff, { map: canvasTex(256, 205, drawPainting), roughness: 0.85 }), back], 0, 1.12, 0.06, g);
        const pink = M(0xff7ab8, { roughness: 0.6 });
        mesh(plate(1.16, 0.09, 0.09, 0.03), pink, 0, 1.56, 0.08, g);
        mesh(plate(1.16, 0.09, 0.09, 0.03), pink, 0, 0.68, 0.08, g);
        for (const sx of [-0.535, 0.535]) mesh(plate(0.09, 0.97, 0.09, 0.03), pink, sx, 1.12, 0.08, g);
        return { flag: [0.82, 0, 0.12] };
      },
      // ImageNet-R (toy): an inflatable banana float bobbing in the river, tips up
      float(g) {
        const wl = -1.2 - g.position.y; // the river's surface, in this group's units
        const inner = group(g, 0, 0, 0);
        const body = group(inner, 0, wl + 0.05, 0);
        const yellow = M(0xffe04a, { roughness: 0.28 });
        const R = 1.0, r = 0.28, cy = R; // torus centre above the belly
        const tor = mesh(new THREE.TorusGeometry(R, r, 14, 44, (Math.PI * 2) / 3), yellow, 0, cy, 0, body); tor.rotation.z = (Math.PI * 7) / 6;
        const brown = M(0x5a3a1a, { roughness: 0.6 });
        for (const [a, s] of [[(Math.PI * 7) / 6, -1], [(Math.PI * 11) / 6, 1]]) {
          const px = R * Math.cos(a), py = cy + R * Math.sin(a);
          mesh(new THREE.SphereGeometry(r * 0.995, 14, 10), yellow, px, py, 0, body);
          const out = new THREE.Vector3(s * 0.5, 0.866, 0);
          const nub = mesh(new THREE.CylinderGeometry(0.07, 0.15, 0.2, 10), brown, px + out.x * 0.27, py + out.y * 0.27, 0, body);
          nub.quaternion.setFromUnitVectors(UP, out);
        }
        // the little white valve on top of the tube
        const va = (Math.PI * 29) / 18, vr = R - r;
        const valve = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 10), M(0xffffff, { roughness: 0.4 }), vr * Math.cos(va), cy + vr * Math.sin(va), 0.06, body);
        valve.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-Math.cos(va), -Math.sin(va), 0.25).normalize());
        // ripples around it
        const ripG = new THREE.RingGeometry(0.92, 1.0, 40);
        const rips = [0, 0.5].map((ph) => {
          const m = mesh(ripG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 0, wl + 0.02, 0, g);
          m.rotation.x = -Math.PI / 2; m.userData.ph = ph; return m;
        });
        loops.push((dt, t) => {
          inner.position.y = Math.sin(t * 1.6) * 0.06;
          inner.rotation.z = Math.sin(t * 0.9) * 0.07; inner.rotation.x = Math.sin(t * 0.7 + 1) * 0.04;
          for (const m of rips) { const u = (t * 0.35 + m.userData.ph) % 1; m.scale.set(1.25 + u * 0.6, 0.55 + u * 0.35, 1); m.material.opacity = 0.45 * (1 - u); }
        });
        return { flag: [0.42, wl + 0.2, 0.14], flagParent: inner };
      },
      // ImageNet-R (sculpture): a banana sculpted from sand, a bucket and a spade beside it
      sandcastle(g) {
        const mound = mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xe3c27a, { roughness: 1 }), 0, -0.02, 0, g); mound.scale.set(0.74, 0.16, 0.36);
        const b = banana(g, 1.2, 0.25, { color: 0xe9cf8f, tip: 0xc9a862, stem: 0xd4b670, rough: 1, bend: 1.2 });
        b.g.position.set(0, 0.05, 0);
        const lumpM = M(0xe0bf78, { roughness: 1 });
        for (let i = 0; i < 10; i++) {
          const u = 0.12 + (0.76 * i) / 9, P = b.curve.getPointAt(u), rr = b.radius(u);
          const nrm = b.center.clone().sub(P).normalize();
          const side = i % 2 ? 0.55 : -0.2;
          mesh(new THREE.SphereGeometry(0.045 + (i % 3) * 0.018, 8, 6), lumpM, P.x + nrm.x * rr * 0.75, P.y + nrm.y * rr * 0.75, rr * side + 0.02, b.g);
        }
        const groove = []; for (let i = 0; i <= 10; i++) { const u = 0.1 + 0.8 * (i / 10), P = b.curve.getPointAt(u), nrm = b.center.clone().sub(P).normalize(); groove.push(P.clone().addScaledVector(nrm, b.radius(u) * 0.62).add(new THREE.Vector3(0, 0, b.radius(u) * 0.74))); }
        mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(groove), 20, 0.014, 5), M(0xc9a862, { roughness: 1 }), 0, 0, 0, b.g);
        // a red toy bucket and a blue spade
        const bucket = group(g, 0.82, 0, 0.18);
        const red = M(0xe8566a, { roughness: 0.6, side: THREE.DoubleSide });
        mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.26, 16, 1, true), red, 0, 0.13, 0, bucket);
        mesh(new THREE.CircleGeometry(0.11, 16), red, 0, 0.004, 0, bucket).rotation.x = -Math.PI / 2;
        mesh(new THREE.TorusGeometry(0.15, 0.016, 6, 20), M(0xc8404f), 0, 0.26, 0, bucket).rotation.x = Math.PI / 2;
        mesh(new THREE.CircleGeometry(0.14, 16), M(0xe3c27a, { roughness: 1 }), 0, 0.22, 0, bucket).rotation.x = -Math.PI / 2;
        const handle = mesh(new THREE.TorusGeometry(0.15, 0.011, 6, 16, Math.PI), M(0xffd35a), 0, 0.26, 0, bucket); handle.rotation.y = 0.4;
        const spade = group(g, -0.74, 0, 0.36); spade.rotation.z = -0.32; spade.rotation.y = 0.35;
        const blue = M(0x4f86d8, { roughness: 0.6 });
        mesh(plate(0.17, 0.2, 0.03, 0.06), blue, 0, 0.08, 0, spade);
        mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6), blue, 0, 0.36, 0, spade);
        mesh(plate(0.13, 0.04, 0.04, 0.015), blue, 0, 0.55, 0, spade);
        return { flag: [1.16, 0, 0.05] };
      },
      // ObjectNet (odd place, odd pose): a banana planted upside down in a teacup on the well's rim
      teacup(g) {
        const china = M(0xfffdf6, { roughness: 0.35, side: THREE.DoubleSide });
        const prof = [[0, 0], [0.085, 0], [0.1, 0.015], [0.14, 0.08], [0.168, 0.17], [0.178, 0.24], [0.168, 0.245], [0.157, 0.18], [0.128, 0.09], [0.09, 0.035], [0, 0.03]];
        mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28), china, 0, 0, 0, g);
        mesh(new THREE.TorusGeometry(0.174, 0.016, 8, 28), M(0xff7ab8, { roughness: 0.4 }), 0, 0.243, 0, g).rotation.x = Math.PI / 2;
        const handle = mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 14, Math.PI * 1.3), china, 0.19, 0.13, 0, g); handle.rotation.z = -Math.PI * 0.65;
        mesh(new THREE.CircleGeometry(0.15, 20), M(0x6a4a2a, { roughness: 1 }), 0, 0.2, 0, g).rotation.x = -Math.PI / 2; // soil
        const plant = group(g, 0, 0, 0); plant.rotation.z = 0.12;
        const b = banana(plant, 0.66, 0.085, { bend: 1.0 });
        b.g.rotation.z = -Math.PI / 2; b.g.position.set(-0.11, 0.39, 0);
        return { flag: [0.3, 0, 0], scale: 1.3 };
      },
      // ImageNet-A (a real banana photo that trips the Snapper): a banana half hidden in leaves, a ladybird on it
      ladybird(g) {
        const lg = leafGeo(0.85, 0.3);
        const greens = [0x2f9a4a, 0x3fb05a, 0x37a052, 0x2a8a44, 0x46b862].map((c) => M(c, { side: THREE.DoubleSide }));
        const rib = M(0x23743a);
        const ribG = new THREE.BoxGeometry(0.72, 0.016, 0.012);
        const leaf = (ang, z, tilt, s, k, x = 0) => {
          const piv = group(g, x, 0.02, z); piv.rotation.x = tilt;
          const lf = mesh(lg, greens[k], 0, 0, 0, piv); lf.rotation.z = ang; lf.scale.setScalar(s);
          mesh(ribG, rib, 0.4, 0, 0.008, lf);
        };
        leaf(0.95, -0.16, -0.22, 1.0, 0); leaf(1.57, -0.2, -0.16, 1.06, 1); leaf(2.2, -0.16, -0.22, 1.0, 2);
        const b = banana(g, 0.66, 0.085, { bend: 1.1 });
        b.g.position.set(0.02, 0.04, 0.06); b.g.rotation.y = 0.14;
        leaf(0.42, 0.24, 0.55, 0.74, 3, 0.17); leaf(2.72, 0.24, 0.55, 0.74, 4, -0.13);
        // the ladybird, sitting on the banana's back
        const lb = group(b.g, 0.04, 0.165, 0.035); lb.rotation.x = 0.55;
        const black = M(0x1e1824, { roughness: 0.5 });
        mesh(new THREE.SphereGeometry(0.075, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xe8343a, { roughness: 0.35 }), 0, 0, 0, lb).scale.set(1, 0.75, 1.15);
        mesh(new THREE.SphereGeometry(0.036, 10, 8), black, 0, 0.012, 0.085, lb);
        for (const sx of [-0.013, 0.013]) mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), sx, 0.03, 0.112, lb);
        for (const [x, z] of [[-0.035, -0.035], [0.035, -0.035], [-0.033, 0.03], [0.033, 0.03], [0, -0.07]]) mesh(new THREE.SphereGeometry(0.015, 8, 6), black, x, Math.sqrt(Math.max(0, 1 - (x / 0.075) ** 2 - (z / 0.086) ** 2)) * 0.056, z, lb);
        mesh(new THREE.BoxGeometry(0.005, 0.004, 0.16), black, 0, 0.056, 0, lb);
        loops.push((dt, t) => { lb.rotation.y = Math.sin(t * 0.8) * 0.35; });
        return { flag: [0.78, 0, 0.1] };
      },
      // In distribution (ImageNet itself): Brine's catalogue crate with a plain bunch of bananas
      crate(g) {
        const wood = M(0xc8956a), dark = M(0x9a6a40);
        const W = 0.8, H = 0.5, D = 0.5;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(0.07, H, 0.07), dark, sx * (W / 2 - 0.035), H / 2, sz * (D / 2 - 0.035), g);
        for (const yy of [0.09, 0.25, 0.41]) {
          for (const sz of [-1, 1]) mesh(new THREE.BoxGeometry(W - 0.04, 0.11, 0.03), wood, 0, yy, sz * (D / 2 - 0.015), g);
          for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.03, 0.11, D - 0.04), wood, sx * (W / 2 - 0.015), yy, 0, g);
        }
        mesh(new THREE.BoxGeometry(W - 0.06, 0.4, D - 0.06), M(0xe9d48a, { roughness: 1 }), 0, 0.26, 0, g); // straw
        const bunch = group(g, 0.03, H - 0.06, 0);
        for (let k = 0; k < 5; k++) {
          const b = banana(bunch, 0.6, 0.075, { bend: 1.2 });
          b.g.position.set(0, (2 - Math.abs(k - 2)) * 0.035, (k - 2) * 0.085);
          b.g.rotation.set((k - 2) * 0.1, (k - 2) * -0.25, 0);
        }
        mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.12, 8), M(0x7a6a30), -0.36, 0.23, 0, bunch).rotation.z = 0.9;
        mesh(new THREE.PlaneGeometry(0.3, 0.15), M(0xffffff, { map: canvasTex(128, 64, drawTag), roughness: 0.9, side: THREE.DoubleSide }), 0.15, 0.27, D / 2 + 0.012, g).rotation.z = -0.08;
        mesh(new THREE.SphereGeometry(0.016, 6, 6), M(0x5a5a62), 0.03, 0.28, D / 2 + 0.02, g);
        return { flag: [0.66, 0, 0] };
      },
      // look-alike: a yellow boomerang leaning on a little rock
      boomerang(g) {
        const rock = mesh(new THREE.DodecahedronGeometry(0.21, 0), M(0xa7a29a, { flatShading: true }), 0.02, 0.12, -0.2, g); rock.scale.set(1.3, 0.7, 1);
        const bm = group(g, 0, 0, 0); bm.rotation.x = -0.32;
        const yel = M(0xf2c84a, { roughness: 0.7 }), band = M(0x8a5a36);
        const L = 0.62, elbow = new THREE.Vector3(0, 0.48, 0);
        for (const s of [-1, 1]) {
          const dir = new THREE.Vector3(s * Math.sin((50 * Math.PI) / 180), -Math.cos((50 * Math.PI) / 180), 0);
          const ang = Math.atan2(dir.y, dir.x);
          const arm = mesh(plate(L, 0.17, 0.05, 0.085, 0.012), yel, 0, 0, 0, bm); arm.position.copy(elbow).addScaledVector(dir, L / 2 - 0.06); arm.rotation.z = ang;
          for (const f of [0.34, 0.66]) { const st = mesh(new THREE.BoxGeometry(0.04, 0.18, 0.062), band, 0, 0, 0, bm); st.position.copy(elbow).addScaledVector(dir, L * f - 0.06); st.rotation.z = ang; }
        }
        mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 18), yel, 0, 0.48, 0, bm).rotation.x = Math.PI / 2;
        return { flag: [0.68, 0, 0.1] };
      },
      // look-alike: a sleepy crescent-moon cut-out on a stake, a paper star dangling from its tip
      moon(g) {
        mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.25, 8), M(0x8a5a36), 0, 0.625, 0, g);
        const mg = group(g, 0.12, 1.62, 0.04); mg.rotation.z = -0.25;
        const R1 = 0.45, R2 = 0.37, d = 0.2;
        const ix = (d * d + R1 * R1 - R2 * R2) / (2 * d), iy = Math.sqrt(R1 * R1 - ix * ix);
        const a1 = Math.atan2(iy, ix), b1 = Math.atan2(iy, ix - d);
        const s = new THREE.Shape(); s.absarc(0, 0, R1, a1, Math.PI * 2 - a1, false); s.absarc(d, 0, R2, -b1, b1, true);
        const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 28 });
        mesh(geo, M(0xffd84a, { roughness: 0.6, emissive: 0x3a2a00 }), 0, 0, -0.025, mg);
        const ink = M(0x2b2233, { roughness: 0.6 });
        const eye = mesh(new THREE.TorusGeometry(0.042, 0.011, 6, 12, Math.PI), ink, -0.29, 0.07, 0.05, mg); eye.rotation.z = Math.PI;
        const mouth = mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 12, Math.PI), ink, -0.25, -0.11, 0.05, mg); mouth.rotation.z = Math.PI;
        mesh(new THREE.CircleGeometry(0.035, 14), new THREE.MeshBasicMaterial({ color: 0xff9ab8, transparent: true, opacity: 0.8 }), -0.34, -0.03, 0.052, mg);
        // the paper star on a thread, hung from the upper horn
        const hx = ix - 0.03, hy = iy - 0.04, c = Math.cos(-0.25), sn = Math.sin(-0.25);
        const piv = group(g, 0.12 + hx * c - hy * sn, 1.62 + hx * sn + hy * c, 0.06);
        mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), M(0xfffdf6), 0, -0.15, 0, piv);
        const star = new THREE.Shape();
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.04 : 0.095; i ? star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        mesh(new THREE.ExtrudeGeometry(star, { depth: 0.015, bevelEnabled: false }), M(0xfff6c8, { roughness: 0.9 }), 0, -0.38, -0.008, piv);
        loops.push((dt, t) => { piv.rotation.z = Math.sin(t * 1.4) * 0.22; });
        return { flag: [0.66, 0, 0.12] };
      },
      // look-alike: a small yellow canoe on the sand, a paddle across it
      canoe(g) {
        const yel = M(0xffd23f, { roughness: 0.6, side: THREE.DoubleSide });
        const L = 0.8, Dp = 0.3, Wd = 0.27, up = 0.2, hy = 0.27;
        const hull = new THREE.SphereGeometry(1, 36, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        const pa = hull.attributes.position;
        for (let i = 0; i < pa.count; i++) { const x = pa.getX(i) * L; pa.setXYZ(i, x, pa.getY(i) * Dp + up * (x / L) ** 4, pa.getZ(i) * Wd); }
        hull.computeVertexNormals();
        mesh(hull, yel, 0, hy, 0, g);
        const rim = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, x = Math.cos(a) * L; rim.push(new THREE.Vector3(x, up * (x / L) ** 4, Math.sin(a) * Wd)); }
        mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 72, 0.03, 6, true), M(0xc8902a), 0, hy, 0, g);
        for (const sx of [-0.3, 0.32]) mesh(new THREE.BoxGeometry(0.1, 0.03, 0.48), M(0xb9824a), sx, hy - 0.03, 0, g);
        const pad = group(g, 0.04, hy + 0.06, 0.04); pad.rotation.y = 0.55;
        const pw = M(0xa8763e);
        mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 6), pw, 0, 0, 0, pad).rotation.z = Math.PI / 2;
        mesh(plate(0.3, 0.13, 0.025, 0.06), pw, 0.6, 0, 0, pad).rotation.x = Math.PI / 2;
        mesh(plate(0.1, 0.05, 0.05, 0.02), pw, -0.5, 0, 0, pad);
        return { flag: [1.14, 0, 0.05] };
      },
    };
    const fallback = (g) => { banana(g, 0.7, 0.09); return { flag: [0.6, 0, 0] }; };

    // ---------- flags: a pin with a paper pennant, ✓ (counts) or ✗ (wasted film) ----------
    const F = {
      stick: new THREE.CylinderGeometry(0.018, 0.018, 1.2, 6), head: new THREE.SphereGeometry(0.05, 10, 8), pen: new THREE.PlaneGeometry(0.44, 0.3),
      pin: M(0xc9c9d2, { roughness: 0.4, metalness: 0.3 }),
    };
    for (const good of [true, false]) {
      F[good ? 'headG' : 'headB'] = M(good ? 0x7bcd5d : 0x9a9aa6);
      const t = canvasTex(160, 110, drawFlag(good));
      F[good ? 'penG' : 'penB'] = M(0xffffff, { map: t, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.5 });
    }
    Object.values(F).forEach((x) => { shared.add(x); if (x.map) shared.add(x.map); });
    function putFlag(rec, good) {
      const f = new THREE.Group();
      const [fx, fy, fz] = rec.flagAt;
      f.position.set(fx, fy, fz);
      mesh(F.stick, F.pin, 0, 0.6, 0, f).castShadow = true;
      mesh(F.head, good ? F.headG : F.headB, 0, 1.22, 0, f).castShadow = true;
      const pg = group(f, 0, 1.0, 0);
      mesh(F.pen, good ? F.penG : F.penB, 0.23, 0, 0, pg);
      const ph = rec.index * 1.3;
      f.userData.wave = (dt, t) => { pg.rotation.y = Math.sin(t * 3 + ph) * 0.2; };
      loops.push(f.userData.wave);
      rec.flagParent.add(f); rec.flag = f;
      const fs = rec.flagParent === rec.g ? 1 / rec.base : 1; // same flag size on every prop
      f.scale.setScalar(0.001);
      tween(0.35, (u) => f.scale.setScalar(Math.max(0.001, fs * easeBack(u))));
    }
    function removeFlag(rec) {
      if (!rec.flag) return;
      const f = rec.flag; rec.flag = null;
      const i = loops.indexOf(f.userData.wave); if (i >= 0) loops.splice(i, 1);
      f.parent?.remove(f); // its parts are shared (disposed on destroy)
    }

    // ---------- tweens and idle animation ----------
    function tween(dur, fn, delay = 0) { const tw = { t: -delay, dur, fn }; tweens.add(tw); return tw; }
    const unsub = w.onUpdate((dt, t) => {
      for (const tw of [...tweens]) { tw.t += dt; if (tw.t < 0) continue; const u = Math.min(1, tw.t / tw.dur); tw.fn(u); if (u >= 1) tweens.delete(tw); }
      for (const fn of loops) fn(dt, t);
    });

    // ---------- build every prop, its collider and its '📷 Snap' interactable ----------
    const recs = (spec.props || []).map((p, index) => {
      const at = p.at || [0, 0, 0];
      const g = group(root, at[0], at[1], at[2]);
      g.rotation.y = p.ry || 0;
      const built = (BUILD[p.id] || fallback)(g) || {};
      g.traverse((o) => { if (o.isMesh && !o.material?.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; } });
      let col = null;
      if (typeof p.collider === 'number' && p.collider > 0) col = w.addCollider({ type: 'circle', x: at[0], z: at[2], r: p.collider });
      else if (p.collider && typeof p.collider === 'object') {
        const hw = (p.collider.w ?? 1) / 2, hd = (p.collider.d ?? 1) / 2;
        col = w.addCollider({ type: 'rect', x0: at[0] - hw, x1: at[0] + hw, z0: at[2] - hd, z1: at[2] + hd });
      }
      const ip = p.interact?.pos || at;
      const base = p.scale ?? built.scale ?? 1;
      const rec = { p, index, g, base, col, flag: null, snapped: false, flagAt: built.flag || [0.6, 0, 0], flagParent: built.flagParent || g };
      rec.it = w.addInteractable({
        id: p.id, label: ia.label || 'Snap', icon: ia.icon ?? '📷',
        pos: { x: ip[0], y: ip[1], z: ip[2] },
        radius: p.interact?.radius ?? ia.radius ?? 1.8,
        promptHeight: p.interact?.promptHeight ?? ia.promptHeight ?? 1.8,
        onInteract: () => snap(rec),
      });
      // pop up around the island as the bet starts
      g.scale.setScalar(0.001);
      tween(0.45, (u) => g.scale.setScalar(Math.max(0.001, base * easeBack(u))), 0.15 + index * 0.07);
      return rec;
    });

    // ---------- the camera flash ----------
    let flashEl = null;
    function flash() {
      flashEl?.remove();
      const el = document.createElement('div');
      el.className = 'etl-passive bb-flash';
      Object.assign(el.style, { position: 'fixed', inset: '0', background: '#fff', opacity: '0.9', pointerEvents: 'none', zIndex: '45' });
      document.getElementById('ui-root')?.appendChild(el);
      flashEl = el;
      const gone = () => { el.remove(); if (flashEl === el) flashEl = null; };
      try { el.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' }).onfinish = gone; } catch { /* no WAAPI */ }
      setTimeout(gone, 450);
    }

    const progress = () => api.onProgress?.(fill(spec.progress || '🍌 {n}/{need} · 🎞️ {film}', { n, film, need }));
    const verdict = (p) => fill(spec.verdict || 'Snapper: “{snapper}” {mark} · Lens: “{lens}” ✓', { snapper: p.snapper, lens: p.lens, mark: p.snapperRight ? '✓' : '✗' });

    async function snap(rec) {
      if (destroyed || solved || rec.snapped || film <= 0) return;
      rec.snapped = true; rec.it.enabled = false;
      film -= 1;
      flash(); w.sfx('pop');
      // the prop flinches at the flash
      tween(0.4, (u) => { const k = Math.sin(u * Math.PI) * (1 - u), b = rec.base; rec.g.scale.set(b * (1 - 0.1 * k), b * (1 + 0.18 * k), b * (1 - 0.1 * k)); });
      await wait(330);
      if (destroyed) return;
      const counts = !!rec.p.counts;
      if (counts) { n += 1; w.sfx('ding'); w.confetti(30); } else w.sfx('buzz');
      putFlag(rec, counts);
      progress();
      await w.speak(giver, [verdict(rec.p), rec.p.react].filter(Boolean));
      if (destroyed) return;
      if (n >= need) { solved = true; api.onSolved(); return; }
      if (film <= 0) {
        await w.speak(giver, spec.filmOut || ['Out of film! We start again.']);
        if (destroyed) return;
        n = 0; film = FILM;
        for (const r of recs) { removeFlag(r); r.snapped = false; r.it.enabled = true; }
        w.sfx('paper');
        progress();
      }
    }

    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsub?.();
        tweens.clear(); loops.length = 0;
        for (const r of recs) { w.removeInteractable(r.it); if (r.col) w.removeCollider(r.col); removeFlag(r); }
        flashEl?.remove(); flashEl = null;
        w.scene.remove(root);
        const geos = new Set(), mats = new Set(), texs = new Set(shared);
        root.traverse((o) => {
          if (o.geometry) geos.add(o.geometry);
          for (const m of [o.material].flat()) if (m) { mats.add(m); if (m.map) texs.add(m.map); }
        });
        for (const x of [...geos, ...mats, ...texs]) { try { x.dispose?.(); } catch { /* already gone */ } }
      },
    };
  },
};
