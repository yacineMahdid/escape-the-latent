// Who's It? (Attendale / attention, challenge m1): a 55-second rush with Bimble's teal practice ear.
// Each round a short bit of Fair gossip has a glowing 'it'. Every word of it has a key flag somewhere on a round
// dial, and the flag order does not follow the sentence order. Turn the ear to the flag of the word 'it' really
// means and ring. Live, as you turn: the listening pie (one slice per word, always one whole pie), the glowing
// word cards and the 'it = …' bubble. A ring is good when the meant word has the biggest slice and at least the
// threshold of the pie. 6 good rings win; 3 muddles lose (a burnt-out round fuse is a muddle), so does the clock.
// The paper (Vaswani et al. 2017): the ear's direction is the query, each flag is a key; their dot product goes
// through a softmax (§3.2.1) to give the weights, which are the pie slices shared by every word at once, and what
// 'it' turns into is the blend of the values weighted by those slices (§3.2): the bubble, and the colour of the
// 'it' card when you ring. Playing well = one sharp head on the word 'it' refers to, like Figure 4's heads on 'its'.
// Controls: ← → turn the ear (holding speeds it up). The mouse over the dial sets where the ear should point and
// the ear swings there (at most spec.mouseTurn °/s, so the pie sweeps through the words on its way); a press on the
// dial rings once the ear has arrived. Only presses on the dial ring: a click on the sentence, the pie or Bimble
// does nothing. Space/Enter ring at once (or on arrival, while the ear is still swinging to the mouse).
// Spec: content/extra/attention.json, challenge m1. Test hooks on container.__mg.state:
//   stage ('pre' | 'listen' | 'rung' | 'over'), stageT, fuseLeft, ri (round of this try, 0-based),
//   rd { words, ask, means, decoy }, theta (ear angle in degrees, 0 = up, clockwise), flags [{ word, phi, color }]
//   (live key angles, drift included), w (live weights), top (index of the biggest slice), good, muddles,
//   driftDir (0 | 1 | -1), last { kind: 'good' | 'muddle' | 'wrong' | 'slow', text }, rings [{ round, kind, wMeans, top }],
//   aim (where the mouse wants the ear, degrees, or null), ringOnArrival (a ring waits for the ear to get there),
//   geo { dial: { cx, cy, ring, zone, top }, pie, strip: { y, bottom } } (canvas units: where a press counts).
import { runMinigame, draw } from './kit.js';
import { sfx as gameSfx } from '../game/sfx.js';

const W = 960, H = 540;
const INK = '#2b2233';
const PAPER = '#fffdf6';
const FONT = 'Fredoka, "Trebuchet MS", Verdana, sans-serif';
const D2R = Math.PI / 180;

// ---- layout (kit units), from the spec's layout block
const DIAL = { cx: 320, cy: 330, ring: 160, rIn: 160, rOut: 188, disc: 172, base: 184, zone: 250, dead: 20 };
const EAR = { bell: 94 };
const CONE = { half: 12, r0: 98, r1: 150 };
const PIE = { cx: 740, cy: 300, r: 92 };
const BUB = { x: 740, y: 456, h: 54 };
const STRIP = { y: 88, size: 24, pad: 12, gap: 8, h: 44, lift: 8 };
const BIMBLE = { x: 908, y: 478 };
const STRIP_BOTTOM = STRIP.y + 32; // the sentence strip's ribbon ends here: the dial's pointer zone starts below it
const FIT = W - 110;        // the strip's cards fit this width, so the ribbon and its folded tails stay on the canvas
const TAP = 3;              // degrees for a key tap shorter than one frame
const LITTLE = new Set(['the', 'a', 'an', 'because', 'was', 'is', 'and', 'of', 'to', 'so']);

const DEF_COLORS = {
  frog: '#7bcd5d', pie: '#ffb04a', duck: '#f2d16b', note: '#8fd3ff', mouse: '#b9b9c6', Bell: '#ffd35a',
  bunny: '#ffb3cf', cat: '#b39cff', it: '#ff7ab8', verbs: '#f4a6a6', 'last word': '#9fe0d0', 'little words': '#e4ddd0',
};
const DEF_FEEDBACK = { good: '{word}!', muddle: '{a}-{b}?!', wrong: '{a}?!', slow: 'zzz…' };
const FALLBACK_ROUNDS = [
  { words: ['the', 'frog', 'ate', 'the', 'pie', 'because', 'it', 'was', 'hungry'], ask: 6, means: 1, decoy: 4 },
  { words: ['the', 'frog', 'ate', 'the', 'pie', 'because', 'it', 'was', 'yummy'], ask: 6, means: 4, decoy: 1 },
  { words: ['the', 'cat', 'read', 'the', 'note', 'because', 'it', 'was', 'curious'], ask: 6, means: 1, decoy: 4 },
  { words: ['the', 'cat', 'read', 'the', 'note', 'because', 'it', 'was', 'pink'], ask: 6, means: 4, decoy: 1 },
];
const CONFETTI = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#7bcd5d', '#8fd3ff', '#ff9a4a'];

// ---- small math
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const norm = (a) => ((a % 360) + 360) % 360;
const num = (v, d) => (Number.isFinite(v) ? v : d);
const hexRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0xe4ddd0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbStr = (c) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const PAPER_RGB = hexRgb(PAPER);
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const argmax = (w) => { let b = 0; for (let j = 1; j < w.length; j++) if (w[j] > w[b]) b = j; return b; };
const polar = (a, r) => [DIAL.cx + r * Math.sin(a * D2R), DIAL.cy - r * Math.cos(a * D2R)];
const canvasAngle = (a) => (a - 90) * D2R;                          // dial degrees (0 = up, clockwise) -> canvas radians

// The ear's attention: q = (sin θ, -cos θ), k_j = (sin φ_j, -cos φ_j), score_j = sharpness · q·k_j = sharpness · cos(θ - φ_j),
// then a softmax over every word at once.
export function listen(theta, phis, sharpness) {
  const s = phis.map((p) => sharpness * Math.cos((theta - p) * D2R));
  const m = Math.max(...s);
  const e = s.map((v) => Math.exp(v - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

function rnd(S) { // mulberry32 on S.rng: every try replays from its own seed
  let t = (S.rng = (S.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(S, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd(S) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

function validRounds(rounds) {
  if (!Array.isArray(rounds)) return null;
  const ok = rounds.filter((r) => r && Array.isArray(r.words) && r.words.length >= 3
    && [r.ask, r.means, r.decoy].every((i) => Number.isInteger(i) && i >= 0 && i < r.words.length)
    && new Set([r.ask, r.means, r.decoy]).size === 3);
  return ok.length ? ok : null;
}
function config(spec) {
  const ts = spec.turnSpeed || {}, spin = spec.keyLayout?.spin || {};
  return {
    toWin: num(spec.toWin, 6), maxMuddles: num(spec.maxMuddles, 3), fuse: num(spec.roundFuse, 8),
    delay: num(spec.nextRoundDelay, 0.8), sharp: num(spec.sharpness, 10), bar: num(spec.threshold, 0.6),
    turn0: num(ts.start, 70), turn1: num(ts.max, 190), ramp: Math.max(0.01, num(ts.rampSeconds, 0.6)), mouseTurn: Math.max(30, num(spec.mouseTurn, 360)),
    spinFrom: num(spin.fromRound, 4), spinSpeed: num(spin.degPerSec, 10), decoyGap: num(spec.keyLayout?.decoyOffset, 45),
    feedback: { ...DEF_FEEDBACK, ...(spec.feedback || {}) },
    colors: { ...DEF_COLORS, ...(spec.colors || {}) },
    rounds: validRounds(spec.rounds) || FALLBACK_ROUNDS,
  };
}
function colorOf(C, rd, j) {
  const word = rd.words[j];
  if (Object.prototype.hasOwnProperty.call(C.colors, word)) return C.colors[word];
  if (j === rd.ask) return C.colors.it;
  if (j === rd.words.length - 1) return C.colors['last word'];
  if (LITTLE.has(String(word).toLowerCase())) return C.colors['little words'];
  return C.colors.verbs;
}

// ---- cached art: everything that does not change from frame to frame is painted once into an offscreen
// canvas and stamped, so a frame is a few dozen image draws plus a few small shapes (light on slow machines)
const DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
function makeSprite(w, h, ox, oy, paint) { // (ox, oy): where the painter's origin sits inside the sprite
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = c.getContext('2d');
  g.scale(DPR, DPR); g.translate(ox, oy);
  paint(g);
  return { c, w, h, ox, oy };
}
const blit = (g, sp, x = 0, y = 0) => g.drawImage(sp.c, x - sp.ox, y - sp.oy, sp.w, sp.h);
function stamp(g, sp, x, y, s = 1, rot = 0, alpha = 1) {
  if (alpha <= 0 || s <= 0) return;
  g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (s !== 1) g.scale(s, s); if (alpha !== 1) g.globalAlpha *= alpha;
  blit(g, sp); g.restore();
}
const ART = new Map();
const art = (key, make) => { let sp = ART.get(key); if (!sp) { sp = make(); ART.set(key, sp); } return sp; };
let MEASURE = null;
const measure = () => (MEASURE ||= document.createElement('canvas').getContext('2d'));
// text art made before the Fredoka web font arrives is made again once it is there (checked once per frame)
const fontKey = () => { try { return document.fonts.check(`700 16px ${FONT}`) ? '' : '~'; } catch { return ''; } };
let FK = '';
function textW(text, size) { const m = measure(); m.font = `700 ${size}px ${FONT}`; return m.measureText(text).width; }
function textArt(text, size, color, o = {}) { // centred on its middle; o.stroke + o.sw: an outline
  const sw = o.stroke ? (o.sw || 5) : 0;
  return art(`t|${text}|${size}|${color}|${o.stroke || ''}|${sw}|${FK}`, () => {
    const tw = textW(text, size), pad = sw + 4;
    const w = Math.ceil(tw + pad * 2), h = Math.ceil(size * 1.5 + pad * 2);
    return makeSprite(w, h, w / 2, h / 2, (g) => {
      g.font = `700 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      if (sw) { g.lineWidth = sw; g.strokeStyle = o.stroke; g.strokeText(text, 0, 1); }
      g.fillStyle = color; g.fillText(text, 0, 1);
    });
  });
}
function pillArt(word, color) { // a key flag's paper pill, centred
  return art(`pill|${word}|${color}|${FK}`, () => {
    const pw = Math.ceil((word ? textW(word, 16) : 22) + 20), ph = 28;
    return makeSprite(pw + 10, ph + 14, pw / 2 + 5, ph / 2 + 4, (g) => {
      draw.paper(g, () => draw.roundRect(g, -pw / 2, -ph / 2, pw, ph, ph / 2), color, { lw: 3 });
      if (word) { g.font = `700 16px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(word, 0, 1); }
    });
  });
}
const glowArt = () => art('glow', () => makeSprite(120, 120, 60, 60, (g) => {
  const gr = g.createRadialGradient(0, 0, 6, 0, 0, 58);
  gr.addColorStop(0, 'rgba(255, 236, 140, .95)'); gr.addColorStop(0.55, 'rgba(255, 226, 110, .45)'); gr.addColorStop(1, 'rgba(255, 226, 110, 0)');
  g.fillStyle = gr; g.fillRect(-60, -60, 120, 120);
}));

// ---- static painters
function paintBackground(g) { // a meadow at the Fair: sky, paper clouds, hills, bunting
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#b8e2fb'); sky.addColorStop(0.62, '#eef9ff'); sky.addColorStop(1, '#f6fbe9');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.lineJoin = 'round';
  for (const [x, y, s] of [[612, 168, 0.9], [902, 150, 1.1], [86, 188, 0.75]]) {
    g.save(); g.translate(x, y); g.scale(s, s);
    const puffs = () => { g.beginPath(); for (const [cx, cy, r] of [[-24, 4, 15], [0, -5, 20], [25, 4, 15]]) { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, 7); } g.rect(-28, 4, 54, 15); };
    puffs(); g.lineWidth = 6; g.strokeStyle = '#a9d4ea'; g.stroke();
    puffs(); g.fillStyle = '#ffffff'; g.fill();
    g.restore();
  }
  const hill = (y0, amp, len, ph, fillC) => {
    g.beginPath(); g.moveTo(-10, H + 10); g.lineTo(-10, y0);
    for (let x = -10; x <= W + 10; x += 12) g.lineTo(x, y0 - amp * Math.sin((x / len) * Math.PI * 2 + ph) - amp * 0.5 * Math.sin((x / (len * 0.45)) + ph * 2));
    g.lineTo(W + 10, H + 10); g.closePath();
    g.fillStyle = fillC; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(43, 34, 51, .35)'; g.stroke();
  };
  hill(398, 14, 520, 0.6, '#c9ebb0');
  // little Fair tents peeking over the far hill
  for (const [x, y, c] of [[586, 380, '#ff7ab8'], [866, 372, '#3ec7b5']]) {
    g.save(); g.translate(x, y);
    draw.paper(g, () => { g.beginPath(); g.moveTo(-26, 12); g.lineTo(0, -24); g.lineTo(26, 12); g.closePath(); }, c, { lw: 3, shadow: false });
    g.strokeStyle = 'rgba(255, 255, 255, .8)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, -22); g.lineTo(-9, 11); g.moveTo(0, -22); g.lineTo(9, 11); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -24); g.lineTo(0, -36); g.stroke();
    g.fillStyle = '#ffd35a'; g.beginPath(); g.moveTo(0, -36); g.lineTo(12, -32); g.lineTo(0, -28); g.closePath(); g.fill(); g.lineWidth = 2; g.stroke();
    g.restore();
  }
  hill(446, 10, 380, 2.1, '#a7dc86');
  g.fillStyle = 'rgba(255, 255, 255, .85)';
  for (const [x, y] of [[548, 492], [604, 520], [862, 512], [700, 528], [930, 530], [40, 520], [14, 470]]) {
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + Math.cos(k * 1.256) * 4, y + Math.sin(k * 1.256) * 4, 3, 0, 7); g.fill(); }
  }
  g.fillStyle = '#ffd35a'; for (const [x, y] of [[548, 492], [604, 520], [862, 512], [700, 528], [930, 530], [40, 520], [14, 470]]) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
  // bunting across the top
  const by = (x) => 6 + 18 * Math.sin((x / W) * Math.PI);
  g.strokeStyle = INK; g.lineWidth = 2.5; g.beginPath();
  for (let x = -10; x <= W + 10; x += 10) g[x === -10 ? 'moveTo' : 'lineTo'](x, by(x)); g.stroke();
  const flags = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#8fd3ff', '#ffb04a', '#b39cff'];
  for (let i = 0, x = 18; x < W; x += 44, i++) {
    const y0 = by(x - 12), y1 = by(x + 12);
    draw.paper(g, () => { g.beginPath(); g.moveTo(x - 12, y0); g.lineTo(x + 12, y1); g.lineTo(x, (y0 + y1) / 2 + 22); g.closePath(); }, flags[i % flags.length], { lw: 2.2, shadow: false });
  }
}
function paintDial(g) { // the cream paper dial, centred on (0, 0)
  draw.paper(g, () => { g.beginPath(); g.arc(0, 0, DIAL.base, 0, 7); }, '#e9cf9c', { lw: 4 });
  g.strokeStyle = 'rgba(160, 120, 60, .35)'; g.lineWidth = 2;
  for (let a = 0; a < 360; a += 6) { const r0 = DIAL.base - 7; g.beginPath(); g.moveTo(Math.sin(a * D2R) * r0, -Math.cos(a * D2R) * r0); g.lineTo(Math.sin(a * D2R) * (DIAL.base - 3), -Math.cos(a * D2R) * (DIAL.base - 3)); g.stroke(); }
  draw.paper(g, () => { g.beginPath(); g.arc(0, 0, DIAL.disc, 0, 7); }, '#fff8e7', { lw: 3, shadow: false });
  g.strokeStyle = 'rgba(43, 34, 51, .22)'; g.lineWidth = 3; g.setLineDash([2, 10]); g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, DIAL.ring, 0, 7); g.stroke(); g.setLineDash([]);
  g.strokeStyle = 'rgba(43, 34, 51, .08)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 112, 0, 7); g.stroke();
  draw.paper(g, () => { g.beginPath(); g.arc(0, 0, 30, 0, 7); }, '#e9cf9c', { lw: 3, shadow: false });
}
function paintPieDish(g) { // tin + scalloped crust, centred on (0, 0); the slices fill radius PIE.r
  draw.paper(g, () => { g.beginPath(); g.arc(0, 0, PIE.r + 16, 0, 7); }, '#cdbca8', { lw: 4 });
  const n = 26, r0 = PIE.r + 5, r1 = PIE.r + 13;
  draw.paper(g, () => {
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2, am = ((k - 0.5) / n) * Math.PI * 2;
      if (k === 0) g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      else g.quadraticCurveTo(Math.cos(am) * r1 * 1.04, Math.sin(am) * r1 * 1.04, Math.cos(a) * r0, Math.sin(a) * r0);
    }
    g.closePath();
  }, '#f2bd6c', { lw: 3, shadow: false });
  g.fillStyle = 'rgba(200, 130, 50, .45)';
  for (let k = 0; k < n; k++) { const a = ((k + 0.5) / n) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * (PIE.r + 8), Math.sin(a) * (PIE.r + 8), 1.8, 0, 7); g.fill(); }
}
function paintBimble(g, mood) { // Bimble's head and shoulders, head centred on (0, 0), looking left at the pie
  const FUR = '#b9b3c6', SHIRT = '#e0703a', PINK = '#ffb3c7';
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw.paper(g, () => draw.roundRect(g, -30, 20, 62, 70, 24), SHIRT, { lw: 3 });
  g.strokeStyle = 'rgba(255, 255, 255, .55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-12, 34); g.lineTo(-4, 48); g.lineTo(4, 34); g.stroke();
  const droop = mood === 'sad' ? 0.45 : 0;
  for (const [ex, ey, side] of [[-29, -24, -1], [27, -28, 1]]) {
    g.save(); g.translate(ex, ey); g.rotate(side * droop);
    draw.paper(g, () => { g.beginPath(); g.arc(0, 0, 19, 0, 7); }, FUR, { lw: 3, shadow: false });
    g.fillStyle = PINK; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill();
    g.restore();
  }
  draw.paper(g, () => { g.beginPath(); g.ellipse(0, 2, 34, 29, 0, 0, 7); }, FUR, { lw: 3.2, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.ellipse(-14, 12, 17, 12, -0.15, 0, 7); }, '#d6d0e0', { lw: 2.4, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.arc(-27, 9, 5, 0, 7); }, '#ff8fb0', { lw: 2.2, shadow: false });
  g.strokeStyle = INK; g.lineWidth = 2.6;
  if (mood === 'happy') { for (const ex of [-16, 6]) { g.beginPath(); g.arc(ex, -2, 4.4, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); } }
  else {
    g.fillStyle = INK; for (const ex of [-16, 6]) { g.beginPath(); g.arc(ex, -3, mood === 'worried' ? 4.2 : 3.6, 0, 7); g.fill(); }
    g.fillStyle = '#ffffff'; for (const ex of [-17.2, 4.8]) { g.beginPath(); g.arc(ex, -4.4, 1.3, 0, 7); g.fill(); }
    if (mood === 'sad' || mood === 'worried') { g.lineWidth = 2.4; for (const [ex, k] of [[-16, -1], [6, 1]]) { g.beginPath(); g.moveTo(ex - 5, -12 + k * 2); g.lineTo(ex + 5, -12 - k * 2); g.stroke(); } }
  }
  g.fillStyle = 'rgba(255, 110, 150, .4)'; for (const cx of [-28, 14]) { g.beginPath(); g.ellipse(cx, 6, 5, 3, 0, 0, 7); g.fill(); }
  g.lineWidth = 2.2; g.beginPath();
  if (mood === 'happy') { g.arc(-15, 15, 6, 0.15, Math.PI - 0.15); } else if (mood === 'sad') { g.arc(-15, 22, 5, Math.PI * 1.2, Math.PI * 1.8); } else { g.moveTo(-19, 18); g.quadraticCurveTo(-15, 21, -11, 18); }
  g.stroke();
  const wk = mood === 'happy' ? -0.25 : mood === 'sad' ? 0.35 : 0;
  g.strokeStyle = 'rgba(43, 34, 51, .75)'; g.lineWidth = 1.8;
  for (const k of [-1, 0, 1]) {
    g.beginPath(); g.moveTo(-30, 11 + k * 3); g.lineTo(-52, 9 + k * 7 + (k + 1.4) * wk * 12); g.stroke();
    g.beginPath(); g.moveTo(-2, 13 + k * 3); g.lineTo(20, 12 + k * 7 + (k + 1.4) * wk * 12); g.stroke();
  }
  if (mood === 'worried') { draw.paper(g, () => { g.beginPath(); g.moveTo(28, -14); g.quadraticCurveTo(36, -2, 28, 2); g.quadraticCurveTo(21, -2, 28, -14); }, '#8fd3ff', { lw: 2, shadow: false }); }
}
const bgArt = () => art('bg', () => makeSprite(W, H, 0, 0, paintBackground));
const dialArt = () => art('dial', () => makeSprite(2 * DIAL.base + 16, 2 * DIAL.base + 22, DIAL.base + 8, DIAL.base + 8, paintDial));
const dishArt = () => art('dish', () => makeSprite(2 * PIE.r + 46, 2 * PIE.r + 52, PIE.r + 23, PIE.r + 23, paintPieDish));
const bimbleArt = (mood) => art(`bimble|${mood}`, () => makeSprite(120, 150, 62, 52, (g) => paintBimble(g, mood)));

// ---- the game
function makeGame(ctx) {
  const { sfx } = ctx;

  const span = (ws) => ws.reduce((a, b) => a + b, 0) + STRIP.gap * (ws.length - 1);
  function cardRow(ws) { // card centres for these widths, the row centred on the strip
    let x = W / 2 - span(ws) / 2;
    return ws.map((w) => { const c = { x: x + w / 2, w }; x += w + STRIP.gap; return c; });
  }
  function layoutCards(S) { // one paper card per word; the font shrinks if the row would not fit
    const words = S.rd.words;
    const widths = (sz) => words.map((t) => textW(t, sz) + STRIP.pad * 2);
    let size = STRIP.size;
    while (size > 15 && span(widths(size)) > FIT) size -= 1;
    S.cardSize = size; S.cardFont = FK;
    S.cards = cardRow(widths(size));
    if (S.last) layoutResult(S);
  }
  function layoutResult(S) { // the row once 'it' has turned into what the ring heard: the sentence re-flows around it
    const ws = S.cards.map((c) => c.w), ask = S.rd.ask;
    let size = S.cardSize;
    const others = span(ws) - ws[ask];
    while (size > 14 && others + textW(S.last.text, size) + STRIP.pad * 2 > FIT) size -= 1;
    ws[ask] = textW(S.last.text, size) + STRIP.pad * 2;
    S.resSize = size;
    S.cards2 = cardRow(ws);
  }

  // a round's keys: means at T, decoy at T ± 45, the rest shuffled into T+90 … T+270; the ear starts at T + 180 ± 60
  function layoutRound(S) {
    const C = S.C;
    if (S.ri >= S.order.length) { // a pool shorter than a try: deal it again, never twice in a row
      const more = shuffle(S, C.rounds.map((_, k) => k));
      if (more.length > 1 && more[0] === S.order[S.order.length - 1]) [more[0], more[1]] = [more[1], more[0]];
      S.order.push(...more);
    }
    const rd = (S.rd = C.rounds[S.order[S.ri]]);
    const n = rd.words.length;
    const T = Math.floor(rnd(S) * 360);
    const side = rnd(S) < 0.5 ? -1 : 1;
    const base = new Array(n);
    base[rd.means] = T; base[rd.decoy] = T + side * C.decoyGap;
    const others = shuffle(S, rd.words.map((_, j) => j).filter((j) => j !== rd.means && j !== rd.decoy));
    const m = others.length;
    others.forEach((j, k) => { base[j] = T + (m === 1 ? 180 : 90 + (k * 180) / (m - 1)); });
    S.base = base.map(norm);
    // label radius alternates 160 / 188 around the ring, starting after the widest gap (the odd one out sits next to it)
    const byAngle = S.base.map((a, j) => j).sort((a, b) => S.base[a] - S.base[b]);
    let gapAt = 0, gap = -1;
    byAngle.forEach((j, k) => { const nx = S.base[byAngle[(k + 1) % n]]; const d = norm(nx - S.base[j]) || 360; if (d > gap) { gap = d; gapAt = (k + 1) % n; } });
    S.outer = new Array(n).fill(false);
    for (let k = 0; k < n; k++) S.outer[byAngle[(gapAt + k) % n]] = k % 2 === 1;
    S.theta = norm(T + 180 + (rnd(S) * 120 - 60));
    S.drift = 0;
    S.driftDir = C.spinSpeed > 0 && S.ri >= C.spinFrom - 1 ? ((S.ri - (C.spinFrom - 1)) % 2 === 0 ? S.windFirst : -S.windFirst) : 0;
    S.cols = rd.words.map((_, j) => colorOf(C, rd, j));
    S.rgb = S.cols.map(hexRgb);
    S.pale = S.rgb.map((c) => mix(c, PAPER_RGB, 0.8));
    S.flags = rd.words.map((word, j) => ({ word, phi: S.base[j], color: S.cols[j] }));
    S.w = listen(S.theta, S.base, C.sharp);
    S.top = argmax(S.w);
    S.focused = S.w[S.top] >= C.bar;
    S.fuseLeft = C.fuse;
    layoutCards(S);
  }

  function startRound(S) {
    S.stage = 'listen'; S.stageT = 0; S.last = null; S.lastTick = Infinity; S.pressing = false; S.holdT = 0;
    S.aim = null; S.ringOnArrival = false;
    S.earKick = 1;
    sfx('paper');
    if (S.driftDir && S.ri === S.C.spinFrom - 1) { // the first windy round of the try
      fx(S, { kind: 'text', text: 'Fair wind!', x: DIAL.cx, y: DIAL.cy - 52, size: 30, color: '#3ec7b5', life: 1.5 });
      sfx('pop');
    }
    if (S.driftDir) S.leaves = Array.from({ length: 6 }, (_, k) => ({ a: k * 60 + rnd(S) * 30, r: 196 + rnd(S) * 26, s: 0.8 + rnd(S) * 0.5, rot: rnd(S) * 6 }));
    else S.leaves = [];
  }

  function ring(S, slow) {
    const C = S.C, rd = S.rd, w = S.w;
    const order = w.map((_, j) => j).sort((a, b) => w[b] - w[a]);
    const a = order[0], b = order[1];
    let kind, text;
    if (slow) { kind = 'slow'; text = C.feedback.slow; }
    else if (a === rd.means && w[a] >= C.bar) { kind = 'good'; text = fill(C.feedback.good, { word: rd.words[a] }); }
    else if (w[a] >= 0.85) { kind = 'wrong'; text = fill(C.feedback.wrong, { a: rd.words[a] }); }
    else { kind = 'muddle'; text = fill(C.feedback.muddle, { a: rd.words[a], b: rd.words[b] }); }
    const blend = [0, 0, 0];
    w.forEach((v, j) => { blend[0] += v * S.rgb[j][0]; blend[1] += v * S.rgb[j][1]; blend[2] += v * S.rgb[j][2]; });
    const face = kind === 'good' ? S.cols[rd.means] : kind === 'wrong' ? S.cols[a] : kind === 'slow' ? '#d9d2e3' : rgbStr(blend);
    S.last = { kind, text, a, b, face };
    layoutResult(S);
    S.rings.push({ round: S.ri + 1, kind, wMeans: +w[rd.means].toFixed(3), top: a });
    const it = S.cards[rd.ask];
    if (kind === 'good') {
      S.good += 1;
      sfx('ding');
      burst(S, it.x, STRIP.y - 10, 22);
      burst(S, PIE.cx, PIE.cy - 40, 12);
      fx(S, { kind: 'star', x0: it.x, y0: STRIP.y - 20, x1: 880, y1: -24, life: 0.62, pin: true });
    } else {
      S.muddles += 1;
      sfx('buzz');
      S.shake = 0.32;
      fx(S, { kind: 'text', text: '✕', x: it.x, y: STRIP.y + 44, size: 34, color: '#e8566a', life: 0.8 });
    }
    fx(S, { kind: 'ring', x: DIAL.cx, y: DIAL.cy, life: 0.5, good: kind === 'good' });
    S.earKick = 1;
    S.stage = 'rung'; S.stageT = 0;
    S.delay = C.delay + (kind === 'good' ? 0 : 0.3);
  }

  // the dial's pointer zone: around the dial, never the sentence strip above it (nor the pie, the bubble, Bimble)
  function inZone(p) { const d = Math.hypot(p.x - DIAL.cx, p.y - DIAL.cy); return d >= DIAL.dead && d <= DIAL.zone && p.y > STRIP_BOTTOM; }
  const pointerAngle = (p) => norm(Math.atan2(p.x - DIAL.cx, -(p.y - DIAL.cy)) / D2R);
  const turnTo = (from, to) => ((((to - from) % 360) + 540) % 360) - 180; // the shortest signed turn, degrees

  function stepListen(S, dt, input) {
    const C = S.C;
    // ← → turn the ear; holding ramps the speed up (keys take over from the mouse)
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const tap = (input.pressed.has('left') && !input.left ? -TAP : 0) + (input.pressed.has('right') && !input.right ? TAP : 0);
    if (dir || tap) { S.aim = null; S.ringOnArrival = false; }
    if (dir) {
      if (S.holdDir !== dir) S.holdT = 0;
      S.holdT += dt;
      S.theta += dir * (C.turn0 + (C.turn1 - C.turn0) * clamp01(S.holdT / C.ramp)) * dt;
    } else S.holdT = 0;
    S.holdDir = dir;
    S.theta += tap; // a tap that came and went between two frames
    // the mouse over the dial sets where the ear should point; a press starts only on the dial, and its release
    // rings once the ear has got there
    const p = input.pointer;
    const moved = S.pLast && (Math.abs(p.x - S.pLast.x) > 0.3 || Math.abs(p.y - S.pLast.y) > 0.3);
    if (p.clicked && inZone(p)) S.pressing = true;
    if ((moved || (S.pressing && (p.clicked || p.down))) && inZone(p)) S.aim = pointerAngle(p);
    if (S.pressing && !p.down) { S.pressing = false; S.ringOnArrival = true; }
    // the ear swings toward the aim at a capped speed: the pie and the cards sweep through the words on the way
    if (S.aim !== null) { const d = turnTo(S.theta, S.aim), step = C.mouseTurn * dt; S.theta += Math.abs(d) <= step ? d : Math.sign(d) * step; }
    S.theta = norm(S.theta);
    const arrived = S.aim === null || Math.abs(turnTo(S.theta, S.aim)) < 0.5;
    let rang = false;
    if (input.pressed.has('action')) { if (arrived) rang = true; else S.ringOnArrival = true; }
    if (S.ringOnArrival && arrived) { S.ringOnArrival = false; rang = true; }
    // the Fair wind turns the whole ring of keys
    if (S.driftDir) S.drift += S.driftDir * C.spinSpeed * dt;
    for (let j = 0; j < S.flags.length; j++) S.flags[j].phi = norm(S.base[j] + S.drift);
    // the ear listens to every key at once
    S.w = listen(S.theta, S.flags.map((f) => f.phi), C.sharp);
    const top = argmax(S.w), focused = S.w[top] >= C.bar;
    if (focused && (!S.focused || top !== S.top) && S.t - (S.popAt || -1) > 0.12) { sfx('pop'); S.popAt = S.t; S.focusKick = 1; }
    S.top = top; S.focused = focused;
    // the round fuse
    S.fuseLeft = Math.max(0, C.fuse - S.stageT);
    if (S.fuseLeft <= 3) { const k = Math.ceil(S.fuseLeft); if (k >= 1 && k < S.lastTick) { S.lastTick = k; sfx('tick'); } }
    if (rang) ring(S, false);
    else if (S.fuseLeft <= 0) ring(S, true);
  }

  // ---- effects (stepped in draw, so they finish under the kit's FINISH! too)
  function fx(S, f) { S.fx.push({ t: 0, ...f }); }
  function burst(S, x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 230;
      fx(S, { kind: 'confetti', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 140, g: 560, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, color: CONFETTI[i % CONFETTI.length], life: 0.8 + Math.random() * 0.45 });
    }
  }
  function stepFx(S, dt) {
    for (const f of S.fx) {
      f.t += dt;
      if (f.vx != null) { f.x += f.vx * dt; f.y += f.vy * dt; if (f.g) f.vy += f.g * dt; }
      if (f.vr) f.rot += f.vr * dt;
      if (f.kind === 'star' && f.pin && f.t >= f.life) { f.pin = false; sfx('pin'); }
    }
    S.fx = S.fx.filter((f) => f.t < f.life);
    S.shake = Math.max(0, (S.shake || 0) - dt);
    S.earKick = Math.max(0, (S.earKick || 0) - dt * 4);
    S.focusKick = Math.max(0, (S.focusKick || 0) - dt * 5);
    for (const lf of S.leaves || []) { lf.a += S.driftDir * 46 * lf.s * dt; lf.rot += dt * 3 * lf.s; }
  }

  // ---- drawing
  function drawStrip(g, S, w, amb) {
    const rd = S.rd, cards = S.cards, pre = S.stage === 'pre', n = cards.length;
    const rung = (S.stage === 'rung' || S.stage === 'over') && S.last && S.cards2;
    const t = S.stageT;
    // after a ring the row slides apart (or together) around what 'it' became; a good ring flips first
    const flow = rung ? easeOut(clamp01((t - (S.last.kind === 'good' ? 0.15 : 0)) / 0.25)) : 0;
    const cx = (j) => (flow ? lerp(cards[j].x, S.cards2[j].x, flow) : cards[j].x);
    const cw = (j) => (flow ? lerp(cards[j].w, S.cards2[j].w, flow) : cards[j].w);
    const x0 = cx(0) - cw(0) / 2 - 18, x1 = cx(n - 1) + cw(n - 1) / 2 + 18;
    // a paper ribbon with folded tails behind the cards
    for (const [ex, s] of [[x0, -1], [x1, 1]]) draw.paper(g, () => { g.beginPath(); g.moveTo(ex - s * 8, STRIP.y - 18); g.lineTo(ex + s * 26, STRIP.y - 18); g.lineTo(ex + s * 16, STRIP.y + 3); g.lineTo(ex + s * 26, STRIP.y + 24); g.lineTo(ex - s * 8, STRIP.y + 24); g.closePath(); }, '#f3d9a4', { lw: 3, shadow: false });
    draw.paper(g, () => draw.roundRect(g, x0, STRIP.y - 26, x1 - x0, 54, 10), '#fff1cf', { lw: 3.5 });
    for (let j = 0; j < n; j++) {
      if (j === rd.ask) continue;
      const c = { x: cx(j), w: cards[j].w };
      const drop = pre ? 1 : clamp01((t - j * 0.03) / 0.22);
      if (S.stage === 'listen' && drop <= 0) continue;
      const k = pre ? 0 : 1 - (1 - w[j]) ** 2;
      let y = STRIP.y - 4 * k;
      if (S.stage === 'listen' && drop < 1) y -= (1 - easeBack(drop)) * 30;
      if (rung && S.last?.kind === 'good' && j === rd.means) y -= 18 * Math.sin(Math.PI * clamp01(t / 0.36));
      const col = pre ? '#f6e7c8' : rgbStr(mix(S.pale[j], S.rgb[j], k));
      if (!pre && w[j] > 0.2) stamp(g, glowArt(), c.x, y, Math.max(0.6, c.w / 70), 0, Math.min(0.8, w[j]));
      draw.paper(g, () => draw.roundRect(g, c.x - c.w / 2, y - STRIP.h / 2, c.w, STRIP.h, 11), col, { lw: 3.5 });
      if (!pre) stamp(g, textArt(rd.words[j], S.cardSize, INK), c.x, y + 1, 1, 0, S.stage === 'listen' ? clamp01(drop * 2) : 1);
    }
    // the 'it' card: pink and lifted; after a ring it flips (good) or wobbles (muddle) into what 'it' became
    const c = { x: cx(rd.ask), w: cards[rd.ask].w };
    let y = STRIP.y - STRIP.lift + Math.sin(amb * 3.1) * 1.5, sx = 1, rot = 0, label = rd.words[rd.ask], col = S.cols[rd.ask], wCard = c.w, size = S.cardSize;
    if (S.stage === 'listen') { const drop = clamp01((t - rd.ask * 0.03) / 0.22); y -= (1 - easeBack(drop)) * 30; }
    if (rung) {
      const L = S.last;
      let face = true;
      if (L.kind === 'good') {
        const p = clamp01(t / 0.3);
        sx = Math.abs(Math.cos(Math.PI * p));
        y -= 10 * Math.sin(Math.PI * p);
        face = p >= 0.5;
      } else rot = Math.sin(t * 34) * 0.16 * Math.exp(-3 * t);
      if (face) { label = L.text; col = L.face; size = S.resSize; wCard = lerp(cards[rd.ask].w, S.cards2[rd.ask].w, Math.max(flow, 0.35)); }
    }
    g.save(); g.translate(c.x, y); g.rotate(rot); g.scale(Math.max(0.02, sx), 1);
    if (pre) col = '#ffc2dd';
    draw.paper(g, () => draw.roundRect(g, -wCard / 2, -STRIP.h / 2 - 2, wCard, STRIP.h + 4, 12), col, { lw: 4 });
    if (!pre) blit(g, textArt(label, size, INK), 0, 1);
    g.restore();
    // the '?' bubble over 'it', ringed by the round fuse
    if (S.stage === 'listen' || pre) {
      const bx = c.x, byy = y - STRIP.h / 2 - 26;
      const frac = pre ? 1 : S.fuseLeft / S.C.fuse;
      const low = !pre && S.fuseLeft <= 3;
      const jx = low ? Math.sin(amb * 40) * 1.4 : 0;
      draw.paper(g, () => { g.beginPath(); g.moveTo(bx - 6 + jx, byy + 12); g.lineTo(bx + jx, byy + 24); g.lineTo(bx + 7 + jx, byy + 12); g.closePath(); }, PAPER, { lw: 3, shadow: false });
      g.lineWidth = 6; g.strokeStyle = 'rgba(43, 34, 51, .16)'; g.beginPath(); g.arc(bx + jx, byy, 22, 0, 7); g.stroke();
      if (frac > 0.002) {
        g.lineCap = 'round'; g.strokeStyle = S.fuseLeft <= 1.5 && !pre ? '#e8566a' : low ? '#ff9a4a' : '#3ec7b5';
        g.beginPath(); g.arc(bx + jx, byy, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
        if (!pre) { // the spark at the burning end
          const ea = -Math.PI / 2 + frac * Math.PI * 2, ex = bx + jx + Math.cos(ea) * 22, ey = byy + Math.sin(ea) * 22;
          const fl = 1 + Math.sin(amb * 38) * 0.2;
          g.save(); g.translate(ex, ey); g.rotate(amb * 6); g.scale(fl, fl);
          g.fillStyle = low ? '#ff6a3a' : '#ffc94a'; g.strokeStyle = INK; g.lineWidth = 1.8;
          g.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = k % 2 ? 3.4 : 8; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.stroke();
          g.restore();
        }
      }
      draw.paper(g, () => { g.beginPath(); g.arc(bx + jx, byy, 16, 0, 7); }, PAPER, { lw: 3, shadow: false });
      blit(g, textArt('?', 22, INK), bx + jx, byy + 1);
    }
  }

  function drawDial(g, S, theta, w, amb) {
    const pre = S.stage === 'pre', n = S.flags.length, t = S.stageT;
    blit(g, dialArt(), DIAL.cx, DIAL.cy);
    // the wind's paper leaves circling the dial
    for (const lf of S.leaves || []) {
      const [lx, ly] = polar(lf.a, lf.r);
      g.save(); g.translate(lx, ly); g.rotate(lf.rot);
      draw.paper(g, () => { g.beginPath(); g.ellipse(0, 0, 9, 4.5, 0, 0, 7); }, '#8fcf5a', { lw: 2, shadow: false });
      g.strokeStyle = 'rgba(43, 34, 51, .6)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.stroke();
      g.restore();
    }
    // the listening cone (decoration) and the sound each key sends in, as strong as its slice
    const a0 = canvasAngle(theta - CONE.half), a1 = canvasAngle(theta + CONE.half);
    g.fillStyle = 'rgba(62, 199, 181, .16)'; g.beginPath(); g.arc(DIAL.cx, DIAL.cy, CONE.r1, a0, a1); g.arc(DIAL.cx, DIAL.cy, CONE.r0, a1, a0, true); g.closePath(); g.fill();
    if (!pre) {
      g.lineCap = 'round'; g.lineWidth = 3.2;
      for (let j = 0; j < n; j++) {
        if (w[j] < 0.03) continue;
        const ph = S.flags[j].phi;
        for (let k = 0; k < 2; k++) {
          const q = (amb * 0.9 + k * 0.5 + j * 0.13) % 1;
          const r = lerp(146, 104, q), span = (6 + 6 * (1 - q)) * D2R;
          g.strokeStyle = `rgba(43, 34, 51, ${(0.6 * Math.min(1, w[j] * 1.3) * Math.sin(Math.PI * q)).toFixed(3)})`;
          g.beginPath(); g.arc(DIAL.cx, DIAL.cy, r, canvasAngle(ph) - span, canvasAngle(ph) + span); g.stroke();
        }
      }
    }
    // key flags: a pin on the ring and a paper pill with the word (labels alternate radius 160 / 188)
    for (let j = 0; j < n; j++) {
      const f = S.flags[j], ph = f.phi, outer = S.outer[j];
      const [px, py] = polar(ph, DIAL.ring);
      const [lx, ly] = polar(ph, outer ? DIAL.rOut : DIAL.rIn);
      const pop = pre ? 1 : S.stage === 'listen' ? easeBack(clamp01((t - 0.06 - j * 0.025) / 0.2)) : 1;
      if (pop <= 0) continue;
      if (!pre && w[j] > 0.05) stamp(g, glowArt(), lx, ly, 0.8 + 0.5 * w[j] + (j === S.top ? 0.2 * (S.focusKick || 0) : 0), 0, Math.min(1, w[j] * 1.2));
      if (outer) { g.strokeStyle = INK; g.lineWidth = 2.5; g.beginPath(); g.moveTo(px, py); g.lineTo(lx + (px - lx) * 0.45, ly + (py - ly) * 0.45); g.stroke(); }
      draw.paper(g, () => { g.beginPath(); g.arc(px, py, 4.5, 0, 7); }, pre ? '#e9cf9c' : f.color, { lw: 2.2, shadow: false });
      const flutter = S.driftDir ? Math.sin(amb * 7 + j * 1.7) * 0.07 : 0;
      let sc = pop * (j === S.top && S.focused ? 1 + 0.12 * (S.focusKick || 0) : 1);
      if (S.stage === 'rung' && S.last?.kind === 'good' && j === S.rd.means) sc *= 1 + 0.3 * Math.sin(Math.PI * clamp01(t / 0.4));
      stamp(g, pre ? pillArt('', '#fff1cf') : pillArt(f.word, f.color), lx, ly, sc, flutter);
    }
    drawEar(g, S, theta);
  }

  function earPath(g) { // in the ear's frame: the bell points up (-y)
    g.beginPath();
    g.moveTo(-8, -16); g.lineTo(-6, -52);
    g.quadraticCurveTo(-9, -76, -31, -EAR.bell);
    g.lineTo(31, -EAR.bell);
    g.quadraticCurveTo(9, -76, 6, -52);
    g.lineTo(8, -16); g.closePath();
  }
  function drawEar(g, S, theta) {
    const kick = S.earKick || 0, s = 1 + 0.16 * Math.sin(Math.PI * kick) * kick;
    const rot = theta * D2R + Math.sin((1 - kick) * 18) * 0.08 * kick;
    g.save(); g.translate(DIAL.cx, DIAL.cy + 5); g.rotate(rot); g.scale(s, s);
    earPath(g); g.fillStyle = 'rgba(43, 34, 51, .22)'; g.fill();
    g.restore();
    g.save(); g.translate(DIAL.cx, DIAL.cy); g.rotate(rot); g.scale(s, s);
    g.lineJoin = 'round';
    earPath(g); g.fillStyle = '#3ec7b5'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = INK; g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, .6)'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-3, -22); g.lineTo(-2.5, -52); g.quadraticCurveTo(-5, -72, -20, -86); g.stroke();
    g.fillStyle = '#1f8f80'; g.beginPath(); g.ellipse(0, -EAR.bell, 31, 7.5, 0, 0, 7); g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    g.fillStyle = '#2fa595'; g.beginPath(); g.arc(0, 0, 17, 0, 7); g.fill(); g.lineWidth = 3.5; g.stroke();
    g.fillStyle = '#ffd35a'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.lineWidth = 2.2; g.stroke();
    g.restore();
  }

  function drawPie(g, S, w, amb) {
    const pre = S.stage === 'pre', n = w.length;
    const bob = Math.sin(amb * 1.6) * 1.2;
    const cx = PIE.cx, cy = PIE.cy + bob, r = PIE.r * (1 + 0.04 * (S.focusKick || 0));
    blit(g, dishArt(), PIE.cx, PIE.cy + bob);
    const top = argmax(w), lift = !pre && w[top] >= S.C.bar;
    const geo = [];
    let a = -Math.PI / 2;
    for (let j = 0; j < n; j++) { const sw = w[j] * Math.PI * 2; geo.push([a, a + sw]); a += sw; }
    const slice = (j, ox, oy) => { const [s0, s1] = geo[j]; g.beginPath(); g.moveTo(cx + ox, cy + oy); g.arc(cx + ox, cy + oy, r, s0, s1); g.closePath(); };
    g.lineJoin = 'round';
    for (let j = 0; j < n; j++) {
      if ((lift && j === top) || geo[j][1] - geo[j][0] < 0.004) continue;
      slice(j, 0, 0);
      g.fillStyle = pre ? (j % 2 ? '#f6e1b6' : '#fbefd2') : S.cols[j]; g.fill();
      g.lineWidth = 2.2; g.strokeStyle = INK; g.stroke();
    }
    let lo = [0, 0];
    if (lift) { // the focused slice lifts out (focused, not 'correct')
      const mid = (geo[top][0] + geo[top][1]) / 2, d = 9 + 3 * (S.focusKick || 0);
      lo = [Math.cos(mid) * d, Math.sin(mid) * d];
      if (geo[top][1] - geo[top][0] > Math.PI * 1.97) lo = [0, -d * 0.6];
      slice(top, lo[0] + 3, lo[1] + 6); g.fillStyle = 'rgba(43, 34, 51, .25)'; g.fill();
      slice(top, lo[0], lo[1]); g.fillStyle = S.cols[top]; g.fill(); g.lineWidth = 4.5; g.strokeStyle = INK; g.stroke();
    }
    g.lineWidth = 3; g.strokeStyle = 'rgba(43, 34, 51, .5)'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    if (pre) return;
    for (let j = 0; j < n; j++) {
      if (w[j] < 0.08) continue;
      const mid = (geo[j][0] + geo[j][1]) / 2, off = lift && j === top ? lo : [0, 0];
      const rr = w[j] > 0.7 ? 0 : r * 0.6; // a slice that is most of the pie wears its word in the middle
      stamp(g, textArt(S.flags[j].word, 16, INK, { stroke: PAPER, sw: 5 }), cx + off[0] + Math.cos(mid) * rr, cy + off[1] + Math.sin(mid) * rr);
    }
  }

  function drawBubble(g, S, w, amb) { // 'it = …': the blend of the values, what 'it' would turn into if you rang now
    const pre = S.stage === 'pre', rd = S.rd;
    const order = w.map((_, j) => j).sort((a, b) => w[b] - w[a]);
    const a = order[0], b = order[1];
    const ask = rd.words[rd.ask];
    const sA = textArt(`${ask} =`, 26, INK);
    const word = pre ? '?' : rd.words[a];
    const sB = textArt(word, 30, pre ? '#fffdf6' : S.cols[a], { stroke: INK, sw: 6 });
    const show2 = !pre && w[b] > 0.15;
    const sC = show2 ? textArt(`+${rd.words[b]}`, 18, INK) : null;
    const wA = textW(`${ask} =`, 26), wB = textW(word, 30), wC = show2 ? textW(`+${rd.words[b]}`, 18) : 0;
    const blob = 40;
    const target = 30 + blob + wA + 10 + wB + (show2 ? 8 + wC : 0);
    S.bubW = S.bubW ? lerp(S.bubW, target, 0.3) : target;
    const bw = S.bubW, bh = BUB.h, x0 = BUB.x - bw / 2, y = BUB.y;
    draw.paper(g, () => { g.beginPath(); g.moveTo(BUB.x - 12, y - bh / 2 + 2); g.lineTo(BUB.x, y - bh / 2 - 22); g.lineTo(BUB.x + 12, y - bh / 2 + 2); g.closePath(); }, PAPER, { lw: 3.5, shadow: false });
    draw.paper(g, () => draw.roundRect(g, x0, y - bh / 2, bw, bh, bh / 2), PAPER, { lw: 3.5 });
    g.fillStyle = PAPER; g.beginPath(); g.moveTo(BUB.x - 9.5, y - bh / 2 + 3); g.lineTo(BUB.x, y - bh / 2 - 17); g.lineTo(BUB.x + 9.5, y - bh / 2 + 3); g.closePath(); g.fill();
    // the blob: every word's colour mixed by its slice (the weighted sum of the values)
    const bl = [0, 0, 0];
    if (pre) bl.splice(0, 3, ...hexRgb('#d9d2e3'));
    else w.forEach((v, j) => { bl[0] += v * S.rgb[j][0]; bl[1] += v * S.rgb[j][1]; bl[2] += v * S.rgb[j][2]; });
    const bx = x0 + 16 + blob / 2, wob = 1 + Math.sin(amb * 5) * 0.04;
    g.save(); g.translate(bx, y); g.scale(wob, 1 / wob);
    draw.paper(g, () => { g.beginPath(); g.moveTo(-17, 8); g.quadraticCurveTo(-19, -17, 0, -17); g.quadraticCurveTo(19, -17, 17, 8); g.quadraticCurveTo(17, 15, 0, 15); g.quadraticCurveTo(-17, 15, -17, 8); g.closePath(); }, rgbStr(bl), { lw: 3, shadow: false });
    g.fillStyle = INK; for (const ex of [-6, 6]) { g.beginPath(); g.arc(ex, -3, 2.6, 0, 7); g.fill(); }
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.arc(0, 3, 4, 0.2, Math.PI - 0.2); g.stroke();
    g.restore();
    let x = x0 + 16 + blob + 8;
    blit(g, sA, x + wA / 2, y + 1); x += wA + 10;
    blit(g, sB, x + wB / 2, y + 1); x += wB + 8;
    if (sC) blit(g, sC, x + wC / 2, y + 3);
  }

  function drawBimble(g, S, amb) {
    let mood = 'idle';
    if (S.stage === 'rung' || S.stage === 'over') mood = S.last?.kind === 'good' ? 'happy' : 'sad';
    else if (S.stage === 'listen' && S.fuseLeft <= 3) mood = 'worried';
    const hop = mood === 'happy' ? Math.abs(Math.sin(S.stageT * 9)) * 8 * Math.exp(-S.stageT * 1.5) : 0;
    stamp(g, bimbleArt(mood), BIMBLE.x, BIMBLE.y + Math.sin(amb * 2.2) * 1.6 - hop, 1, mood === 'sad' ? 0.05 : Math.sin(amb * 1.3) * 0.02);
  }

  function drawFx(g, S) {
    for (const f of S.fx) {
      const p = clamp01(f.t / f.life);
      if (f.kind === 'confetti') {
        g.save(); g.translate(f.x, f.y); g.rotate(f.rot); g.globalAlpha = 1 - clamp01((p - 0.7) / 0.3);
        g.fillStyle = f.color; g.fillRect(-4.5, -2.5, 9, 5); g.restore();
      } else if (f.kind === 'text') {
        stamp(g, textArt(f.text, f.size, f.color, { stroke: INK, sw: Math.max(5, f.size * 0.22) }), f.x, f.y - 26 * easeOut(p), p < 0.18 ? easeBack(p / 0.18) : 1, 0, 1 - clamp01((p - 0.7) / 0.3));
      } else if (f.kind === 'ring') {
        g.save(); g.globalAlpha = 1 - p; g.strokeStyle = f.good ? '#3ec7b5' : '#e8566a'; g.lineWidth = 6 * (1 - p) + 2;
        g.beginPath(); g.arc(f.x, f.y, 30 + 140 * easeOut(p), 0, 7); g.stroke(); g.restore();
      } else if (f.kind === 'star') {
        const q = easeOut(p), x = lerp(f.x0, f.x1, q), y = lerp(f.y0, f.y1, q) - Math.sin(Math.PI * q) * 70;
        g.save(); g.translate(x, y); g.rotate(p * 5); g.scale(1.2 - 0.5 * p, 1.2 - 0.5 * p);
        draw.paper(g, () => { g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, rr = k % 2 ? 7.5 : 17; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); }, '#ffd35a', { lw: 3, shadow: false });
        g.restore();
      }
    }
  }

  return {
    goal: "Turn the ear till each 'it' hears who it means. Then ring!",
    controls: [['← →', 'turn ear'], ['mouse', 'aim'], ['Space / click', 'ring']],
    duration: 55,
    setup(S, spec) {
      const C = (S.C = config(spec));
      spec.loseText = ctx.loseText; // a time-up on the last try swapped it
      ctx.tries += 1;
      S.seed = (Number.isFinite(spec.seed) ? spec.seed + ctx.tries * 7919 : Math.floor(Math.random() * 4294967296)) >>> 0;
      S.rng = S.seed;
      S.order = shuffle(S, C.rounds.map((_, k) => k));
      S.windFirst = rnd(S) < 0.5 ? -1 : 1;
      Object.assign(S, { stage: 'pre', stageT: 0, ri: 0, good: 0, muddles: 0, result: null, rings: [], fx: [], leaves: [],
        shake: 0, holdT: 0, holdDir: 0, pressing: false, pLast: null, last: null, delay: 0, bubW: 0, earKick: 0, focusKick: 0,
        aim: null, ringOnArrival: false,
        geo: { dial: { cx: DIAL.cx, cy: DIAL.cy, ring: DIAL.ring, zone: DIAL.zone, top: STRIP_BOTTOM }, pie: { cx: PIE.cx, cy: PIE.cy, r: PIE.r }, strip: { y: STRIP.y, bottom: STRIP_BOTTOM } } });
      layoutRound(S); // round 1, shown face down behind the rules card and the countdown
    },
    update(S, dt, input) {
      S.stageT += dt;
      if (S.stage === 'pre') { S.stageT = 0; startRound(S); }
      if (S.stage === 'listen') stepListen(S, dt, input);
      else if (S.stage === 'rung' && S.stageT >= S.delay) {
        if (S.good >= S.C.toWin) { S.stage = 'over'; S.result = 'win'; }
        else if (S.muddles >= S.C.maxMuddles) { S.stage = 'over'; S.result = 'lose'; }
        else { S.ri += 1; layoutRound(S); startRound(S); }
      }
      const p = input.pointer;
      S.pLast = { x: p.x, y: p.y };
      ctx.setCursor(S.stage === 'listen' && ctx.pointerIn() && inZone(p) ? 'pointer' : '');
    },
    draw(g, S) {
      const now = performance.now() / 1000;
      const rdt = Math.min(0.05, Math.max(0, now - (ctx.lastDraw || now)));
      ctx.lastDraw = now;
      stepFx(S, rdt);
      FK = fontKey();
      if (S.cardFont !== FK) layoutCards(S);
      let theta = S.theta, w = S.w;
      if (S.stage === 'pre') { theta = norm(S.theta + Math.sin(now * 0.8) * 70); w = listen(theta, S.base, S.C.sharp); }
      g.save();
      if (S.shake > 0) { const k = (S.shake / 0.32) * 7; g.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k); }
      blit(g, bgArt());
      drawDial(g, S, theta, w, now);
      drawPie(g, S, w, now);
      drawBimble(g, S, now);
      drawBubble(g, S, w, now);
      drawStrip(g, S, w, now);
      drawFx(g, S);
      g.restore();
    },
    result(S) { return S.result; },
    timeUp(S, spec) {
      if (S.good >= S.C.toWin) return 'win';
      spec.loseText = ctx.timeUpText;
      return 'lose';
    },
    hud(S, spec) {
      return fill(spec.hud || '★ {good}/{toWin}  ✕ {muddles}/{maxMuddles}', { good: S.good, toWin: S.C.toWin, muddles: S.muddles, maxMuddles: S.C.maxMuddles });
    },
  };
}

export default {
  mount(container, spec = {}, api = {}) {
    let canvas = null, pointerIn = false;
    const own = { ...spec }; // the kit reads loseText from this copy, so a time-up can say so
    const ctx = {
      tries: 0, lastDraw: 0,
      loseText: spec.loseText ?? "Too muddled! 'It' became a pie-frog.",
      timeUpText: spec.timeUpText ?? "Time's up! The Fair can't wait.",
      sfx: (n) => { try { (api.sfx || gameSfx)(n); } catch { /* sound is optional */ } },
      pointerIn: () => pointerIn,
      setCursor: (c) => { if (canvas && canvas.style.cursor !== c) canvas.style.cursor = c; },
    };
    const handle = runMinigame(container, own, api, makeGame(ctx));
    canvas = container.querySelector('.mg-canvas');
    const enter = () => { pointerIn = true; }, leave = () => { pointerIn = false; };
    canvas?.addEventListener('pointermove', enter); canvas?.addEventListener('pointerdown', enter); canvas?.addEventListener('pointerleave', leave);
    return {
      destroy() {
        canvas?.removeEventListener('pointermove', enter); canvas?.removeEventListener('pointerdown', enter); canvas?.removeEventListener('pointerleave', leave);
        handle.destroy();
      },
    };
  },
};
