// Toy-style geometry helpers shared by character builders (copied from humans.js so other
// builders, like the scientist, can use them without depending on humans.js internals).
//   ellipsoid(ax, ay, az): place features on a head (F.at, F.normal, F.put)
//   shellGeo / curtainGeo: hair caps and hanging hair; revolveGeo + profile: torsos and sleeves
//   taperTubeGeo: tapered tubes along a curve (locks, beard strands); materials(): cached materials
import * as THREE from 'three';

export const PI = Math.PI;
export const TAU = PI * 2;
export const DS = THREE.DoubleSide;
export const UP = new THREE.Vector3(0, 1, 0);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// sRGB hex colour maths (perceptual enough for shading and accents)
export const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const hex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(...A.map((v, i) => v + (B[i] - v) * t)); };
export const shade = (h, k) => mix(h, k < 0 ? '#000000' : '#ffffff', Math.abs(k));
export const cdist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let s = (seed % 2147483647) || 11;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// piecewise smooth curve through [x, y] pairs (x ascending), flat at the ends
export function curve(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const t = (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * t * t * (3 - 2 * t);
      }
    }
    return pts[pts.length - 1][1];
  };
}
// a hairline: polar angle (in units of pi) as a function of |azimuth|, plus an optional extra term
export const hairline = (pts, extra) => { const c = curve(pts); return (phi) => (c(Math.abs(phi)) + (extra ? extra(phi) : 0)) * PI; };

// per-model material cache
export function materials() {
  const std = new Map(), basic = new Map();
  return {
    std(color, { r = 0.85, side = THREE.FrontSide, flat = false } = {}) {
      const k = `${color}|${r}|${side}|${flat}`;
      if (!std.has(k)) std.set(k, new THREE.MeshStandardMaterial({ color, roughness: r, metalness: 0, side, flatShading: flat }));
      return std.get(k);
    },
    basic(color, opacity = 1) {
      const k = `${color}|${opacity}`;
      if (!basic.has(k)) {
        const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
        if (opacity < 1) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
        basic.set(k, m);
      }
      return basic.get(k);
    },
  };
}

export function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// point a +y-oriented mesh (cone, capsule) along a direction
export function aim(mesh, dir) { mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize()); return mesh; }

// An ellipsoid "frame" (semi-axes ax, ay, az) used to place things on a head.
//   phi: azimuth, 0 = front (+z), +pi/2 = +x.  th: polar angle, 0 = top, pi = bottom.
export function ellipsoid(ax, ay, az) {
  return {
    ax, ay, az,
    at(phi, th, k = 1) { const s = Math.sin(th); return new THREE.Vector3(ax * k * s * Math.sin(phi), ay * k * Math.cos(th), az * k * s * Math.cos(phi)); },
    normal(phi, th) { const s = Math.sin(th); return new THREE.Vector3((s * Math.sin(phi)) / ax, Math.cos(th) / ay, (s * Math.cos(phi)) / az).normalize(); },
    z(x, y) { return az * Math.sqrt(Math.max(0, 1 - (x / ax) ** 2 - (y / ay) ** 2)); },
    // put a flat (+z facing) feature on the front surface at (x, y), pushed out by `out`, rolled by `roll`
    put(mesh, x, y, out = 0, roll = 0) {
      const z = this.z(x, y);
      const n = new THREE.Vector3(x / (ax * ax), y / (ay * ay), z / (az * az)).normalize();
      mesh.position.set(x + n.x * out, y + n.y * out, z + n.z * out);
      mesh.rotation.set(-Math.asin(n.y), Math.atan2(n.x, n.z), roll, 'YXZ');
      return mesh;
    },
    scaled(k) { return ellipsoid(ax * k, ay * k, az * k); },
  };
}

// A patch of an (inflated) ellipsoid between a top and a bottom polar angle that may vary with azimuth,
// with a rim folding back inside the head so the shell reads as having thickness. Analytic normals.
export function shellGeo(F, { phi0 = -PI, phi1 = PI, top = 0, bottom, k = 1.06, segU = 64, segV = 14, rim = 0.95 }) {
  const topF = typeof top === 'function' ? top : () => top;
  const botF = typeof bottom === 'function' ? bottom : () => bottom;
  const kF = typeof k === 'function' ? k : () => k;
  const pos = [], nor = [], idx = [];
  const push = (phi, th, kk) => { const p = F.at(phi, th, kk), n = F.normal(phi, th); pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); };
  for (let i = 0; i <= segU; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segU;
    const t0 = topF(phi), t1 = botF(phi);
    for (let j = 0; j <= segV; j++) { const th = t0 + ((t1 - t0) * j) / segV; push(phi, th, kF(phi, th)); }
  }
  const R = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) { const a = i * R + j, b = a + R; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  if (rim) {
    const base = pos.length / 3;
    for (let i = 0; i <= segU; i++) {
      const phi = phi0 + ((phi1 - phi0) * i) / segU, th = botF(phi);
      push(phi, th, kF(phi, th)); push(phi, th, rim);
    }
    for (let i = 0; i < segU; i++) { const a = base + i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// Smooth 2D profile [[r, y], ...] -> sampled Vector2 list
export const profile = (pts, n = 24) => new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(n);

// Surface of revolution of a profile (Vector2 r,y), squashed in z by sz, optionally open at the
// front by gap(y) radians (lab coat, V-neck). Analytic normals, so no seams.
export function revolveGeo(pts, { seg = 40, sz = 1, gap = null } = {}) {
  const pos = [], nor = [], idx = [];
  const n = pts.length;
  for (let j = 0; j < n; j++) {
    const p = pts[j], a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
    const dr = b.x - a.x, dy = b.y - a.y;
    const g = gap ? clamp(gap(p.y), 0, TAU - 0.01) : 0;
    for (let i = 0; i <= seg; i++) {
      const phi = g / 2 + ((TAU - g) * i) / seg;
      const s = Math.sin(phi), c = Math.cos(phi);
      pos.push(p.x * s, p.y, p.x * c * sz);
      const nx = sz * dy * s, ny = -sz * dr, nz = dy * c, L = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / L, ny / L, nz / L);
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// hanging "curtain" of hair below a head ellipse (long hair), over the azimuths [phi0, phi1]
export function curtainGeo(F, { phi0, phi1, yTop, yBot, k0 = 1.07, k1 = 1.13, segU = 48, segV = 8 }) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= segU; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segU;
    const s = Math.sin(phi), c = Math.cos(phi);
    const yb = typeof yBot === 'function' ? yBot(phi) : yBot;
    for (let j = 0; j <= segV; j++) {
      const t = j / segV, k = k0 + (k1 - k0) * t, y = yTop + (yb - yTop) * t;
      pos.push(F.ax * k * s, y, F.az * k * c);
      const nx = s / F.ax, nz = c / F.az, L = Math.hypot(nx, nz) || 1;
      nor.push(nx / L, -0.1, nz / L);
    }
  }
  const R = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) { const a = i * R + j, b = a + R; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// teardrop (ponytail, braid tuft) hanging down from its origin
export const teardropGeo = (len, rad) => new THREE.LatheGeometry(
  profile([[0, 0], [rad * 0.75, -len * 0.08], [rad, -len * 0.32], [rad * 0.8, -len * 0.62], [rad * 0.35, -len * 0.88], [0, -len]], 20), 20);

// a tube along a curve whose radius follows radius(u), u in [0,1] (ponytail, curls)
export function taperTubeGeo(curve, radius, segs = 24, radial = 12) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, P = curve.getPointAt(u), r = Math.max(0.0005, radius(u));
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// thin arm hugging an ellipsoid surface from azimuth phi0 to phi1 at polar angle th (glasses temples)
export function surfaceArc(F, phi0, phi1, th, k, radius) {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(F.at(phi0 + ((phi1 - phi0) * i) / 8, th, k));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, radius, 6);
}

export function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
export function roundRectGeo(w, h, r, depth) {
  const g = new THREE.ExtrudeGeometry(roundRectShape(w, h, r), { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
export function frameGeo(w, h, r, t, depth) {
  const s = roundRectShape(w, h, r);
  s.holes.push(roundRectShape(w - 2 * t, h - 2 * t, Math.max(0.002, r - t)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// accessory colour that does not vanish against the top or the hair

export function disposeModel(obj) {
  const mats = new Set();
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
  });
  mats.forEach((m) => m.dispose());
}

export function finishShadows(root) {
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
}
