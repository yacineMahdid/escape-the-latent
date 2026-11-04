// Parcel Day (Siftsand / Mamba, challenge e1): the region's finale, played on the road itself.
// Penny packs five parcels end to end in front of Noodle: Kayvee's, Tumble's, Doc Marrow's, Umberto's and
// her own. Each is a strip of wrapping paper with its grains and ends in its owner's bell post (a portrait
// card on top); a ribbon spot sits between two parcels. The dispatch bell sends Noodle (his real villager
// mesh) down the row: he gulps beads (his belly glows in their colour), lets sand and ums slide, and at every
// bell shouts what is in his belly. A ✓ / ✕ flag and the owner's reaction follow, then Penny names the
// mix-ups. Tumble's and Umberto's parcels hold no bead, so they hear the previous parcel's bead. At each
// ribbon the player may leave one of 2 clear marbles or a pinch of sand: sand changes nothing (Noodle keeps
// his belly across any amount of it), a marble is gulped like a bead and leaves the belly empty. The only
// win is marbles on R1 and R3 (every placement checked). Unlimited runs: the first plays at speed 1, later ones
// faster, and holding Space / E / Enter or the mouse button hurries any run. A camera shot frames the whole road
// for each run (and shows the row popping up at the start); Noodle and Tumble are held at home meanwhile.
// The paper (Mamba, Section 3.5.2, Boundary Resetting): sequences packed end to end (documents packed to use
// the hardware better) bleed into each other unless the selective state resets at the boundary (Δ_t → ∞, or
// g_t → 1 in Theorem 1). The clear marble is that boundary token: a big gulp that carries nothing. The sand
// shows that selection holds the state across ignored noise; Umberto's ums are Variable Spacing.
// Spec: content/extra/mamba.json, challenge e1 (positions, props, menu, run, camera, judging, text).
// Test hooks: interactables have it.id 'R1'..'R4' (label 'Ribbon') and 'dispatch' (label 'Dispatch bell');
// while mounted, window.__etl.parcelDay = { placed, marbles, running, runs, hurry, last, speed } (speed: a
// test-only extra time scale for the run, 1 by default). deliveries(spec, placed) is the judge, exported for checks.
import { api as game } from '../api.js';

const INK = '#2b2233';
const CREAM = '#fffdf6';
const GREY = '#7a7088';
const FONT = 'Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", Verdana, sans-serif';
const TAU = Math.PI * 2;
const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const easeBack = (u) => { const c = 1.9; const v = clamp01(u) - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
const easeOut = (u) => 1 - (1 - clamp01(u)) ** 3;
const easeInOut = (u) => { const v = clamp01(u); return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hexRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };

// the c1 bead colours; the cuts match the m1 drawings (round star, square frame, tall octagon)
const BEADS = {
  ruby: { color: '#e61f33', word: 'RUBY', cut: 'round' },
  lapis: { color: '#2659e6', word: 'LAPIS', cut: 'square' },
  emerald: { color: '#1abf59', word: 'EMERALD', cut: 'tall' },
};
const NUMBER = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' };
// the owners' looks if the region file cannot be read (as in content/regions/mamba.json)
const LOOKS = {
  kayvee: { species: 'mouse', colors: { fur: '#c7a27a', shirt: '#a05a8c' } },
  tumble: { species: 'bunny', colors: { fur: '#fff4f8', shirt: '#ff7ab8' } },
  marrow: { species: 'dog', colors: { fur: '#e9dcc6', shirt: '#8fd3ff' } },
  umberto: { species: 'duck', colors: { fur: '#8a6a4a', shirt: '#4f9a5a' } },
  penny: { species: 'bear', colors: { fur: '#d08a4a', shirt: '#c8453c' } },
};
// species defaults, as in engine/villagers.js
const SPECIES = {
  bear: { fur: '#e0ad7c', inner: '#c98a5a', muzzle: '#fbe6cc', nose: INK },
  bunny: { fur: '#fff4f8', inner: '#ffb3cf', nose: '#ff7ab8' },
  cat: { fur: '#b8b0d8', inner: '#ffb3cf', muzzle: '#efeaff', nose: '#ff8aa8' },
  frog: { fur: '#8fd86a', nose: INK },
  dog: { fur: '#d9a066', inner: '#8a5a36', muzzle: '#fff0dc', nose: INK },
  mouse: { fur: '#b9b9c6', inner: '#ffb3cf', nose: '#ff8aa8' },
  pig: { fur: '#ffb8c8', inner: '#ff8aa8', nose: '#ff8aa8' },
  duck: { fur: '#fff6e0', nose: '#ffa53a' },
  snake: { fur: '#7fcf6a', nose: INK },
};

// ---------- layout (world units; spec.row, spec.where) ----------
const POST_DX = 0.3;                     // a post stands at the right end of its parcel's strip: clear of the stage lantern at x -18
const POST_H = 0.95;
const CARD = { r: 0.3, y: 1.22 };        // the round portrait card: radius, centre height
const PLATE = { w: 0.84, h: 0.25, dy: -0.27 }; // the name plate across the card's lower edge (big enough to read in game)
const FLAG = { w: 0.48, h: 0.36, pin: 0.5 };   // big enough to read ✓ / ✕ from the camera
const BUBBLE_GAP = 0.5;                  // speech bubbles start this far above the card
const PXU = 220;                         // bubble canvas pixels per world unit
const STRIP_PAD = 0.36;                  // a strip reaches this far past its first and last slot
// Noodle's run (spec.noodle.path): glide to the start, slither right, linger, glide home. About 20 s.
// A slot is handled when he passes its x - early; he stops for a bell at its x - bell (the slot before a bell is
// always 0.82 earlier, so the order holds), which keeps his glowing belly clear of the owner's card while he shouts.
const RUN = { start: [-25.3, 1.45], z: 1.45, speed: 1.6, end: -7.2, toStart: 0.8, linger: 0.6, back: 1.8, stop: 0.9, judge: 0.35, early: 0.12, bell: 0.45, hop: 0.25 };
const FACE = { left: -0.75, right: 0.6, front: 0.3 }; // rotation.y while gliding left, slithering right, shouting
const STRETCH = 1.2;   // he stretches up to shout: his face then clears the stage lantern in front of Tumble's bell
const HEAD = { y: 1.98, top: 0.36 }; // the snake villager's head centre and half height (engine/villagers.js)
const PROP = 1.4;      // beads, ums, the clear marble and the pinch of sand: big enough to read from the game camera
const SLOT_SAND = 1.15;
// The run shot (spec.camera): the whole road for the screen's aspect, a little above it. FOV is the diorama
// camera's vertical field of view (game/walkscene.js).
const SHOT = { fov: 32, pitch: 11, lookY: 1.45, lookDz: -0.3, margin: 0.5, fly: 900, back: 900, reveal: 1.6 };
const HURRY_KEYS = new Set(['Space', 'KeyE', 'Enter']);

function rr(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + q, y); g.lineTo(x + w - q, y); g.quadraticCurveTo(x + w, y, x + w, y + q);
  g.lineTo(x + w, y + h - q); g.quadraticCurveTo(x + w, y + h, x + w - q, y + h); g.lineTo(x + q, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - q); g.lineTo(x, y + q); g.quadraticCurveTo(x, y, x + q, y); g.closePath();
}
// the biggest bold font size <= max that fits text into width
function fitFont(g, text, width, max, min = 10) {
  let s = max;
  for (; s > min; s -= 2) { g.font = `700 ${s}px ${FONT}`; if (g.measureText(text).width <= width) break; }
  g.font = `700 ${s}px ${FONT}`;
  return s;
}
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// ---------- painters (canvas textures) ----------
function paintWrap(g, W, H) { // kraft wrapping paper: fibres, two fold lines, darker along both long edges
  g.fillStyle = '#b8834a'; g.fillRect(0, 0, W, H);
  const rnd = seeded(5);
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = rnd() < 0.5 ? 'rgba(90,55,20,.22)' : 'rgba(255,230,190,.2)'; g.lineWidth = 1.5;
    const x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 + rnd() * 22, y + (rnd() - 0.5) * 3); g.stroke();
  }
  g.fillStyle = 'rgba(255,225,180,.22)'; g.fillRect(0, H * 0.3, W, 2); g.fillRect(0, H * 0.7, W, 2);
  g.fillStyle = 'rgba(80,45,15,.35)'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6);
}
function paintSand(g, W, H) {
  g.fillStyle = '#d9b87a'; g.fillRect(0, 0, W, H);
  const rnd = seeded(9);
  g.fillStyle = '#ecd6a4'; for (let i = 0; i < 50; i++) g.fillRect(rnd() * W, rnd() * H, 2, 2);
  g.fillStyle = '#a8834c'; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(rnd() * W, rnd() * H * 0.8, 2.4, 0, TAU); g.fill(); }
}
function paintUm(g, W, H) { // 128 x 104: one of Umberto's fillers, a little paper speech bubble
  g.clearRect(0, 0, W, H); g.lineJoin = 'round';
  rr(g, 6, 6, W - 12, 70, 32); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.moveTo(30, 72); g.lineTo(20, 98); g.lineTo(54, 72); g.fill();
  g.beginPath(); g.moveTo(30, 75); g.lineTo(20, 98); g.lineTo(54, 75); g.stroke();
  g.fillStyle = '#8f879b'; g.font = `700 46px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('um', W / 2, 40);
}
function paintSpot(g, W, H) { // the faint dashed circle that marks a ribbon spot
  g.clearRect(0, 0, W, H); g.setLineDash([17, 12]); g.lineWidth = 9; g.strokeStyle = 'rgba(255,255,255,.9)';
  g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 8, 0, TAU); g.stroke(); g.setLineDash([]);
}
function paintRing(g, W, H) { // the marble's ink outline (a camera-facing ring), with a faint inner shine
  g.clearRect(0, 0, W, H);
  g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 5, 0, TAU); g.fillStyle = 'rgba(200,235,255,.18)'; g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(43,34,51,.8)'; g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 13, Math.PI * 1.05, Math.PI * 1.45); g.lineWidth = 5; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
}
function paintHalo(g, W, H) {
  const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.clearRect(0, 0, W, H); g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
function paintFlag(good) { // 128 x 96: a pennant, the pin on its left edge, ✓ green or ✕ red
  return (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.moveTo(5, 6); g.lineTo(W - 6, 6); g.lineTo(W - 30, H / 2); g.lineTo(W - 6, H - 6); g.lineTo(5, H - 6); g.closePath();
    g.fillStyle = good ? '#7bcd5d' : '#e8566a'; g.fill(); g.lineWidth = 6; g.lineJoin = 'round'; g.strokeStyle = INK; g.stroke();
    g.lineCap = 'round';
    const mark = () => { g.beginPath(); if (good) { g.moveTo(26, 50); g.lineTo(44, 68); g.lineTo(76, 28); } else { g.moveTo(30, 28); g.lineTo(70, 68); g.moveTo(70, 28); g.lineTo(30, 68); } };
    mark(); g.strokeStyle = INK; g.lineWidth = 20; g.stroke();
    mark(); g.strokeStyle = '#ffffff'; g.lineWidth = 11; g.stroke();
  };
}
// An Animal Crossing-ish face, centre (x, y), head radius r.
function paintFace(g, L, x, y, r) {
  const ink = (lw = 5) => { g.lineWidth = lw; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); };
  const oval = (px, py, rx, ry, col, rot = 0, lw = 0) => { g.beginPath(); g.ellipse(px, py, rx, ry, rot, 0, TAU); g.fillStyle = col; g.fill(); if (lw) ink(lw); };
  const sp = L.species;
  if (sp === 'bear') for (const s of [-1, 1]) { oval(x + s * r * 0.74, y - r * 0.7, r * 0.34, r * 0.34, L.fur, 0, 5); oval(x + s * r * 0.74, y - r * 0.7, r * 0.18, r * 0.18, L.inner); }
  if (sp === 'mouse') for (const s of [-1, 1]) { oval(x + s * r * 0.86, y - r * 0.64, r * 0.52, r * 0.5, L.fur, 0, 5); oval(x + s * r * 0.86, y - r * 0.64, r * 0.33, r * 0.31, L.inner); }
  if (sp === 'bunny') for (const s of [-1, 1]) { oval(x + s * r * 0.36, y - r * 1.18, r * 0.22, r * 0.66, L.fur, s * 0.14, 5); oval(x + s * r * 0.36, y - r * 1.14, r * 0.11, r * 0.48, L.inner, s * 0.14); }
  if (sp === 'cat') for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x + s * r * 0.3, y - r * 0.8); g.lineTo(x + s * r * 0.85, y - r * 1.15); g.lineTo(x + s * r * 0.92, y - r * 0.45); g.closePath(); g.fillStyle = L.fur; g.fill(); ink(5); }
  if (sp === 'frog') for (const s of [-1, 1]) oval(x + s * r * 0.45, y - r * 0.78, r * 0.3, r * 0.3, L.fur, 0, 5);
  oval(x, y, r * 1.06, r * 0.96, L.fur, 0, 6);
  if (sp === 'dog') for (const s of [-1, 1]) oval(x + s * r * 0.98, y + r * 0.08, r * 0.25, r * 0.52, L.inner, s * 0.3, 5);
  if (sp === 'duck') {
    g.beginPath(); g.moveTo(x - r * 0.14, y - r * 0.9); g.quadraticCurveTo(x - r * 0.06, y - r * 1.36, x + r * 0.3, y - r * 1.3);
    g.quadraticCurveTo(x + r * 0.06, y - r * 1.12, x + r * 0.16, y - r * 0.92); g.closePath(); g.fillStyle = L.fur; g.fill(); ink(4);
  }
  for (const s of [-1, 1]) {
    oval(x + s * r * 0.4, y + r * 0.02, r * 0.11, r * 0.15, INK);
    oval(x + s * r * 0.4 + r * 0.04, y - r * 0.05, r * 0.04, r * 0.04, '#ffffff');
    oval(x + s * r * 0.67, y + r * 0.34, r * 0.15, r * 0.09, 'rgba(255,138,168,.6)');
  }
  if (sp === 'duck') {
    oval(x, y + r * 0.42, r * 0.46, r * 0.21, '#ffa53a', 0, 4);
    g.beginPath(); g.moveTo(x - r * 0.33, y + r * 0.44); g.lineTo(x + r * 0.33, y + r * 0.44); ink(3);
    return;
  }
  if (L.muzzle) oval(x, y + r * 0.42, r * 0.38, r * 0.27, L.muzzle);
  oval(x, y + r * 0.3, r * 0.12, r * 0.085, L.nose);
  g.beginPath(); g.moveTo(x - r * 0.14, y + r * 0.5); g.quadraticCurveTo(x - r * 0.07, y + r * 0.6, x, y + r * 0.5);
  g.quadraticCurveTo(x + r * 0.07, y + r * 0.6, x + r * 0.14, y + r * 0.5); ink(4);
  if (sp === 'mouse' || sp === 'cat') for (const s of [-1, 1]) for (const k of [-1, 1]) { g.beginPath(); g.moveTo(x + s * r * 0.24, y + r * (0.36 + k * 0.05)); g.lineTo(x + s * r * 0.64, y + r * (0.32 + k * 0.13)); ink(2.5); }
}
function paintPortrait(look) { // the round card: a tinted disc, shoulders in the owner's shirt colour, the face
  return (g, W, H) => {
    const cx = W / 2, cy = H / 2, R = W / 2 - 4;
    g.clearRect(0, 0, W, H);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.fillStyle = mixHex(look.shirt, CREAM, 0.72); g.fillRect(0, 0, W, H);
    g.beginPath(); g.ellipse(cx, H * 1.0, W * 0.4, H * 0.25, 0, 0, TAU); g.fillStyle = look.shirt; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
    paintFace(g, look, cx, H * 0.47, W * 0.25);
    g.restore();
    g.beginPath(); g.arc(cx, cy, R - 4, 0, TAU); g.lineWidth = 9; g.strokeStyle = INK; g.stroke();
  };
}
function paintPlate(name) {
  return (g, W, H) => {
    g.clearRect(0, 0, W, H);
    rr(g, 5, 5, W - 10, H - 10, 24); g.fillStyle = CREAM; g.fill(); g.lineWidth = 7; g.strokeStyle = INK; g.stroke();
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, name, W - 46, Math.round(H * 0.64));
    g.fillText(name, W / 2, H / 2 + 3);
  };
}
// A speech bubble; tail 'left' / 'right' points down-left / down-right from that end of the bubble,
// 'down' points straight down from its middle.
// Returns the canvas and where the tail's tip sits ([0..1] from the left, [0..1] from the bottom).
function paintBubble(lines, { color = INK, outline = false, tail = 'down', size = 44 } = {}) {
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = `700 ${size}px ${FONT}`;
  const lh = Math.round(size * 1.12), padX = Math.round(size * 0.58), padY = Math.round(size * 0.3), tailH = Math.round(size * 0.62), m = 6;
  const tw = Math.max(...lines.map((l) => g.measureText(l).width));
  const bw = Math.ceil(tw + 2 * padX), bh = Math.ceil(lines.length * lh + 2 * padY);
  c.width = bw + 2 * m; c.height = bh + tailH + 2 * m;
  g = c.getContext('2d');
  const end = Math.min(bw * 0.24, 64), half = size * 0.3, bot = m + bh;
  const base = tail === 'left' ? m + end : tail === 'right' ? m + bw - end : m + bw / 2;
  const tipX = tail === 'left' ? base - size * 0.5 : tail === 'right' ? base + size * 0.5 : base, tipY = bot + tailH;
  g.lineJoin = 'round'; g.lineCap = 'round';
  rr(g, m, m, bw, bh, Math.min(size * 0.62, bh / 2)); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.moveTo(base - half, bot - 4); g.lineTo(tipX, tipY); g.lineTo(base + half, bot - 4); g.fillStyle = '#ffffff'; g.fill();
  g.beginPath(); g.moveTo(base - half, bot + 1); g.lineTo(tipX, tipY); g.lineTo(base + half, bot + 1); g.stroke();
  g.font = `700 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = m + padY + lh * (i + 0.5) + size * 0.05;
    if (outline) { g.lineWidth = 5; g.strokeStyle = INK; g.strokeText(l, m + bw / 2, y); }
    g.fillStyle = color; g.fillText(l, m + bw / 2, y);
  });
  return { canvas: c, tip: [tipX / c.width, 1 - tipY / c.height] };
}
// one or two lines: the split (at a space) with the shortest longest line, preferring a sentence break
function wrap2(text, max = 15) {
  const t = String(text);
  if (t.length <= max) return [t];
  const ws = t.split(' ');
  let best = null;
  for (let k = 1; k < ws.length; k++) {
    const a = ws.slice(0, k).join(' '), b = ws.slice(k).join(' ');
    const score = Math.max(a.length, b.length) - (/[.!?]$/.test(a) ? 3 : 0);
    if (!best || score < best.score) best = { a, b, score };
  }
  return best ? [best.a, best.b] : [t];
}

// What Noodle shouts at every bell for these placements, in road order: [{ owner, heard, src, ok }].
// heard: the bead in his belly (null = empty); src: the owner of the parcel that bead came from.
export function deliveries(spec, placed = {}) {
  const own = Object.fromEntries((spec.parcels || []).map((p) => [p.owner, p.own ?? null]));
  let belly = null, src = null;
  const out = [];
  for (const s of spec.slots || []) {
    if (BEADS[s.tok]) { belly = s.tok; src = s.parcel; } // a gulp replaces the whole belly
    else if (s.tok === 'ribbon') { if (placed[s.ribbon] === 'marble') { belly = null; src = null; } } // a gulp of nothing
    else if (s.tok === 'bell') out.push({ owner: s.parcel, heard: belly, src, ok: belly === (own[s.parcel] ?? null) });
    // sand, ums, a bare ribbon or a pinch of sand: he lets it slide, the belly stays
  }
  return out;
}

export default {
  mount(w, spec, api) {
    const { THREE } = w;
    const row = { z: 2.25, x0: -24.6, step: 0.82, ...(spec.row || {}) };
    const slots = (spec.slots || []).map((s, k) => { const i = s.i ?? k; return { ...s, i, x: s.x ?? row.x0 + i * row.step }; });
    const parcels = spec.parcels || [];
    const parcelOf = Object.fromEntries(parcels.map((p) => [p.owner, p]));
    const ribbons = spec.ribbons || [];
    const STOCK = spec.marbles ?? 2;
    const menu = spec.menu || {};
    const mi = menu.interactable || {};
    const disp = spec.dispatch || {};
    const at = disp.at || [-16, 0, 0.55];
    const reactions = spec.reactions || {};
    const res = spec.result || {};
    const giver = spec.speaker || 'penny';
    const xOf = (i) => slots.find((s) => s.i === i)?.x ?? row.x0 + i * row.step;
    const nameOf = (id) => parcelOf[id]?.name || w.speakerOf?.(id)?.name || id;
    // the player watches each run from just behind the dispatch bell: the follow camera then frames the row
    const WATCH = { x: at[0], z: at[2] - (disp.collider ?? 0.25) - 0.42 };

    const placed = Object.fromEntries(ribbons.map((r) => [r.id, 'none']));
    const marblesLeft = () => STOCK - Object.values(placed).filter((v) => v === 'marble').length;
    let lastOk = 0, last = [], running = false, solved = false, destroyed = false, runs = 0;
    // the HUD line: before the first run the marbles and what to do next, after it the score
    const progress = () => fill(runs ? (spec.progress || 'Parcel Day: {ok}/5 bells right · ◯ {marbles} left')
      : (spec.progressBefore || 'Parcel Day: ◯ {marbles} left · ring the dispatch bell'),
    { ok: lastOk, marbles: plural(marblesLeft(), 'marble', 'marbles') });
    // run speed: the first run at 1, replays faster; holding a hurry key (or the mouse button) faster still
    const runCfg = spec.run || {};
    const REPLAY = Number(runCfg.replaySpeed) || 2, HURRY = Number(runCfg.hurrySpeed) || 4;
    let base = 1, hurry = false;
    const hook = {
      get placed() { return { ...placed }; },
      get marbles() { return marblesLeft(); },
      get running() { return running; },
      get runs() { return runs; },
      get hurry() { return hurry; },
      get last() { return last.map((r) => ({ owner: r.owner, heard: r.heard, ok: r.ok })); },
      speed: 1,
    };
    if (window.__etl) window.__etl.parcelDay = hook;
    const timeScale = () => Math.min(40, Math.max(0.25, (Number(hook.speed) || 1) * (running ? Math.max(base, hurry ? HURRY : 0) : 1)));

    const root = new THREE.Group(); root.name = 'parcel-day';
    w.scene.add(root);
    const owned = new Set();   // every geometry, material and texture made here: disposed on destroy
    const own = (x) => { owned.add(x); return x; };
    const interactables = [], colliders = [];

    // ---------- clock: tweens, loops and waits on game time (dt), scaled by hook.speed ----------
    const tweens = new Set(), loops = new Set(), pending = new Set();
    const tween = (dur, fn, delay = 0) => { const tw = { t: -delay, dur, fn }; tweens.add(tw); return tw; };
    const wait = (sec) => new Promise((resolve) => { pending.add(resolve); tween(sec, (u) => { if (u >= 1) { pending.delete(resolve); resolve(); } }); });
    const unsub = w.onUpdate((dt0, t) => {
      const dt = dt0 * timeScale();
      for (const tw of [...tweens]) {
        if (!tweens.has(tw)) continue;
        tw.t += dt; if (tw.t < 0) continue;
        const u = tw.dur > 0 ? Math.min(1, tw.t / tw.dur) : 1;
        tw.fn(u); if (u >= 1) tweens.delete(tw);
      }
      for (const fn of [...loops]) fn(dt, t);
    });

    // ---------- small builders (chunky toy style: MeshStandardMaterial, roughness ~0.8) ----------
    const M = (c, o = {}) => own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o }));
    const mesh = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
    const group = (par, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); par.add(g); return g; };
    const textures = []; // { tex, paint }: drawn again once the web font is there
    const canvasTex = (wpx, hpx, draw) => {
      const c = document.createElement('canvas'); c.width = wpx; c.height = hpx;
      const tex = own(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const rec = { tex, draw };
      rec.paint = (d = rec.draw) => { rec.draw = d; d(c.getContext('2d'), wpx, hpx); tex.needsUpdate = true; };
      rec.paint(); textures.push(rec); return rec;
    };
    const popIn = (o, dur = 0.32, delay = 0, s0 = 1) => { o.scale.setScalar(0.001); tween(dur, (u) => o.scale.setScalar(Math.max(0.001, s0 * easeBack(u))), delay); };
    const swing = (o, amp = 0.55, dur = 1.1) => tween(dur, (u) => { const t = u * dur; o.rotation.z = Math.sin(t * 26) * amp * Math.exp(-t * 4); });

    // shared stuff
    const wood = M(0x6a4a2a), woodLight = M(0x9a6a40), inkM = M(0x2b2233, { roughness: 0.6 });
    const paperM = M(0xf6ecd4, { roughness: 0.9 }), whiteM = M(0xffffff, { roughness: 0.9 }), kraftSide = M(0x7e5228, { roughness: 0.95 });
    const bellM = M(0x2f2838, { roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide }), brass = M(0xe6b84a, { roughness: 0.35, metalness: 0.35, side: THREE.DoubleSide });
    const red = M(0xe8566a, { roughness: 0.7, side: THREE.DoubleSide });
    const sandTex = canvasTex(64, 64, paintSand);
    const sandM = M(0xffffff, { map: sandTex.tex, roughness: 0.95 });
    const wrapTex = canvasTex(256, 64, paintWrap);
    wrapTex.tex.wrapS = THREE.RepeatWrapping;
    const umTex = canvasTex(128, 104, paintUm);
    const umM = M(0xffffff, { map: umTex.tex, roughness: 0.9, alphaTest: 0.5, side: THREE.DoubleSide });
    const spotTex = canvasTex(128, 128, paintSpot);
    const spotM = own(new THREE.MeshBasicMaterial({ map: spotTex.tex, transparent: true, opacity: 0.75, depthWrite: false }));
    const flagTex = { true: canvasTex(128, 96, paintFlag(true)), false: canvasTex(128, 96, paintFlag(false)) };
    const haloTex = canvasTex(64, 64, paintHalo);
    const marbleM = M(0xe8f6ff, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5, depthWrite: false, emissive: 0x9fd8ff, emissiveIntensity: 0.22 });
    const ringM = own(new THREE.SpriteMaterial({ map: canvasTex(64, 64, paintRing).tex, transparent: true, depthWrite: false }));
    const glintM = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const gemM = Object.fromEntries(Object.entries(BEADS).map(([k, b]) => [k, M(b.color, { roughness: 0.22, metalness: 0.15, flatShading: true, emissive: b.color, emissiveIntensity: 0.16 })]));

    const G = {
      foot: own(new THREE.CylinderGeometry(0.12, 0.14, 0.05, 14)),
      post: own(new THREE.CylinderGeometry(0.04, 0.045, POST_H, 8)),
      arm: own(new THREE.BoxGeometry(0.17, 0.028, 0.028)),
      bell: own(new THREE.LatheGeometry([[0.074, -0.135], [0.07, -0.12], [0.048, -0.08], [0.04, -0.03], [0.022, -0.005], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 14)), // bottom to top: faces out
      clapper: own(new THREE.SphereGeometry(0.022, 8, 6)),
      card: own(new THREE.CylinderGeometry(CARD.r + 0.02, CARD.r + 0.02, 0.035, 32)),
      face: own(new THREE.CircleGeometry(CARD.r, 32)),
      plate: own(new THREE.PlaneGeometry(PLATE.w, PLATE.h)),
      pin: own(new THREE.CylinderGeometry(0.012, 0.012, FLAG.pin, 6)),
      pinHead: own(new THREE.SphereGeometry(0.03, 8, 6)),
      flag: own(new THREE.PlaneGeometry(FLAG.w, FLAG.h).translate(FLAG.w / 2, 0, 0)),
      stand: own(new THREE.CylinderGeometry(0.03, 0.075, 0.2, 10)),
      cup: own(new THREE.CylinderGeometry(0.075, 0.045, 0.05, 10)),
      sand: own(new THREE.ConeGeometry(0.17, 0.13, 12)),
      stick: own(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6)),
      um: own(new THREE.PlaneGeometry(0.42, 0.34)),
      marble: own(new THREE.SphereGeometry(0.16, 22, 16)),
      glint: own(new THREE.SphereGeometry(0.034, 8, 6)),
      spot: own(new THREE.PlaneGeometry(0.66, 0.66)),
      loop: own(new THREE.TorusGeometry(0.075, 0.026, 6, 16)),
      knot: own(new THREE.SphereGeometry(0.042, 10, 8)),
      tail: own(new THREE.BoxGeometry(0.036, 0.15, 0.014)),
      string: own(new THREE.CylinderGeometry(0.011, 0.011, 1, 5)),
      puff: own(new THREE.SphereGeometry(0.045, 6, 5)),
      belly: own(new THREE.SphereGeometry(0.17, 18, 12)),
    };
    // the three cuts, facing +z: a round brilliant (octagon with a star of facets), a square with a
    // bevelled frame, a tall octagon (emerald cut)
    const gemGeo = {
      round: own(new THREE.LatheGeometry([[0, -0.07], [0.15, 0], [0.15, 0.016], [0.095, 0.066], [0, 0.066]].map(([r, y]) => new THREE.Vector2(r, y)), 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8)),
      square: (() => {
        const s = new THREE.Shape(), R = 0.095; s.moveTo(-R, -R); s.lineTo(R, -R); s.lineTo(R, R); s.lineTo(-R, R); s.closePath();
        return own(new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.045, bevelSegments: 1 }).center());
      })(),
      tall: (() => {
        const s = new THREE.Shape(), a = 0.072, b = 0.112, c = 0.038;
        s.moveTo(-a + c, -b); s.lineTo(a - c, -b); s.lineTo(a, -b + c); s.lineTo(a, b - c); s.lineTo(a - c, b); s.lineTo(-a + c, b); s.lineTo(-a, b - c); s.lineTo(-a, -b + c); s.closePath();
        return own(new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.04, bevelSegments: 1 }).center());
      })(),
    };

    function sandHeap(par, x, y, z, s = 1) {
      const h = mesh(G.sand, sandM, x, y + 0.065 * s, z, par); h.scale.set(s, s, s * 0.85); h.rotation.y = x * 7.3;
      return h;
    }
    // A string from a to b (two [x, y, z]).
    function string(par, a, b) {
      const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), m = mesh(G.string, whiteM, 0, 0, 0, par);
      m.scale.y = d.length(); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      return m;
    }

    // ---------- the parcels: wrapping strips, grains, posts ----------
    const STRIP_Y = 0.07; // top of the wrapping paper (a flat parcel: its front edge shows as a darker band)
    const slotObj = new Map(); // slot index -> { gem | um }
    for (const p of parcels) {
      const x0 = xOf(p.slots[0]) - STRIP_PAD, x1 = xOf(p.slots[1]) + STRIP_PAD, len = x1 - x0;
      const tex = wrapTex.tex.clone(); own(tex); tex.repeat.set(len / 2.2, 1); tex.needsUpdate = true;
      const top = M(0xffffff, { map: tex, roughness: 0.95 });
      const strip = mesh(own(new THREE.BoxGeometry(len, STRIP_Y - 0.012, 0.5)), [kraftSide, kraftSide, top, kraftSide, kraftSide, kraftSide], (x0 + x1) / 2, (STRIP_Y + 0.012) / 2, row.z, root);
      strip.receiveShadow = true;
      // the parcel string: along the back of the strip, tied round both ends
      string(root, [x0 + 0.08, STRIP_Y + 0.008, row.z - 0.16], [x1 - 0.08, STRIP_Y + 0.008, row.z - 0.16]);
      for (const sx of [x0 + 0.16, x1 - 0.16]) string(root, [sx, STRIP_Y + 0.008, row.z - 0.25], [sx, STRIP_Y + 0.008, row.z + 0.25]);
    }
    for (const s of slots) {
      if (s.tok === 'ribbon' || s.tok === 'bell') continue;
      const g0 = group(root, s.x, STRIP_Y, row.z); // popped in at the start (its scale animates)
      const g = group(g0); g.scale.setScalar(s.tok === 'sand' ? SLOT_SAND : PROP);
      if (s.tok === 'sand') sandHeap(g, 0, 0, 0);
      else if (BEADS[s.tok]) {
        mesh(G.stand, paperM, 0, 0.1, 0, g); mesh(G.cup, paperM, 0, 0.215, 0, g);
        const gem = mesh(gemGeo[BEADS[s.tok].cut], gemM[s.tok], 0, 0.36, 0.01, g);
        gem.rotation.x = -0.32;
        slotObj.set(s.i, { gem });
        colliders.push(w.addCollider({ type: 'circle', x: s.x, z: row.z, r: 0.1 * PROP }));
      } else if (s.tok === 'um') {
        mesh(G.stick, woodLight, 0, 0.15, 0, g);
        const um = group(g, 0, 0.3, 0);
        mesh(G.um, umM, 0.02, 0.15, 0.01, um).rotation.x = -0.12;
        slotObj.set(s.i, { um });
        colliders.push(w.addCollider({ type: 'circle', x: s.x, z: row.z, r: 0.1 * PROP }));
      }
    }

    // the owners' looks (species + colours) come from the region's inhabitants
    const looks = {};
    const lookOf = (id) => {
      const L = looks[id] || LOOKS[id] || { species: 'bear', colors: {} };
      const species = SPECIES[L.species] ? L.species : 'bear', d = SPECIES[species], c = L.colors || {};
      return { species, fur: c.fur || d.fur, shirt: c.shirt || '#3ec7b5', inner: c.inner || d.inner || '#ffb3cf', muzzle: c.muzzle || d.muzzle || null, nose: c.nose || d.nose || INK };
    };
    const posts = new Map(); // owner -> { x, g, bell, flag, flagFace, portrait, bubble }
    for (const p of parcels) {
      const x = xOf(p.bell) + POST_DX;
      const g = group(root, x, 0, row.z);
      mesh(G.foot, wood, 0, 0.025, 0, g);
      mesh(G.post, wood, 0, POST_H / 2, 0, g);
      // the small black bell hangs on the parcel's side
      mesh(G.arm, wood, -0.085, 0.8, 0, g);
      const bell = group(g, -0.16, 0.8, 0);
      mesh(G.bell, bellM, 0, 0, 0, bell); mesh(G.clapper, bellM, 0, -0.13, 0, bell);
      // the portrait card on top, its name plate across the lower edge
      const card = group(g, 0, CARD.y, 0); card.rotation.x = -0.12;
      mesh(G.card, inkM, 0, 0, 0, card).rotation.x = Math.PI / 2;
      const portrait = canvasTex(256, 256, paintPortrait(lookOf(p.owner)));
      mesh(G.face, M(0xffffff, { map: portrait.tex, roughness: 0.9 }), 0, 0, 0.019, card);
      const plate = canvasTex(384, 100, paintPlate(p.name || nameOf(p.owner)));
      mesh(G.plate, M(0xffffff, { map: plate.tex, roughness: 0.9, alphaTest: 0.5 }), 0, PLATE.dy, 0.03, card);
      // the ✓ / ✕ flag on a pin at the card's top right (hidden until the bell is judged)
      const flag = group(card, CARD.r * 0.45, CARD.r * 0.8, 0.0);
      mesh(G.pin, inkM, 0, FLAG.pin / 2, 0, flag); mesh(G.pinHead, red, 0, FLAG.pin, 0, flag);
      const flagFace = mesh(G.flag, M(0xffffff, { map: flagTex.true.tex, roughness: 0.9, alphaTest: 0.5, side: THREE.DoubleSide }), 0.012, FLAG.pin - FLAG.h / 2 - 0.02, 0, flag);
      flag.visible = false;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      colliders.push(w.addCollider({ type: 'circle', x, z: row.z, r: 0.15 }));
      posts.set(p.owner, { x, g, bell, flag, flagFace, portrait, owner: p.owner, top: CARD.y + CARD.r, bubble: null });
    }
    // the last post's bubbles open to the left: the camera's right edge is close to it
    const lastPost = [...posts.values()].reduce((a, b) => (!a || b.x > a.x ? b : a), null);
    game.region(w.regionId).then((r) => {
      if (destroyed) return;
      for (const inh of r?.inhabitants || []) looks[inh.id] = inh;
      for (const p of posts.values()) p.portrait.paint(paintPortrait(lookOf(p.owner)));
    }).catch(() => { /* keep the built-in looks */ });

    // ---------- the ribbon spots ----------
    const spots = new Map(); // ribbon id -> { r, x, g, marble, sand }
    for (const r of ribbons) {
      const x = xOf(r.slot);
      const g = group(root, x, 0, row.z);
      mesh(G.spot, spotM, 0, 0.022, 0.02, g).rotation.x = -Math.PI / 2;
      // the red bow, at the back of the spot, tilted up so it reads from the camera
      const bow = group(g, 0, 0.09, -0.3); bow.rotation.x = -0.5;
      for (const s of [-1, 1]) {
        const lp = mesh(G.loop, red, s * 0.085, 0, 0, bow); lp.scale.set(1, 0.62, 0.7); lp.rotation.z = s * 0.35;
        const tl = mesh(G.tail, red, s * 0.04, -0.075, 0.005, bow); tl.rotation.z = s * 0.42;
      }
      mesh(G.knot, red, 0, 0, 0.01, bow);
      // the marble and the pinch of sand sit in scaled holders: their own scale and height animate
      const mHold = group(g, 0, 0, 0.02); mHold.scale.setScalar(PROP);
      const marble = group(mHold);
      const ball = mesh(G.marble, marbleM, 0, 0.165, 0, marble); ball.renderOrder = 2;
      const rim = new THREE.Sprite(ringM); rim.scale.set(0.36, 0.36, 1); rim.position.set(0, 0.165, 0.01); rim.renderOrder = 3; marble.add(rim);
      mesh(G.glint, glintM, -0.055, 0.235, 0.12, marble);
      marble.visible = false;
      const sHold = group(g, 0, 0.012, 0.02); sHold.scale.setScalar(PROP);
      const sand = group(sHold); sandHeap(sand, 0, 0, 0, 1.25); sand.visible = false;
      g.traverse((o) => { if (o.isMesh && o.material !== spotM && o.material !== marbleM) o.castShadow = true; });
      const it = w.addInteractable({
        id: r.id, label: mi.label || 'Ribbon', icon: mi.icon || '🎀',
        pos: { x, y: 0, z: row.z }, radius: mi.radius ?? 0.75, promptHeight: mi.promptHeight ?? 1.4,
        onInteract: () => useRibbon(r.id),
      });
      interactables.push(it);
      spots.set(r.id, { r, x, g, marble, sand });
    }
    // a new marble or pinch of sand drops into its spot from above the head of the player using it
    function dropIn(o) {
      const y0 = 0, h = 2.3 / PROP;
      o.scale.setScalar(1); o.position.y = y0 + h;
      tween(0.5, (u) => {
        if (u < 0.72) { const v = u / 0.72; o.position.y = y0 + h * (1 - v * v); } else o.position.y = y0 + 0.09 * Math.sin(Math.PI * (u - 0.72) / 0.28);
        if (u >= 1) o.position.y = y0;
      });
    }
    function showSpot(id, drop = false) {
      const s = spots.get(id), v = placed[id];
      s.marble.visible = v === 'marble'; s.sand.visible = v === 'sand';
      if (drop && v !== 'none') dropIn(v === 'marble' ? s.marble : s.sand);
    }
    // the menu offers what can change, and its last option (Escape) always leaves the spot as it is
    const PUT = { marble: '◯ Clear marble ({n} left)', sand: '∴ Pinch of sand', ...(menu.put || {}) };
    const TAKE = { marble: 'Take the marble back', sand: 'Sweep the sand away', ...(menu.take || {}) };
    const KEEP = { none: 'Leave it empty', marble: 'Keep the marble', sand: 'Keep the sand', ...(menu.keep || {}) };
    function menuFor(id) {
      const now = placed[id];
      const items = now === 'marble' ? [['sand', PUT.sand], ['none', TAKE.marble]]
        : now === 'sand' ? [['marble', PUT.marble], ['none', TAKE.sand]]
          : [['marble', PUT.marble], ['sand', PUT.sand]];
      items.push([now, KEEP[now] || KEEP.none]);
      return items.map(([want, label]) => ({ want, label: fill(label, { n: marblesLeft() }) }));
    }
    async function useRibbon(id) {
      if (running || solved || destroyed) return;
      const r = spots.get(id).r;
      const q = fill(menu.question || "Between {a}'s and {b}'s parcels:", { a: nameOf(r.between?.[0]), b: nameOf(r.between?.[1]) });
      const items = menuFor(id);
      const pick = await w.ask(q, items.map((it) => it.label), { neutral: true });
      if (destroyed || solved || running) return;
      const want = items[pick]?.want;
      if (!want || want === placed[id]) return; // the last option (or Escape): no change
      if (want === 'marble' && marblesLeft() <= 0) { w.toast(menu.empty || 'No clear marbles left.', 2200); return; }
      placed[id] = want; // a marble taken off this spot goes back to the stock
      showSpot(id, true);
      w.sfx('paper');
      api.onProgress?.(progress());
    }

    // ---------- the dispatch bell ----------
    const D = group(root, at[0], at[1], at[2]);
    mesh(G.foot, wood, 0, 0.025, 0, D).scale.set(1.3, 1, 1.3);
    mesh(own(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 8)), wood, 0, 0.65, 0, D);
    mesh(own(new THREE.BoxGeometry(0.46, 0.06, 0.06)), wood, 0.2, 1.22, 0, D);
    const hand = group(D, 0.4, 1.19, 0); // the brass handbell hangs from the arm's end
    mesh(own(new THREE.LatheGeometry([[0.106, -0.225], [0.1, -0.2], [0.07, -0.13], [0.062, -0.05], [0.04, -0.01], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 18)), brass, 0, 0, 0, hand);
    mesh(own(new THREE.SphereGeometry(0.03, 8, 6)), woodLight, 0, -0.225, 0, hand);
    mesh(own(new THREE.TorusGeometry(0.026, 0.008, 6, 12)), woodLight, 0, 0.012, 0, hand);
    { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(-0.42, -0.11); s.lineTo(0, -0.22); s.closePath();
      const pen = mesh(own(new THREE.ShapeGeometry(s)), red, -0.03, 1.5, 0, D); loops.add((dt, t) => { pen.rotation.y = Math.sin(t * 2.2) * 0.25; }); }
    mesh(own(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6)), woodLight, 0, 1.4, 0, D);
    D.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    colliders.push(w.addCollider({ type: 'circle', x: at[0], z: at[2], r: disp.collider ?? 0.25 }));
    interactables.push(w.addInteractable({
      id: disp.id || 'dispatch', label: disp.label || 'Dispatch bell', icon: disp.icon || '🔔',
      pos: { x: at[0], y: at[1], z: at[2] }, radius: disp.radius ?? 1.6, promptHeight: disp.promptHeight ?? 1.9,
      onInteract: () => deliver(),
    }));

    // ---------- the camera: one shot frames the whole road (spec.camera) ----------
    const cam = { ...SHOT, ...(spec.camera || {}) };
    const span = [RUN.start[0] - 0.6, (lastPost ? lastPost.x : xOf(slots.length - 1)) + CARD.r * 0.45 + FLAG.w + 0.05];
    function roadShot() {
      const host = document.getElementById('game');
      const wpx = host?.clientWidth || window.innerWidth || 16, hpx = host?.clientHeight || window.innerHeight || 9;
      const tanV = Math.tan(((cam.fov / 2) * Math.PI) / 180), tanH = tanV * Math.max(0.6, wpx / hpx);
      const cx = (span[0] + span[1]) / 2, half = (span[1] - span[0]) / 2 + cam.margin;
      const d = Math.max(half / tanH, 2.4 / tanV), a = (cam.pitch * Math.PI) / 180;
      const look = [cx, cam.lookY, row.z + cam.lookDz];
      return { pos: [cx, look[1] + d * Math.sin(a), look[2] + d * Math.cos(a)], look };
    }
    let shot = 0; // which shot holds the camera (0: none); a newer shot or back() takes over
    function shotTo(ms = cam.fly) { const s = roadShot(); shot++; w.camera?.to?.(s.pos, s.look, ms); return shot; }
    function shotBack(id, ms = cam.back) { if (!shot || (id && id !== shot)) return; shot = 0; w.camera?.back?.(ms); }

    // the row pops up when the puzzle starts, left to right; from afar, the camera goes to look
    const pp = w.player.pos, far = Math.abs(pp.x - (span[0] + span[1]) / 2) > 9 || Math.abs(pp.z - row.z) > 6;
    root.children.forEach((o, k) => { if (o.isGroup) popIn(o, 0.4, (far ? 0.7 : 0.15) + 0.012 * k); });
    if (far && w.camera) {
      const id = shotTo();
      wait(cam.reveal + 0.7).then(() => { if (!destroyed && !running) shotBack(id); });
    }

    // ---------- Noodle (his real mesh), his belly glow; Tumble stays home, off Penny's parcel ----------
    w.villager('tumble');
    let noodle = w.villager('noodle'), standIn = null;
    if (!noodle) {
      const a = w.anchors['lane-left'] || [-21, 0, 1.4];
      standIn = group(w.scene, a[0], a[1], a[2]);
      mesh(own(new THREE.CapsuleGeometry(0.42, 0.9, 6, 12)), M(0x6cc24a), 0, 0.88, 0, standIn);
      noodle = standIn;
    }
    const home = noodle.position.clone(), homeRy = noodle.rotation.y;
    const bellyM = M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.35, transparent: true });
    const belly = new THREE.Mesh(G.belly, bellyM);
    belly.position.set(0, 0.62, 0.62);
    const haloM = own(new THREE.SpriteMaterial({ map: haloTex.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
    const halo = new THREE.Sprite(haloM); halo.scale.set(0.85, 0.85, 1); halo.position.z = 0.08; belly.add(halo);
    belly.visible = false;
    (noodle.userData.parts?.body || noodle).add(belly);
    let bellyBead = null, bellyTw = null;
    function setBelly(bead, instant = false) {
      bellyBead = bead;
      if (bellyTw) { tweens.delete(bellyTw); bellyTw = null; }
      if (bead) {
        const c = new THREE.Color(BEADS[bead].color);
        bellyM.color.copy(c); bellyM.emissive.copy(c); haloM.color.copy(c);
        bellyM.opacity = 1; haloM.opacity = 0.85; belly.visible = true;
        if (!instant) bellyTw = tween(0.32, (u) => belly.scale.setScalar(1 + 0.5 * Math.sin(Math.PI * u)));
      } else if (instant || !belly.visible) { belly.visible = false; belly.scale.setScalar(1); }
      else bellyTw = tween(0.4, (u) => { bellyM.opacity = 1 - u; haloM.opacity = 0.85 * (1 - u); belly.scale.setScalar(1 - 0.3 * u); if (u >= 1) { belly.visible = false; belly.scale.setScalar(1); } });
    }

    let taken = false, origUpdate = null, talking = false, face = homeRy, mover = null, slither = 0;
    function take() { // his own update only animates him while the run moves him
      if (taken) return; taken = true; face = noodle.rotation.y;
      if (!standIn) { origUpdate = noodle.userData.update; noodle.userData.update = (dt) => noodle.userData.animate?.(dt * timeScale(), { talking }); }
    }
    function release() { // home, facing the camera again, his own update back
      if (!taken) return; taken = false; mover = null; talking = false;
      if (!standIn) noodle.userData.update = origUpdate;
      noodle.position.copy(home); noodle.rotation.set(0, homeRy, 0); noodle.scale.set(1, 1, 1);
    }
    loops.add((dt) => {
      if (!taken) return;
      noodle.rotation.y += (face - noodle.rotation.y) * Math.min(1, dt * 8);
      mover?.(dt);
    });
    const moveDone = (resolve) => { mover = null; pending.delete(resolve); resolve(); };
    function glide(x, z, dur, f) { // a hop-glide with a small bob
      return new Promise((resolve) => {
        pending.add(resolve);
        const x0 = noodle.position.x, z0 = noodle.position.z; let t = 0; face = f;
        mover = (dt) => {
          t += dt; const u = Math.min(1, t / dur), e = easeInOut(u);
          noodle.position.set(x0 + (x - x0) * e, home.y + Math.sin(Math.PI * u) * 0.2, z0 + (z - z0) * e);
          noodle.rotation.z = 0;
          if (u >= 1) moveDone(resolve);
        };
      });
    }
    function slitherTo(x) { // right along the row at RUN.speed, swaying
      if (noodle.position.x >= x) return Promise.resolve();
      return new Promise((resolve) => {
        pending.add(resolve);
        face = FACE.right;
        mover = (dt) => {
          slither += dt;
          noodle.position.x = Math.min(x, noodle.position.x + RUN.speed * dt);
          noodle.position.z = RUN.z + Math.sin(slither * 6) * 0.04;
          noodle.position.y = home.y + Math.abs(Math.sin(slither * 9)) * 0.035;
          noodle.rotation.z = Math.sin(slither * 9) * 0.06;
          if (noodle.position.x >= x) { noodle.rotation.z = 0; moveDone(resolve); }
        };
      });
    }
    const mouth = new THREE.Vector3();
    function mouthWorld() {
      const head = noodle.userData.parts?.head;
      if (head) { head.getWorldPosition(mouth); mouth.x += Math.sin(noodle.rotation.y) * 0.3; mouth.z += Math.cos(noodle.rotation.y) * 0.3; mouth.y -= 0.12; }
      else mouth.set(noodle.position.x, noodle.position.y + 1.5, noodle.position.z + 0.35);
      return mouth;
    }
    // a gem or marble hops from its spot into his mouth (an arc), then hides until Penny re-packs
    const gulped = [];
    function hop(obj, done) {
      const par = obj.parent, p0 = obj.position.clone(), v = new THREE.Vector3();
      gulped.push(obj);
      tween(RUN.hop, (u) => {
        par.worldToLocal(v.copy(mouthWorld()));
        const e = easeInOut(u);
        obj.position.lerpVectors(p0, v, e); obj.position.y += Math.sin(Math.PI * u) * 0.45;
        obj.scale.setScalar(Math.max(0.001, 1 - 0.55 * e));
        if (u >= 1) { obj.visible = false; obj.position.copy(p0); obj.scale.setScalar(1); done?.(); }
      });
    }
    const puffM = M(0xe6cf9a, { transparent: true, opacity: 0.9, depthWrite: false });
    function puff(x, z) { // a puff of dust over sand he lets slide
      const g = group(root, x, 0.12, z), bits = [];
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.4; const m = mesh(G.puff, puffM, 0, 0, 0, g); m.userData.d = [Math.cos(a), Math.sin(a)]; bits.push(m); }
      tween(0.5, (u) => {
        const e = easeOut(u);
        for (const m of bits) { m.position.set(m.userData.d[0] * 0.24 * e, 0.14 * e, m.userData.d[1] * 0.1 * e); m.scale.setScalar(Math.max(0.001, (1 + e) * (1 - u))); }
        if (u >= 1) root.remove(g);
      });
    }

    // ---------- speech bubbles (sprites, always on top), flags ----------
    const bubbleCache = new Map();
    function bubbleTex(lines, opts) {
      const key = JSON.stringify([lines, opts]);
      if (!bubbleCache.has(key)) {
        const b = paintBubble(lines, opts);
        const tex = own(new THREE.CanvasTexture(b.canvas)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        bubbleCache.set(key, { tex, w: b.canvas.width / PXU, h: b.canvas.height / PXU, tip: b.tip });
      }
      return bubbleCache.get(key);
    }
    // a bubble whose tail tip sits at pos (default: above the post's card)
    function setBubble(post, lines, opts, pos = [post.x, post.top + BUBBLE_GAP - 0.04, row.z]) {
      clearBubble(post);
      const b = bubbleTex(lines, opts);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: b.tex, transparent: true, depthTest: false, depthWrite: false }));
      sp.center.set(b.tip[0], b.tip[1]); sp.renderOrder = 30;
      sp.position.set(...pos);
      root.add(sp);
      post.bubble = { sp, w: b.w, h: b.h };
      tween(0.2, (u) => { const s = Math.max(0.001, easeBack(u)); sp.scale.set(b.w * s, b.h * s, 1); });
    }
    function clearBubble(post) {
      if (!post.bubble) return;
      const { sp } = post.bubble; post.bubble = null;
      root.remove(sp); sp.material.dispose();
    }
    // Noodle's shout: a bubble just above his (stretched) head, next to the bell's card
    function shout(post, heard) {
      const b = heard ? BEADS[heard] : null;
      const text = b ? fill(spec.bells?.word || '{WORD}!', { WORD: b.word }) : (spec.bells?.nothing || 'Nothing for you!');
      const p = noodle.position, top = p.y + (HEAD.y + HEAD.top) * (standIn ? 0.9 : STRETCH) + 0.1, flip = post === lastPost;
      setBubble(post, [text], { color: b ? b.color : GREY, outline: !!b, tail: flip ? 'right' : 'left', size: 54 }, [p.x + (flip ? -0.16 : 0.16), top, p.z + 0.1]);
    }
    let stretchTw = null;
    function stretch(to, dur) { // squash and stretch, keeping his volume
      if (stretchTw) tweens.delete(stretchTw);
      const from = noodle.scale.y;
      stretchTw = tween(dur, (u) => { const k = from + (to - from) * (to > from ? easeBack(u) : easeOut(u)); const q = 1 / Math.sqrt(Math.max(0.2, k)); noodle.scale.set(q, k, q); });
    }
    function react(post, r) {
      const lines = reactions[r.owner] || {};
      const text = r.ok ? (lines.right || 'Thanks, Noodle!') : (lines.wrong || reactions.fallbackWrong || "That's not mine!");
      setBubble(post, wrap2(text), { color: INK, tail: post === lastPost ? 'right' : 'down', size: 42 });
    }
    function popFlag(post, ok) {
      post.flagFace.material.map = flagTex[ok].tex; post.flagFace.material.needsUpdate = true;
      post.flag.visible = true;
      tween(0.3, (u) => { const s = Math.max(0.001, easeBack(u)); post.flag.scale.set(s, s, s); });
    }
    function clearMarks() { for (const p of posts.values()) { clearBubble(p); p.flag.visible = false; } }
    function repack() { // Penny re-packs: every gulped gem and marble pops back where it was
      gulped.splice(0).forEach((o, k) => {
        const id = o.userData.ribbon;
        if (id && placed[id] !== 'marble') return;
        o.visible = true; popIn(o, 0.35, 0.08 * k);
      });
    }

    // ---------- the delivery run ----------
    function speckTo(x, z, dur) { // step out of Noodle's way to where the camera sees the row
      const p = w.player.pos, x0 = p.x, z0 = p.z, y = p.y;
      if (Math.hypot(x - x0, z - z0) < 0.05) return Promise.resolve();
      const side = Math.abs(x0 - at[0]) < 0.6 && z0 > at[2] ? (x0 >= at[0] ? 1 : -1) * 0.75 : 0; // round the bell post, not through it
      return new Promise((resolve) => {
        pending.add(resolve);
        tween(dur, (u) => {
          const e = easeInOut(u);
          w.player.place(x0 + (x - x0) * e + side * Math.sin(Math.PI * u), y, z0 + (z - z0) * e);
          if (u >= 1) { pending.delete(resolve); resolve(); }
        });
      });
    }
    async function bellStop(post, r) {
      face = FACE.front; talking = true;
      if (!standIn) stretch(STRETCH, 0.18);
      swing(post.bell, 0.6);
      shout(post, r.heard);
      await wait(RUN.judge); if (destroyed) return;
      w.sfx(r.ok ? 'ding' : 'buzz');
      popFlag(post, r.ok);
      await wait(RUN.stop - RUN.judge); if (destroyed) return;
      talking = false; face = FACE.right;
      if (!standIn) stretch(1, 0.2);
      react(post, r);
    }
    function verdict(plan) {
      const bad = plan.filter((r) => !r.ok), n = bad.length;
      const count = n === 1 ? (res.count?.one || 'One mix-up!') : fill(res.count?.many || '{n} mix-ups!', { n: NUMBER[n] || n });
      const detail = bad.map((r) => (r.heard
        ? fill(res.detail || "{owner} got {source}'s {bead}.", { owner: nameOf(r.owner), source: nameOf(r.src), bead: r.heard })
        : fill('{owner} got nothing.', { owner: nameOf(r.owner) }))).join(' ');
      return [count, detail];
    }
    async function deliver() {
      if (running || solved || destroyed) return;
      running = true;
      const plan = deliveries(spec, placed); // what each bell will hear; the run below shows exactly this
      const verdicts = new Map(plan.map((r) => [r.owner, r]));
      clearMarks();
      swing(hand, 0.7, 1.3); w.sfx('ding');
      await speckTo(WATCH.x, WATCH.z, 0.4); if (destroyed) return;
      take(); setBelly(null, true);
      await glide(RUN.start[0], RUN.start[1], RUN.toStart, FACE.left); if (destroyed) return;
      for (const s of slots) {
        await slitherTo(s.x - (s.tok === 'bell' ? RUN.bell : RUN.early)); if (destroyed) return;
        if (BEADS[s.tok]) {
          const o = slotObj.get(s.i);
          if (o) hop(o.gem, () => { setBelly(s.tok); w.sfx('pop'); }); else setBelly(s.tok);
        } else if (s.tok === 'ribbon') {
          const sp = spots.get(s.ribbon);
          if (placed[s.ribbon] === 'marble') { sp.marble.userData.ribbon = s.ribbon; hop(sp.marble, () => { setBelly(null); w.sfx('pop'); }); }
          else if (placed[s.ribbon] === 'sand') puff(s.x, row.z + 0.02);
        } else if (s.tok === 'sand') puff(s.x, row.z);
        else if (s.tok === 'um') { const um = slotObj.get(s.i)?.um; if (um) tween(0.55, (u) => { um.rotation.z = Math.sin(u * Math.PI * 5) * 0.4 * (1 - u); }); }
        else if (s.tok === 'bell') { const post = posts.get(s.parcel), r = verdicts.get(s.parcel); if (post && r) { await bellStop(post, r); if (destroyed) return; } }
      }
      await slitherTo(RUN.end); if (destroyed) return;
      await wait(RUN.linger); if (destroyed) return;
      await glide(home.x, home.z, RUN.back, FACE.left); if (destroyed) return;
      face = homeRy; await wait(0.3); if (destroyed) return; // turn back to the camera
      release(); setBelly(null, true);
      repack();
      last = plan; lastOk = plan.filter((r) => r.ok).length;
      running = false;
      api.onProgress?.(progress());
      if (plan.length && lastOk === plan.length) {
        solved = true;
        for (const p of posts.values()) swing(p.bell, 0.6, 1.2); // five bells ring at once
        swing(hand, 0.7, 1.3);
        w.sfx('win');
        await wait(1.0); if (destroyed) return;
        api.onSolved();
        return;
      }
      await w.speak(giver, verdict(plan));
    }

    // text drawn before the Fredoka web font arrives is drawn again once it is there
    try {
      if (document.fonts && !document.fonts.check(`700 32px ${FONT}`)) {
        document.fonts.load('700 32px Fredoka').then(() => { if (!destroyed) { for (const t of textures) t.paint(); bubbleCache.clear(); } }).catch(() => {});
      }
    } catch { /* no font loading API */ }

    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsub?.();
        tweens.clear(); loops.clear(); mover = null;
        for (const resolve of pending) resolve(); // a run cut short must not hold the scene busy
        pending.clear();
        for (const it of interactables) w.removeInteractable(it);
        for (const c of colliders) w.removeCollider(c);
        release();
        belly.parent?.remove(belly);
        if (standIn) w.scene.remove(standIn);
        w.scene.remove(root);
        root.traverse((o) => { if (o.isSprite) owned.add(o.material); });
        for (const x of owned) { try { x.dispose?.(); } catch { /* already gone */ } }
        owned.clear(); bubbleCache.clear();
        if (window.__etl?.parcelDay === hook) delete window.__etl.parcelDay;
      },
    };
  },
};
