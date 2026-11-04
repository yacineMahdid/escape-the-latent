// Raft Rush (Pairadise / CLIP, challenge m1): a Mario Party-style lagoon race, Mushroom Mix-up style.
// Mrs. Pomelo holds up a caption card while a fuse burns under it; hop onto the raft whose photo fits the
// WHOLE caption. Fuse out: every other raft sinks, and the true photo glues to the card into a postcard
// that pins to the clothesline. Skipper Brine races on the same rafts with his sticker crate (one fixed
// word per photo): he takes the plainest photo with his word, so he only wins the single-thing rounds,
// and dives into the sea when he has no sticker at all.
// The paper (CLIP, §2.3): each round is one caption against a batch of photos; the true pair is pulled
// together and every other pairing (the negatives) sinks; the batch grows from 3 to 6 rafts (CLIP's is
// 32,768). Abstract, §1, §2.1: whole natural-language captions beat a fixed set of predetermined labels.
// Spec: content/extra-draft/clip.json, challenge m1. Test hooks on container.__mg.state: round (0-7),
// rafts [{ photo, answer, x }], at, glued, splashes, brine.score,
// stage ('pre' | 'intro' | 'fuse' | 'resolve' | 'over'), stageT, fuse (this round's seconds).
import { runMinigame, draw } from './kit.js';
import { getSave } from '../game/save.js';
import { sfx as gameSfx } from '../game/sfx.js';

const W = 960, H = 540;
const INK = '#2b2233';
const PAPER = '#fffdf6';
const FONT = 'Fredoka, "Trebuchet MS", Verdana, sans-serif';
const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif';

// ---- layout (kit units)
const HORIZON = 170;
const WATERLINE = 418;                                   // the lagoon surface in front of the rafts
const LINE = { x0: 100, x1: 946, y: 26, sag: 8 };        // clothesline
const PEG_GAP = 78;
const CARD = { cx: 480, cy: 110, w: 600, h: 60 };
const FUSE = { x0: 200, x1: 760, y: 152 };
const DECK = { y: 400, w: 112, h: 24 };                  // y = deck top, where riders stand
const POL = { w: 104, h: 120, pic: 92, cy: 296 };        // polaroid on its mast (y 236-356)
const ROW = { x0: 110, w: 740 };
const PAIR = { x: 806, y: 110, s: 0.6, rot: 0.07 };      // where the true photo sticks to the card
const RIDER_DX = 18;                                     // the Speck left of the mast, Brine right of it
const POST = { speck: 32, brine: 68 };                   // waiting spots on the Stilt Post landing

// ---- timings (s)
const T = {
  intro: 0.3, introFirst: 0.5, sink: 0.5, red: 3,
  lift0: 0.12, lift1: 0.55, morph0: 0.85, morph1: 1.22, fade0: 1.15, resolve: 1.4,
  hop: 0.18, longHop: 0.28, repeatAfter: 0.25, repeatEvery: 0.2,
  brineWait: 1.2, brineStep: 0.3, brineHop: 0.2,
};
const SLOTS = ['under', 'face', 'top', 'corner'];
const SLOT_PX = { main: 52, under: 48, face: 26, top: 30, corner: 22 };
const STICKERS = { '🐢': 'turtle', '🦀': 'crab', '⛵': 'boat', '🥥': 'coconut', '🐟': 'fish', '🐙': 'octopus' };
const FALLBACK_ROUNDS = [
  { caption: 'Turtle on the beach!', time: 5, photos: [{ main: '🐢', bg: 'sand', answer: true }, { main: '🦀', bg: 'sand' }, { main: '⛵', bg: 'sea' }] },
  { caption: 'My crab in his best top hat', time: 4.7, photos: [{ main: '🦀', bg: 'sand', top: '🎩', answer: true }, { main: '🦀', bg: 'sand' }, { main: '🐢', bg: 'sand', top: '🎩' }] },
];

// ---- small math
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const raftX = (i, n) => ROW.x0 + ((i + 0.5) * ROW.w) / n;
const pegX = (k, n) => 480 + (k - (n - 1) / 2) * PEG_GAP;
const lineY = (x) => { const t = clamp01((x - LINE.x0) / (LINE.x1 - LINE.x0)); return LINE.y + 4 * LINE.sag * t * (1 - t); };

function rnd(S) { // mulberry32 on S.rng, so every try replays from its own seed
  let t = (S.rng = (S.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- Brine's rule: a sticker word for the main thing only; the plainest candidate wins, ties go left
const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const filled = (p) => SLOTS.filter((k) => p[k]).length;
export function brinePick(rafts, caption, stickers = STICKERS) {
  const w = words(caption);
  let best = -1;
  rafts.forEach((r, i) => {
    const word = stickers[r.photo.main];
    if (!word || !w.has(String(word).toLowerCase())) return;
    if (best < 0 || filled(r.photo) < filled(rafts[best].photo)) best = i;
  });
  return best;
}

function speckColors() {
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  let c = null;
  try { c = getSave()?.character; } catch { /* no save */ }
  c = c && typeof c === 'object' ? c : {};
  return { skin: hex(c.skin, '#e8b796'), hair: hex(c.hairColor, '#3b2a20'), top: hex(c.topColor, '#4f86d8'),
    bottom: hex(c.bottomColor, '#3a3a5a'), bald: c.hairStyle === 'bald' };
}

// ---- emoji stickers: drawn once per size into an offscreen canvas with a white cut-paper edge
const DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
const sprites = new Map();
let pirateSplits = null;
function emojiSprite(ch, size) {
  const key = `${ch}|${size}`;
  let sp = sprites.get(key);
  if (sp) return sp;
  const d = Math.ceil(size * 1.5) + 8;
  const px = Math.ceil(d * DPR);
  const glyph = document.createElement('canvas'); glyph.width = glyph.height = px;
  const gg = glyph.getContext('2d'); gg.scale(DPR, DPR);
  gg.font = `${size}px ${EMOJI_FONT}`; gg.textAlign = 'center'; gg.textBaseline = 'middle';
  gg.fillText(ch, d / 2, d / 2 + size * 0.06);
  const sil = document.createElement('canvas'); sil.width = sil.height = px;
  const sg = sil.getContext('2d'); sg.drawImage(glyph, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#ffffff'; sg.fillRect(0, 0, px, px);
  const out = document.createElement('canvas'); out.width = out.height = px;
  const og = out.getContext('2d');
  const r = Math.max(1.6, size * 0.055) * DPR;
  for (let a = 0; a < 12; a++) og.drawImage(sil, Math.cos((a / 12) * Math.PI * 2) * r, Math.sin((a / 12) * Math.PI * 2) * r);
  og.drawImage(glyph, 0, 0);
  sp = { c: out, d };
  sprites.set(key, sp);
  return sp;
}
function pirateFlagSplits() { // 🏴‍☠️ is one glyph only where the font has the ZWJ sequence
  if (pirateSplits === null) {
    try {
      const m = document.createElement('canvas').getContext('2d');
      m.font = `40px ${EMOJI_FONT}`;
      pirateSplits = m.measureText('🏴‍☠️').width > m.measureText('🏴').width * 1.4;
    } catch { pirateSplits = false; }
  }
  return pirateSplits;
}
function drawEmoji(g, ch, x, y, size) {
  if (globalThis.__rrSkip?.has('emoji')) return; // TEMP DEBUG
  if (ch === '🏴‍☠️' && pirateFlagSplits()) { drawPirateFlag(g, x, y, size); return; }
  const sp = emojiSprite(ch, Math.round(size));
  g.drawImage(sp.c, x - sp.d / 2, y - sp.d / 2, sp.d, sp.d);
}
function drawPirateFlag(g, x, y, size) { // paper fallback: black pennant on a stick with a white dot
  const s = size / 30;
  g.save(); g.translate(x, y); g.scale(s, s);
  g.lineWidth = 3; g.strokeStyle = INK;
  g.beginPath(); g.moveTo(-9, 14); g.lineTo(-9, -15); g.stroke();
  draw.paper(g, () => { g.beginPath(); g.moveTo(-8, -14); g.lineTo(13, -9); g.lineTo(-8, 0); g.closePath(); }, '#1d1a22', { lw: 2.5, shadow: false });
  g.fillStyle = '#fff'; g.beginPath(); g.arc(-1, -8, 2.6, 0, 7); g.fill();
  g.restore();
}

// ---- photos
function drawBg(g, bg, size) { // centred on (0, 0)
  const h = size / 2, s = size / 100;
  if (bg === 'sea') {
    g.fillStyle = '#8fdcf0'; g.fillRect(-h, -h, size, size);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3 * s; g.lineCap = 'round';
    for (const [wx, wy] of [[-30, 24], [14, 38]]) {
      g.beginPath(); g.moveTo((wx - 14) * s, wy * s); g.quadraticCurveTo((wx - 7) * s, (wy - 6) * s, wx * s, wy * s); g.quadraticCurveTo((wx + 7) * s, (wy + 6) * s, (wx + 14) * s, wy * s); g.stroke();
    }
  } else if (bg === 'sunset') {
    const sky = g.createLinearGradient(0, -h, 0, h); sky.addColorStop(0, '#ffb35a'); sky.addColorStop(1, '#ff7ab8');
    g.fillStyle = sky; g.fillRect(-h, -h, size, size);
    g.fillStyle = '#ffe06a'; g.beginPath(); g.arc(0, 20 * s, 24 * s, Math.PI, 0); g.fill();
    g.fillStyle = 'rgba(160, 60, 120, .38)'; g.fillRect(-h, 20 * s, size, h - 20 * s);
    g.strokeStyle = 'rgba(255, 224, 106, .8)'; g.lineWidth = 2.5 * s;
    for (const [lx, ly, lw] of [[-14, 28, 28], [-8, 35, 16]]) { g.beginPath(); g.moveTo(lx * s, ly * s); g.lineTo((lx + lw) * s, ly * s); g.stroke(); }
  } else if (bg === 'night') {
    g.fillStyle = '#2a3a6a'; g.fillRect(-h, -h, size, size);
    g.fillStyle = '#ffffff';
    for (const [sx, sy, r] of [[-34, -32, 2.6], [30, -36, 2.2], [-6, -42, 1.8], [38, -6, 2.4], [-40, 6, 2]]) { g.beginPath(); g.arc(sx * s, sy * s, r * s, 0, 7); g.fill(); }
  } else { // sand
    g.fillStyle = '#f7e2a6'; g.fillRect(-h, -h, size, size);
    g.fillStyle = '#e8c77e';
    for (const [dx, dy] of [[-34, -30], [24, -38], [-14, 34], [36, 20], [-40, 12], [10, 42], [40, -14]]) { g.beginPath(); g.arc(dx * s, dy * s, 2.6 * s, 0, 7); g.fill(); }
  }
}
function drawPicture(g, photo, size) { // the 100 x 100 picture of the spec, scaled to size, centred on (0, 0)
  g.save();
  g.beginPath(); g.rect(-size / 2, -size / 2, size, size); g.clip();
  drawBg(g, photo.bg, size);
  const s = size / 100;
  g.scale(s, s);
  const my = photo.under ? -10 : 6;
  if (photo.under) drawEmoji(g, photo.under, 0, 28, SLOT_PX.under);
  drawEmoji(g, photo.main, 0, my, SLOT_PX.main);
  if (photo.face) drawEmoji(g, photo.face, 0, my - 10, SLOT_PX.face);
  if (photo.top) drawEmoji(g, photo.top, 0, my - 32, SLOT_PX.top);
  if (photo.corner) drawEmoji(g, photo.corner, 33, -33, SLOT_PX.corner);
  g.restore();
}
function drawPolaroid(g, photo, x, y, s, rot, o = {}) {
  const w = POL.w, h = POL.h, pic = POL.pic, b = (w - pic) / 2;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  if (o.alpha != null) g.globalAlpha *= o.alpha;
  if (o.glow) {
    const gr = g.createRadialGradient(0, 0, 20, 0, 0, 104);
    gr.addColorStop(0, `rgba(255, 226, 110, ${0.85 * o.glow})`); gr.addColorStop(1, 'rgba(255, 226, 110, 0)');
    g.fillStyle = gr; g.fillRect(-110, -110, 220, 220);
  }
  if (o.mark === 'sel') { g.lineWidth = 7; g.strokeStyle = '#ff7ab8'; draw.roundRect(g, -w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 10); g.stroke(); }
  else if (o.mark === 'hover') { g.setLineDash([9, 6]); g.lineWidth = 3.5; g.strokeStyle = '#ff7ab8'; draw.roundRect(g, -w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 10); g.stroke(); g.setLineDash([]); }
  draw.paper(g, () => draw.roundRect(g, -w / 2, -h / 2, w, h, 5), '#ffffff', { lw: 3.5, shadow: o.shadow !== false });
  g.save(); g.translate(0, -h / 2 + b + pic / 2); drawPicture(g, photo, pic); g.restore();
  g.lineWidth = 2; g.strokeStyle = INK; g.strokeRect(-pic / 2, -h / 2 + b, pic, pic);
  if (o.peg) draw.paper(g, () => draw.roundRect(g, -5, -h / 2 - 11, 10, 19, 3), '#d9a066', { lw: 2.5, shadow: false });
  g.restore();
}
// glued postcard on the line: 56 x 38, a tiny photo and two ink lines; (px, py) is its peg
function postcardGeom(px, py) { return { cx: px, cy: py + 23, w: 56, h: 38, phx: px - 13, phy: py + 23, phs: 0.26 }; }
function drawPostcardBody(g, cx, cy, w, h, lineAlpha) {
  draw.paper(g, () => draw.roundRect(g, cx - w / 2, cy - h / 2, w, h, Math.min(12, h * 0.22)), PAPER, { lw: Math.max(2.5, Math.min(4, w / 150)), shadow: false });
  if (lineAlpha > 0) {
    g.save(); g.globalAlpha *= lineAlpha; g.strokeStyle = INK; g.lineWidth = 2.2; g.lineCap = 'round';
    const x0 = cx + w * 0.08, x1 = cx + w * 0.4;
    g.beginPath(); g.moveTo(x0, cy - h * 0.14); g.lineTo(x1, cy - h * 0.14); g.moveTo(x0, cy + h * 0.12); g.lineTo(x1 - w * 0.08, cy + h * 0.12); g.stroke();
    g.restore();
  }
}

// ---- characters
function drawSpeck(g, x, y, o) {
  const C = o.colors, f = o.face || 1, sq = o.squash || 0;
  g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(1 + 0.16 * sq, 1 - 0.2 * sq);
  g.lineJoin = 'round';
  g.fillStyle = INK;
  for (const sx of [-5, 5]) { g.beginPath(); g.ellipse(sx, -2, 4.6, 2.9, 0, 0, 7); g.fill(); }
  for (const sx of [-6.2, 1.6]) draw.paper(g, () => draw.roundRect(g, sx, -11, 4.6, 9, 2), C.bottom, { lw: 2, shadow: false });
  for (const side of [-1, 1]) {
    g.save(); g.translate(side * 9, -23); g.rotate(side * (o.armsUp ? -2.5 : 0.35) + (o.wave ? Math.sin(o.wave) * 0.4 * side : 0));
    draw.paper(g, () => draw.roundRect(g, -2.6, -1, 5.2, 11, 2.6), C.top, { lw: 2, shadow: false });
    g.fillStyle = C.skin; g.beginPath(); g.arc(0, 10.5, 2.8, 0, 7); g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();
    g.restore();
  }
  draw.paper(g, () => draw.roundRect(g, -10, -27.5, 20, 19, 7), C.top, { lw: 2.6, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.arc(0, -37.5, 12, 0, 7); }, C.skin, { lw: 2.6, shadow: false });
  if (!C.bald) {
    draw.paper(g, () => { g.beginPath(); g.arc(0, -37.5, 12.4, Math.PI, 0); g.quadraticCurveTo(7 * f, -38, 1 * f, -41); g.quadraticCurveTo(-7, -38.5, -12.4, -37.5); g.closePath(); }, C.hair, { lw: 2.4, shadow: false });
  }
  g.fillStyle = INK;
  if (o.sad) { g.lineWidth = 1.8; g.strokeStyle = INK; for (const ex of [-4.2, 4.2]) { g.beginPath(); g.moveTo(ex + f * 1.4 - 2, -36); g.lineTo(ex + f * 1.4 + 2, -34.5); g.stroke(); } }
  else for (const ex of [-4.2, 4.2]) { g.beginPath(); g.arc(ex + f * 1.4, -35.5, 1.9, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(255, 122, 150, .5)';
  for (const ex of [-7.5, 7.5]) { g.beginPath(); g.ellipse(ex + f, -31.5, 2.4, 1.6, 0, 0, 7); g.fill(); }
  g.strokeStyle = INK; g.lineWidth = 1.7; g.beginPath();
  if (o.sad) g.arc(f * 1.2, -28.8, 2.4, Math.PI * 1.15, Math.PI * 1.85); else g.arc(f * 1.2, -31.6, 2.6, 0.2, Math.PI - 0.2);
  g.stroke();
  g.restore();
}
function drawBrine(g, x, y, o) {
  const f = o.face || -1, sq = o.squash || 0;
  const FUR = '#8a5a36', NAVY = '#2f4f8f';
  g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(1 + 0.14 * sq, 1 - 0.18 * sq);
  g.lineJoin = 'round';
  g.fillStyle = INK;
  for (const sx of [-6, 6]) { g.beginPath(); g.ellipse(sx, -2, 5, 3, 0, 0, 7); g.fill(); }
  for (const sx of [-8, 2.5]) draw.paper(g, () => draw.roundRect(g, sx, -10, 5.5, 8, 2), FUR, { lw: 2, shadow: false });
  for (const side of [-1, 1]) {
    const up = o.armsUp || (o.holdUp && side === o.holdUp);
    g.save(); g.translate(side * 11.5, -23); g.rotate(side * (up ? -2.4 : 0.32));
    draw.paper(g, () => draw.roundRect(g, -3, -1, 6, 11, 3), NAVY, { lw: 2, shadow: false });
    g.fillStyle = FUR; g.beginPath(); g.arc(0, 10.5, 3.2, 0, 7); g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();
    g.restore();
  }
  draw.paper(g, () => draw.roundRect(g, -12.5, -29, 25, 21, 8), NAVY, { lw: 2.6, shadow: false });
  g.fillStyle = '#ffd35a'; for (const by of [-23, -16]) { g.beginPath(); g.arc(f * -2, by, 1.8, 0, 7); g.fill(); }
  for (const ex of [-9.5, 9.5]) draw.paper(g, () => { g.beginPath(); g.arc(ex, -48, 5, 0, 7); }, FUR, { lw: 2.2, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.arc(0, -39, 13, 0, 7); }, FUR, { lw: 2.6, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.ellipse(f * 3, -34.5, 7.5, 5.6, 0, 0, 7); }, '#c9965f', { lw: 2, shadow: false });
  g.fillStyle = INK; g.beginPath(); g.ellipse(f * 4.5, -36.5, 2.6, 1.9, 0, 0, 7); g.fill();
  if (o.sad) { g.lineWidth = 1.8; g.strokeStyle = INK; for (const ex of [-4.5, 4.5]) { g.beginPath(); g.moveTo(ex + f * 1.6 - 2, -43); g.lineTo(ex + f * 1.6 + 2, -41.5); g.stroke(); } }
  else for (const ex of [-4.5, 4.5]) { g.beginPath(); g.arc(ex + f * 1.6, -42, 1.9, 0, 7); g.fill(); }
  // captain's cap: navy crown, white band, black visor toward where he faces, gold badge
  draw.paper(g, () => { g.beginPath(); g.moveTo(-12, -48); g.quadraticCurveTo(-13, -58, 0, -58.5); g.quadraticCurveTo(13, -58, 12, -48); g.closePath(); }, NAVY, { lw: 2.4, shadow: false });
  draw.paper(g, () => draw.roundRect(g, -12.5, -50.5, 25, 4.5, 2), '#ffffff', { lw: 2, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.ellipse(f * 9, -46.5, 8, 2.6, f * 0.12, 0, 7); }, INK, { lw: 1.5, shadow: false });
  g.fillStyle = '#ffd35a'; g.beginPath(); g.arc(0, -54, 2.4, 0, 7); g.fill();
  g.restore();
}
function drawPomelo(g, mood, amb, alpha) { // her head peeks over the card's left end; she holds it up
  const x = 196, y = 51 + Math.sin(amb * 2.1) * 1.6 - (mood === 'happy' ? 3 : 0);
  const PINK = '#f7a8b8', DARK = '#e98aa0';
  g.save(); g.globalAlpha *= alpha;
  for (const side of [-1, 1]) draw.paper(g, () => { g.beginPath(); g.moveTo(x + side * 10, y - 19); g.lineTo(x + side * 24, y - 30 + (mood === 'shock' ? -4 : 0)); g.lineTo(x + side * 21, y - 12); g.closePath(); }, DARK, { lw: 2.6, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.ellipse(x, y, 25, 23, 0, 0, 7); }, PINK, { lw: 3, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.ellipse(x + 3, y + 7, 10, 7.5, 0, 0, 7); }, '#ffc6d3', { lw: 2.4, shadow: false });
  g.fillStyle = '#b0566e'; for (const nx of [-3, 3]) { g.beginPath(); g.ellipse(x + 3 + nx, y + 7, 1.7, 2.6, 0, 0, 7); g.fill(); }
  g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = 2.2; g.lineCap = 'round';
  for (const ex of [-9, 13]) {
    if (mood === 'happy') { g.beginPath(); g.arc(x + ex, y - 5, 3.4, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    else if (mood === 'shock') { g.beginPath(); g.arc(x + ex, y - 6, 3.3, 0, 7); g.fill(); }
    else { g.beginPath(); g.arc(x + ex, y - 5, 2.2, 0, 7); g.fill(); }
    if (mood === 'worried') { g.beginPath(); g.moveTo(x + ex - 4, y - 12 + (ex < 0 ? 2 : -1)); g.lineTo(x + ex + 4, y - 12 + (ex < 0 ? -1 : 2)); g.stroke(); }
  }
  g.fillStyle = 'rgba(255, 110, 140, .45)'; for (const cx of [-15, 19]) { g.beginPath(); g.ellipse(x + cx, y + 4, 4, 2.6, 0, 0, 7); g.fill(); }
  // her green collar, a scalloped ruffle under the chin, just above the card's edge
  draw.paper(g, () => {
    g.beginPath(); g.moveTo(x - 20, y + 19); g.quadraticCurveTo(x, y + 25, x + 20, y + 19);
    for (let k = 0; k < 5; k++) { const x1 = x + 20 - k * 8; g.quadraticCurveTo(x1 - 4, y + 33, x1 - 8, y + 26); }
    g.closePath();
  }, '#8fcf5a', { lw: 2.6, shadow: false });
  g.restore();
}
function drawHooves(g, alpha) {
  g.save(); g.globalAlpha *= alpha;
  for (const hx of [178, 216]) {
    draw.paper(g, () => { g.beginPath(); g.ellipse(hx, 81, 8, 6, 0, 0, 7); }, '#f7a8b8', { lw: 2.6, shadow: false });
    g.strokeStyle = INK; g.lineWidth = 1.8; g.beginPath(); g.moveTo(hx, 82); g.lineTo(hx, 87); g.stroke();
  }
  g.restore();
}

// ---- speech bubbles and tags (canvas units)
function bubbleWidth(g, text, size) { g.font = `700 ${size}px ${FONT}`; return g.measureText(text).width + 22; }
// a speech bubble beside (x, y): side 1 grows to the right with its tail on the left, side -1 the mirror
function bubble(g, text, x, y, o = {}) {
  const size = o.size || 16, sc = o.scale ?? 1, side = o.side || 1;
  const w = bubbleWidth(g, text, size), h = size + 14;
  g.save(); g.translate(x, y); g.scale(sc, sc); g.globalAlpha *= o.alpha ?? 1;
  const cx = side * (w / 2 + 6);
  draw.paper(g, () => { g.beginPath(); g.moveTo(side * 10, -6); g.lineTo(side * -2, 8); g.lineTo(side * 14, 5); g.closePath(); }, PAPER, { lw: 3, shadow: false });
  draw.paper(g, () => draw.roundRect(g, cx - w / 2, -h / 2, w, h, h / 2), PAPER, { lw: 3 });
  g.fillStyle = PAPER; g.beginPath(); g.moveTo(side * 9, -4.5); g.lineTo(side * 4, 3); g.lineTo(side * 14, 3.5); g.closePath(); g.fill();
  draw.text(g, text, cx, 1, { size, weight: 700, color: o.color || INK });
  g.restore();
}
function tagWidth(g, text, size) { g.font = `700 ${size}px ${FONT}`; return (text ? g.measureText(text).width : 0) + size * 1.3 + (text ? 18 : 12); }
// a small paper tag: emoji + word, centred on (x, y) (o.align 'left' / 'right': x is that end)
function tag(g, emoji, text, x, y, o = {}) {
  const size = o.size || 15, sc = o.scale ?? 1;
  const w = tagWidth(g, text, size), h = size + 10;
  const ox = o.align === 'left' ? w / 2 : o.align === 'right' ? -w / 2 : 0;
  g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(sc, sc); g.translate(ox, 0); g.globalAlpha *= o.alpha ?? 1;
  draw.paper(g, () => draw.roundRect(g, -w / 2, -h / 2, w, h, 7), o.fill || '#ffffff', { lw: 2.6, shadow: false });
  drawEmoji(g, emoji, -w / 2 + 6 + size * 0.62, 0, size);
  if (text) { g.font = `700 ${size}px ${FONT}`; draw.text(g, text, -w / 2 + size * 1.3 + 10 + g.measureText(text).width / 2, 1, { size, weight: 700, color: o.color || INK }); }
  g.restore();
}

// ---- the game
function makeGame(ctx) {
  const { sfx } = ctx;

  function raftLive(S, r) {
    const bob = 3.5 * Math.sin(S.t * 2.3 + r.phase) * (1 - r.sinkP);
    return { x: r.x + r.offX, y: DECK.y + bob + r.dip + r.sinkY, rot: r.rot + Math.sin(S.t * 1.9 + r.phase) * 0.018 * (1 - r.sinkP) };
  }
  function riderTarget(S, who, i) { const L = raftLive(S, S.rafts[i]); return { x: L.x + (who === S.speck ? -RIDER_DX : RIDER_DX), y: L.y }; }
  function jump(S, who, to, dur, arc) {
    const tx = S.rafts[to].x + (who === S.speck ? -RIDER_DX : RIDER_DX);
    Object.assign(who, { mode: 'hop', fromX: who.x, fromY: who.y, on: to, hopT: 0, hopDur: dur, arc, rot: 0 });
    if (Math.abs(tx - who.x) > 1) who.face = tx > who.x ? 1 : -1;
  }
  function hopTo(S, to, long) {
    if (to < 0 || to >= S.rafts.length || to === S.at) return false;
    const d = Math.abs(to - S.at);
    jump(S, S.speck, to, long ? T.longHop : T.hop, long ? 30 + d * 10 : 30);
    S.at = to;
    sfx('paper');
    return true;
  }
  function raftAt(S, x, y) {
    if (y < POL.cy - POL.h / 2 - 14 || y > DECK.y + DECK.h + 18) return -1;
    const half = Math.min(64, ROW.w / S.rafts.length / 2);
    return S.rafts.findIndex((r) => Math.abs(r.x - x) <= half);
  }
  function fx(S, f) { S.fx.push({ t: 0, life: 0.8, ...f }); }
  function splashFx(S, x, big) {
    const n = big ? 18 : 9;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.1, v = (big ? 300 : 190) * (0.5 + Math.random() * 0.7);
      fx(S, { kind: 'drop', x: x + (Math.random() - 0.5) * 24, y: WATERLINE - 2, vx: Math.cos(a) * v * 0.7, vy: Math.sin(a) * v, g: 950, r: 2.5 + Math.random() * (big ? 5 : 3.5), life: 0.75 });
    }
    fx(S, { kind: 'ring', x, y: WATERLINE + 3, w: big ? 78 : 56, life: 0.75 });
    if (big) fx(S, { kind: 'ring', x, y: WATERLINE + 3, w: 120, life: 0.95 });
  }
  function confetti(S, x, y, n) {
    const cols = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#7bcd5d', '#8fd3ff', '#ff9a4a'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 220;
      fx(S, { kind: 'confetti', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 520, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, color: cols[i % cols.length], life: 0.9 + Math.random() * 0.4 });
    }
  }

  function startRound(S) {
    const rd = S.roundsData[S.round];
    const n = rd.photos.length;
    const order = rd.photos.map((_, k) => k);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd(S) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    S.oldRafts = S.rafts.filter((r) => r.sinkAt == null);
    S.rafts = order.map((k, i) => ({
      photo: rd.photos[k], answer: !!rd.photos[k].answer, x: raftX(i, n),
      offX: 720, phase: rnd(S) * 6.283, tilt: (rnd(S) - 0.5) * 0.09, sinkDir: rnd(S) < 0.5 ? -1 : 1,
      dip: 0, dipV: 0, sinkAt: null, sinkP: 0, sinkY: 0, rot: 0, popped: false, lifted: false,
    }));
    S.trueIdx = S.rafts.findIndex((r) => r.answer);
    S.caption = rd.caption;
    S.fuse = rd.time || 4;
    S.introDur = S.round === 0 ? T.introFirst : T.intro;
    S.stage = 'intro'; S.stageT = 0;
    S.ok = null; S.brineOk = null; S.snapped = false; S.pinned = false; S.lift = null; S.lastTick = Infinity; S.hold = null;
    // the Speck lands on the raft nearest its last x (round 1: the middle one)
    let at = Math.floor((n - 1) / 2);
    if (S.round > 0) {
      let best = Infinity;
      S.rafts.forEach((r, i) => { const d = Math.abs(r.x - (S.speck.x + RIDER_DX)); if (d < best - 0.01) { best = d; at = i; } });
    }
    S.at = -1;
    const sp = S.speck; sp.wet = false; sp.cheer = 0;
    jump(S, sp, at, S.introDur, S.speck.mode === 'swim' || S.round === 0 ? 70 : 34);
    S.at = at;
    // Brine: rightmost raft, his sticker read off the caption
    const b = S.brine;
    b.pick = brinePick(S.rafts, rd.caption, S.stickers);
    b.word = b.pick >= 0 ? S.stickers[S.rafts[b.pick].photo.main] : null;
    b.steps = 0; b.dove = false; b.wet = false; b.bubble = null; b.cheer = 0;
    jump(S, b, n - 1, S.introDur, b.mode === 'swim' || S.round === 0 ? 80 : 30);
    sfx('paper');
  }

  function beginResolve(S) {
    S.stage = 'resolve'; S.stageT = 0;
    S.ok = S.at === S.trueIdx;
    const b = S.brine;
    S.brineOk = !b.dove && b.mode !== 'swim' && b.on === S.trueIdx;
    let k = 0;
    S.rafts.forEach((r) => { if (!r.answer) r.sinkAt = 0.05 * k++; });
    const tr = S.rafts[S.trueIdx], L = raftLive(S, tr);
    S.lift = { photo: tr.photo, caption: S.caption, x: L.x, y: L.y + (POL.cy - DECK.y), rot: tr.tilt };
    fx(S, { kind: 'puff', x: FUSE.x0 - 4, y: FUSE.y, r: 16, life: 0.5 });
    S.hover = -1; S.hold = null;
  }

  function stepResolve(S) {
    const t = S.stageT, b = S.brine, sp = S.speck;
    for (const r of S.rafts) {
      if (r.sinkAt != null && !r.popped && t >= r.sinkAt) { r.popped = true; sfx('pop'); splashFx(S, r.x, false); }
    }
    const sinkingUnder = (who) => { const r = S.rafts[who.on]; return r && r.sinkAt != null && t >= r.sinkAt + 0.1; };
    if (!S.ok && sp.mode === 'stand' && sinkingUnder(sp)) Object.assign(sp, { mode: 'fall', vx: S.rafts[sp.on].sinkDir * 45, vy: -170, wet: false });
    if (!S.brineOk && !b.dove && b.mode === 'stand' && sinkingUnder(b)) Object.assign(b, { mode: 'fall', vx: S.rafts[b.on].sinkDir * 40, vy: -140, wet: false });
    if (t >= T.lift0) S.rafts[S.trueIdx].lifted = true;
    if (!S.snapped && t >= T.lift1) {
      S.snapped = true;
      if (S.ok) {
        S.glued += 1; sfx('ding'); sp.cheer = 0.7;
        fx(S, { kind: 'text', text: '+1 ★', x: PAIR.x - 6, y: PAIR.y - 52, size: 30, color: '#ffd35a', life: 0.95 });
        fx(S, { kind: 'flash', x: (CARD.cx + CARD.w / 2 + PAIR.x) / 2, y: CARD.cy, life: 0.35 });
        confetti(S, CARD.cx + CARD.w / 2, CARD.cy, 22);
      }
      if (S.brineOk) {
        b.score += 1; b.cheer = 0.7;
        b.bubble = { text: ctx.lines.right, t: 0, life: 0.85 };
        fx(S, { kind: 'text', emoji: '🐻', text: '+1', x: b.x, y: b.y - 100, size: 22, color: '#fffdf6', life: 0.85 });
      }
    }
    if (S.ok && !S.pinned && t >= T.morph1) {
      S.pinned = true;
      const k = S.pegs.length;
      S.pegs.push({ photo: S.lift.photo, caption: S.lift.caption, wob: 1 });
      sfx('pin');
      const px = pegX(k, S.toWin);
      confetti(S, px, lineY(px) + 20, 8);
    }
    if (t >= T.resolve) endRound(S);
  }

  function endRound(S) {
    if (S.glued >= S.toWin) { S.stage = 'over'; S.result = 'win'; return; }
    if (S.splashes >= S.toLose) { S.stage = 'over'; S.result = 'lose'; return; }
    if (S.round + 1 >= S.roundsData.length) { S.stage = 'over'; S.result = S.glued >= S.toWin ? 'win' : 'lose'; return; }
    S.round += 1;
    startRound(S);
  }

  function stepRider(S, who, dt, isSpeck) {
    who.squash = Math.max(0, who.squash - dt * 7);
    who.cheer = Math.max(0, (who.cheer || 0) - dt);
    if (who.mode === 'hop') {
      who.hopT += dt;
      const p = clamp01(who.hopT / who.hopDur), tg = riderTarget(S, who, who.on);
      who.x = lerp(who.fromX, tg.x, p);
      who.y = lerp(who.fromY, tg.y, p) - who.arc * 4 * p * (1 - p);
      if (p >= 1) { who.mode = 'stand'; who.squash = 1; S.rafts[who.on].dipV += 55; }
    } else if (who.mode === 'stand') {
      const tg = riderTarget(S, who, who.on);
      who.x = tg.x; who.y = tg.y - (who.cheer > 0 ? Math.sin((who.cheer / 0.7) * Math.PI) * 14 : 0);
      who.rot = S.rafts[who.on].rot * 0.8;
    } else if (who.mode === 'fall') {
      who.vy += 1500 * dt; who.x += who.vx * dt; who.y += who.vy * dt;
      who.rot = (who.rot || 0) + who.vx * 0.012 * dt * 8;
      if (!who.wet && who.vy > 0 && who.y >= WATERLINE) {
        who.wet = true;
        if (isSpeck) {
          S.splashes += 1; sfx('buzz'); S.shake = 0.32;
          splashFx(S, who.x, true);
          fx(S, { kind: 'text', text: 'SPLASH!', x: Math.max(110, Math.min(850, who.x)), y: 352, size: 46, color: '#2f8fe8', shake: true, life: 1.0 });
        } else {
          splashFx(S, who.x, false);
          if (!who.dove) who.bubble = { text: ctx.lines.splash, t: 0, life: 0.9 };
        }
      }
      if (who.wet && who.y >= WATERLINE + 30) { who.mode = 'swim'; who.y = WATERLINE + 30; who.rot = 0; }
    } else if (who.mode === 'swim') {
      who.y = WATERLINE + 30 + Math.sin(S.t * 3.2 + (isSpeck ? 0 : 1.7)) * 2.2;
    }
    if (who.bubble) { who.bubble.t += dt; if (who.bubble.t >= who.bubble.life) who.bubble = null; }
  }

  function stepFuse(S, dt, input) {
    const left = S.fuse - S.stageT;
    if (left <= T.red) { const k = Math.ceil(left); if (k >= 1 && k < S.lastTick) { S.lastTick = k; sfx('tick'); } }
    // hop: one raft per key press (counted from key events, so none is lost at low frame rates), held keys repeat
    const presses = ctx.keys.splice(0);
    for (const d of presses) hopTo(S, S.at + d, false);
    const held = input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
    if (presses.length) S.hold = { dir: presses[presses.length - 1], t: 0, next: T.repeatAfter };
    else if (held && S.hold && S.hold.dir === held) {
      S.hold.t += dt;
      if (S.hold.t >= S.hold.next) { hopTo(S, S.at + held, false); S.hold.next += T.repeatEvery; }
    } else S.hold = held ? { dir: held, t: 0, next: T.repeatAfter } : null;
    // click or tap a raft: one long hop straight there
    S.hover = ctx.pointerIn() ? raftAt(S, input.pointer.x, input.pointer.y) : -1;
    S.hoverShow = ctx.pointerActive();
    if (input.pointer.clicked) { const i = raftAt(S, input.pointer.x, input.pointer.y); if (i >= 0) hopTo(S, i, true); }
    // fuse sparks
    if (Math.random() < Math.min(1, dt * 30)) {
      const xb = fuseEnd(S);
      fx(S, { kind: 'spark', x: xb, y: FUSE.y, vx: (Math.random() - 0.2) * 90, vy: -40 - Math.random() * 90, g: 300, life: 0.35 + Math.random() * 0.2, red: left <= T.red });
    }
    // Brine waits (reading one word), then hops one raft every 0.3 s toward the plainest photo with that word
    const b = S.brine;
    if (S.stageT >= T.brineWait && b.mode === 'stand') {
      if (b.pick < 0) {
        if (!b.dove) { b.dove = true; b.bubble = { text: ctx.lines.none, t: 0, life: 1.7 }; Object.assign(b, { mode: 'fall', vx: 75, vy: -330, wet: false }); sfx('pop'); }
      } else if (b.on !== b.pick && S.stageT >= T.brineWait + b.steps * T.brineStep) {
        b.steps += 1;
        jump(S, b, b.on + Math.sign(b.pick - b.on), T.brineHop, 22);
      }
    }
    if (S.stageT >= S.fuse) beginResolve(S);
  }

  function fuseLeft(S) { // seconds of fuse still to burn
    if (S.stage === 'fuse') return Math.max(0, S.fuse - S.stageT);
    if (S.stage === 'intro' || S.stage === 'pre') return S.fuse;
    return 0;
  }
  function fuseEnd(S) { return FUSE.x0 + (FUSE.x1 - FUSE.x0) * (fuseLeft(S) / S.maxTime); }

  // ---- drawing
  function drawSky(g, amb) {
    const sky = g.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#9edcf6'); sky.addColorStop(1, '#e6f8fb');
    g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON + 2);
    for (const [bx, by, s, sp] of [[120, 120, 1, 7], [520, 40, 0.8, 5], [840, 96, 1.15, 6]]) {
      const x = ((bx + amb * sp) % 1160) - 100;
      g.save(); g.translate(x, by); g.scale(s, s);
      const puffs = () => { g.beginPath(); for (const [cx, cy, r] of [[-22, 4, 14], [0, -4, 19], [24, 4, 14]]) { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, 7); } g.rect(-26, 4, 50, 14); };
      puffs(); g.lineWidth = 6; g.strokeStyle = '#a9d7e6'; g.lineJoin = 'round'; g.stroke();
      puffs(); g.fillStyle = '#ffffff'; g.fill();
      g.restore();
    }
    // a tiny palm island on the horizon
    g.save(); g.translate(880, HORIZON);
    draw.paper(g, () => { g.beginPath(); g.ellipse(0, 0, 44, 12, 0, Math.PI, 0); g.closePath(); }, '#f7e2a6', { lw: 3, shadow: false });
    g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.moveTo(-4, -8); g.quadraticCurveTo(-2, -26, 6, -40); g.stroke();
    g.strokeStyle = '#a8784c'; g.lineWidth = 3; g.stroke();
    for (const a of [-2.6, -1.9, -1.1, -0.4]) draw.paper(g, () => { g.beginPath(); g.ellipse(6 + Math.cos(a) * 12, -40 + Math.sin(a) * 6, 13, 4.5, a + Math.PI / 2 + 1.4, 0, 7); }, '#5fbf5a', { lw: 2.4, shadow: false });
    g.restore();
  }
  function drawPost(g) { // the Stilt Post: Mrs. Pomelo's hut on stilts at the far left, with a landing
    for (const sx of [12, 46, 80]) draw.paper(g, () => draw.roundRect(g, sx - 5, 58, 10, 480, 4), '#7a4e2e', { lw: 3, shadow: false });
    g.strokeStyle = INK; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(12, 210); g.lineTo(80, 300); g.moveTo(80, 210); g.lineTo(12, 300); g.stroke();
    g.strokeStyle = '#9a6a40'; g.lineWidth = 3; g.stroke();
    draw.paper(g, () => draw.roundRect(g, -14, -12, 112, 72, 8), '#f6e7c8', { lw: 3.5 });
    draw.paper(g, () => { g.beginPath(); g.moveTo(-20, -12); g.lineTo(104, -12); g.lineTo(104, 10); g.lineTo(-20, 10); g.closePath(); }, '#e9c46a', { lw: 3, shadow: false });
    g.strokeStyle = '#c99a3c'; g.lineWidth = 2; for (let x = -10; x < 104; x += 12) { g.beginPath(); g.moveTo(x, -10); g.lineTo(x + 5, 9); g.stroke(); }
    draw.paper(g, () => draw.roundRect(g, 14, 22, 36, 26, 5), '#8fd3ff', { lw: 2.6, shadow: false });
    draw.paper(g, () => draw.roundRect(g, 58, 24, 30, 20, 3), '#ff7ab8', { lw: 2.4, shadow: false });
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(61, 27); g.lineTo(73, 36); g.lineTo(85, 27); g.stroke();
    // the landing deck where the racers wait, and a ladder down to the water
    draw.paper(g, () => draw.roundRect(g, -10, DECK.y, 110, 15, 5), '#b8864e', { lw: 3, shadow: false });
    g.strokeStyle = INK; g.lineWidth = 3;
    g.beginPath(); g.moveTo(88, DECK.y + 15); g.lineTo(88, WATERLINE + 30); g.moveTo(100, DECK.y + 15); g.lineTo(100, WATERLINE + 30);
    for (let y = DECK.y + 24; y < WATERLINE + 30; y += 10) { g.moveTo(88, y); g.lineTo(100, y); }
    g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, .7)';
    for (const sx of [12, 46, 80]) { g.beginPath(); g.ellipse(sx, WATERLINE + 34, 11, 3, 0, 0, 7); g.fill(); }
  }
  function drawWater(g, amb) {
    const sea = g.createLinearGradient(0, HORIZON, 0, H);
    sea.addColorStop(0, '#6fe3ea'); sea.addColorStop(0.14, '#22cfd8'); sea.addColorStop(1, '#14b5c6');
    g.fillStyle = sea; g.fillRect(0, HORIZON, W, H - HORIZON);
    g.strokeStyle = 'rgba(43, 34, 51, .3)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, HORIZON); g.lineTo(W, HORIZON); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, .5)'; g.lineWidth = 3; g.lineCap = 'round';
    for (let row = 0; row < 7; row++) {
      const y = 194 + row * 52, gap = 170 - row * 8, sp = (row % 2 ? 1 : -1) * (7 + row * 2.5);
      const off = (((amb * sp + row * 53) % gap) + gap) % gap;
      for (let x = -gap + off; x < W + gap; x += gap) {
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 5, x + 20, y); g.quadraticCurveTo(x + 30, y + 5, x + 40, y); g.stroke();
      }
    }
  }
  function drawClothesline(g, S, amb) {
    g.strokeStyle = INK; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(LINE.x0, LINE.y); g.quadraticCurveTo((LINE.x0 + LINE.x1) / 2, LINE.y + LINE.sag * 2, LINE.x1, LINE.y); g.stroke();
    g.strokeStyle = '#f3e6c8'; g.lineWidth = 2.4; g.stroke();
    draw.paper(g, () => draw.roundRect(g, LINE.x1 - 4, 8, 12, HORIZON - 4, 5), '#c99a5a', { lw: 3, shadow: false });
    for (let k = 0; k < S.toWin; k++) {
      const px = pegX(k, S.toWin), py = lineY(px), pc = S.pegs[k];
      if (pc) {
        g.save(); g.translate(px, py); g.rotate(Math.sin(amb * 1.7 + k * 1.3) * 0.045 + Math.sin(amb * 14) * 0.18 * pc.wob); g.translate(-px, -py);
        const pg = postcardGeom(px, py);
        g.save(); g.translate(0, 3); g.fillStyle = 'rgba(43, 34, 51, .2)'; draw.roundRect(g, pg.cx - pg.w / 2, pg.cy - pg.h / 2, pg.w, pg.h, 8); g.fill(); g.restore();
        drawPostcardBody(g, pg.cx, pg.cy, pg.w, pg.h, 1);
        drawPolaroid(g, pc.photo, pg.phx, pg.phy, pg.phs, -0.05, { shadow: false });
        g.restore();
      }
      draw.paper(g, () => draw.roundRect(g, px - 4, py - 7, 8, 17, 2.5), pc ? '#d9a066' : '#e8c9a0', { lw: 2.4, shadow: false });
    }
  }
  function drawRaft(g, S, r, i) {
    const L = raftLive(S, r);
    if (L.x < -90 || L.x > W + 90 || r.sinkP >= 1) return;
    const fuse = S.stage === 'fuse';
    if (r.sinkP < 1) { g.fillStyle = `rgba(10, 110, 130, ${0.22 * (1 - r.sinkP)})`; g.beginPath(); g.ellipse(L.x, WATERLINE + 9, 62, 8, 0, 0, 7); g.fill(); }
    g.save();
    g.beginPath(); g.rect(-100, -100, W + 200, WATERLINE + 101); g.clip();
    const deckC = L.y + DECK.h / 2;
    g.translate(L.x, deckC); g.rotate(L.rot);
    const glow = S.stage === 'resolve' && r.answer ? Math.min(1, S.stageT / 0.15) : 0;
    if (glow) {
      const gr = g.createRadialGradient(0, -20, 10, 0, -20, 110);
      gr.addColorStop(0, `rgba(255, 226, 110, ${0.75 * glow})`); gr.addColorStop(1, 'rgba(255, 226, 110, 0)');
      g.fillStyle = gr; g.fillRect(-120, -140, 240, 240);
    }
    const polTop = POL.cy - POL.h / 2 - DECK.y - DECK.h / 2;
    draw.paper(g, () => draw.roundRect(g, -3.5, polTop - 6, 7, -polTop + 2, 3), '#8a5a36', { lw: 2.5, shadow: false });
    if (!r.lifted) {
      const mark = fuse && i === S.at ? 'sel' : fuse && i === S.hover && S.hoverShow ? 'hover' : null;
      drawPolaroid(g, r.photo, 0, POL.cy - DECK.y - DECK.h / 2, 1, r.tilt + Math.sin(S.t * 1.7 + r.phase) * 0.012, { mark, peg: true });
    }
    draw.paper(g, () => draw.roundRect(g, -DECK.w / 2, -DECK.h / 2, DECK.w, DECK.h, 7), '#b8864e', { lw: 3.5, shadow: false });
    g.strokeStyle = '#8f6237'; g.lineWidth = 2;
    for (let k = 1; k < 4; k++) { const x = -DECK.w / 2 + k * (DECK.w / 4); g.beginPath(); g.moveTo(x, -DECK.h / 2 + 3); g.lineTo(x, DECK.h / 2 - 3); g.stroke(); }
    for (const lx of [-34, 34]) draw.paper(g, () => draw.roundRect(g, lx - 3, -DECK.h / 2 - 1, 6, DECK.h + 2, 2), '#f1dfb5', { lw: 1.6, shadow: false });
    g.restore();
    if (r.sinkP <= 0) {
      g.strokeStyle = 'rgba(255, 255, 255, .8)'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(L.x - 60, WATERLINE + 1); g.quadraticCurveTo(L.x - 52, WATERLINE - 3, L.x - 44, WATERLINE + 1); g.moveTo(L.x + 44, WATERLINE + 1); g.quadraticCurveTo(L.x + 52, WATERLINE - 3, L.x + 60, WATERLINE + 1); g.stroke();
    }
  }
  function drawRiders(g, S, amb) {
    g.save();
    g.beginPath(); g.rect(-100, -100, W + 200, WATERLINE + 101); g.clip();
    const b = S.brine, sp = S.speck;
    drawBrine(g, b.x, b.y, { face: b.face, squash: b.squash, rot: b.rot, armsUp: b.mode === 'swim' || b.mode === 'fall' || b.cheer > 0, sad: b.mode === 'swim',
      holdUp: S.stage === 'fuse' && !b.dove ? brineSide(g, S) : 0 });
    drawSpeck(g, sp.x, sp.y, { colors: ctx.colors, face: sp.face, squash: sp.squash, rot: sp.rot,
      armsUp: sp.mode === 'hop' || sp.mode === 'fall' || sp.mode === 'swim' || sp.cheer > 0, wave: sp.mode === 'swim' ? amb * 9 : 0, sad: sp.mode === 'swim' });
    g.restore();
    g.strokeStyle = 'rgba(255, 255, 255, .75)'; g.lineWidth = 2.5;
    for (const who of [b, sp]) {
      if (who.mode !== 'swim') continue;
      const k = (amb * 1.4) % 1;
      g.globalAlpha = 1 - k; g.beginPath(); g.ellipse(who.x, WATERLINE + 2, 16 + k * 22, 4 + k * 4, 0, 0, 7); g.stroke(); g.globalAlpha = 1;
    }
  }
  function drawFuse(g, S, amb) {
    const left = fuseLeft(S), red = S.stage === 'fuse' && left <= T.red;
    const xb = fuseEnd(S), xFull = FUSE.x0 + (FUSE.x1 - FUSE.x0) * (S.fuse / S.maxTime);
    if (S.stage !== 'pre' && xFull > xb + 2) { // ash where it already burned
      g.strokeStyle = 'rgba(90, 80, 100, .35)'; g.lineWidth = 3; g.setLineDash([3, 7]);
      g.beginPath(); g.moveTo(xb, FUSE.y); g.lineTo(xFull, FUSE.y); g.stroke(); g.setLineDash([]);
    }
    if (xb > FUSE.x0 + 1) {
      const path = () => { g.beginPath(); g.moveTo(FUSE.x0, FUSE.y); for (let x = FUSE.x0; x <= xb; x += 8) g.lineTo(x, FUSE.y + Math.sin(x / 9) * 1.6); g.lineTo(xb, FUSE.y + Math.sin(xb / 9) * 1.6); };
      g.lineCap = 'round'; g.lineJoin = 'round';
      path(); g.strokeStyle = INK; g.lineWidth = 9; g.stroke();
      path(); g.strokeStyle = red ? '#e8566a' : '#e3bb74'; g.lineWidth = 4.6; g.stroke();
      g.strokeStyle = red ? '#a8314a' : '#a37a3c'; g.lineWidth = 1.6;
      for (let x = FUSE.x0 + 6; x < xb - 4; x += 9) { g.beginPath(); g.moveTo(x - 2, FUSE.y - 2.5); g.lineTo(x + 2, FUSE.y + 2.5); g.stroke(); }
    }
    draw.paper(g, () => { g.beginPath(); g.arc(FUSE.x0 - 4, FUSE.y, 6, 0, 7); }, '#a37a3c', { lw: 2.6, shadow: false });
    if (S.stage === 'fuse') { // the spark
      const fl = 1 + Math.sin(amb * 40) * 0.18 + (red ? 0.35 : 0);
      g.save(); g.translate(xb, FUSE.y); g.rotate(amb * 6); g.scale(fl, fl);
      g.fillStyle = red ? '#ff6a3a' : '#ffb02e'; g.strokeStyle = INK; g.lineWidth = 2;
      g.beginPath(); for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = k % 2 ? 4.5 : 11; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#fff6c2'; g.beginPath(); g.arc(0, 0, 3.6, 0, 7); g.fill();
      g.restore();
    }
  }
  function captionFont(g, text) {
    let size = 30;
    g.font = `700 ${size}px ${FONT}`;
    const w = g.measureText(text).width;
    if (w > CARD.w - 150) size = Math.max(20, Math.floor((size * (CARD.w - 150)) / w));
    return size;
  }
  function drawCardFace(g, text, textAlpha, lineAlpha) { // centred on (0, 0), CARD size
    draw.paper(g, () => draw.roundRect(g, -CARD.w / 2, -CARD.h / 2, CARD.w, CARD.h, 14), PAPER, { lw: 4 });
    g.save(); // airmail edge
    draw.roundRect(g, -CARD.w / 2 + 7, -CARD.h / 2 + 7, CARD.w - 14, CARD.h - 14, 8);
    g.setLineDash([10, 10]); g.lineWidth = 3.5; g.strokeStyle = 'rgba(232, 86, 106, .5)'; g.stroke();
    g.lineDashOffset = 10; g.strokeStyle = 'rgba(79, 134, 216, .5)'; g.stroke();
    g.restore();
    if (text && textAlpha > 0) {
      g.save(); g.globalAlpha *= textAlpha;
      draw.text(g, text, 0, 2, { size: captionFont(g, text), weight: 700 });
      g.restore();
    }
    if (lineAlpha > 0) { g.save(); g.globalAlpha *= lineAlpha; g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(-200, -6); g.lineTo(200, -6); g.moveTo(-200, 10); g.lineTo(120, 10); g.stroke(); g.restore(); }
  }
  function drawCard(g, S, amb) {
    let sy = 1, text = S.caption, ta = 1;
    if (S.stage === 'pre' || S.stage === 'over') text = '';
    else if (S.stage === 'intro') {
      const p = clamp01(S.stageT / S.introDur);
      if (p < 0.45) { sy = 1 - easeIn(p / 0.45); text = ''; } else sy = easeBack((p - 0.45) / 0.55);
    } else if (S.stage === 'resolve') {
      const t = S.stageT;
      if (S.ok && t >= T.morph0) text = '';
      else if (!S.ok && t >= T.fade0) ta = 1 - clamp01((t - T.fade0) / (T.resolve - T.fade0));
    }
    g.save(); g.translate(CARD.cx, CARD.cy + Math.sin(amb * 1.3) * 1.2); g.rotate(-0.012); g.scale(1, Math.max(0.02, sy));
    drawCardFace(g, text, ta, 0);
    g.restore();
  }
  function drawPair(g, S) { // the true photo flying up, the snap, then the postcard flying to its peg
    if (S.stage !== 'resolve' || !S.lift || S.stageT < T.lift0) return;
    const t = S.stageT, L = S.lift;
    if (t < T.lift1) {
      const p = easeInOut(clamp01((t - T.lift0) / (T.lift1 - T.lift0)));
      const x = lerp(L.x, PAIR.x, p), y = lerp(L.y, PAIR.y, p) - Math.sin(p * Math.PI) * 60;
      drawPolaroid(g, L.photo, x, y, lerp(1, PAIR.s, p), lerp(L.rot, PAIR.rot, p) + Math.sin(p * Math.PI) * 0.5);
      return;
    }
    if (!S.ok) {
      const a = t < T.fade0 ? 1 : 1 - clamp01((t - T.fade0) / (T.resolve - T.fade0));
      if (a > 0) drawPolaroid(g, L.photo, PAIR.x, PAIR.y, PAIR.s, PAIR.rot, { alpha: a });
      return;
    }
    if (t < T.morph0) {
      const k = clamp01((t - T.lift1) / 0.18), bump = 1 + Math.sin(k * Math.PI) * 0.12;
      drawPolaroid(g, L.photo, PAIR.x, PAIR.y, PAIR.s * bump, PAIR.rot);
      return;
    }
    if (t >= T.morph1) return;
    const q = clamp01((t - T.morph0) / (T.morph1 - T.morph0));
    const p = easeInOut(q), ps = easeOut(clamp01(q / 0.55)); // position, size
    const k = S.pegs.length, px = pegX(k, S.toWin), pg = postcardGeom(px, lineY(px));
    const arc = Math.sin(p * Math.PI) * 30;
    const cx = lerp(CARD.cx, pg.cx, p), cy = lerp(CARD.cy, pg.cy, p) - arc;
    const w = lerp(CARD.w, pg.w, ps), h = lerp(CARD.h, pg.h, ps);
    g.save();
    if (ps < 0.6) { // the caption card folding down, its words fading into ink lines
      g.translate(cx, cy); g.scale(w / CARD.w, h / CARD.h);
      drawCardFace(g, L.caption, 1 - clamp01(ps / 0.3), clamp01((ps - 0.2) / 0.3));
    } else drawPostcardBody(g, cx, cy, w, h, 1);
    g.restore();
    const ox = lerp(PAIR.x - CARD.cx, pg.phx - pg.cx, ps), oy = lerp(PAIR.y - CARD.cy, pg.phy - pg.cy, ps);
    drawPolaroid(g, L.photo, cx + ox, cy + oy, lerp(PAIR.s, pg.phs, ps), lerp(PAIR.rot, -0.05, ps), { shadow: false });
  }
  // which side of Brine his tag and bubbles go: his right, unless that runs off the canvas
  function brineSide(g, S) {
    const b = S.brine;
    const w = Math.max(tagWidth(g, b.word || '?', 15), b.bubble ? bubbleWidth(g, b.bubble.text, 16) + 6 : 0);
    return b.x + 16 + w > W - 6 ? -1 : 1;
  }
  function drawBrineUi(g, S) {
    const b = S.brine;
    if (S.stage === 'pre') return;
    const side = brineSide(g, S);
    const headY = b.mode === 'swim' ? WATERLINE - 26 : b.y - 40;
    if (S.stage === 'fuse' && !b.dove) { // the one sticker word he read off the caption, held up in his paw
      const k = clamp01(S.stageT / 0.18);
      tag(g, '🏷️', b.word || '?', b.x + side * 16, b.y - 44, { scale: easeBack(k), rot: side * 0.07, align: side > 0 ? 'left' : 'right', color: '#2f4f8f' });
    } else if (b.mode !== 'fall') {
      tag(g, '🐻', String(b.score), b.x, headY - 34, { size: 13, fill: PAPER });
    }
    if (b.bubble) {
      const k = b.bubble.t / b.bubble.life;
      bubble(g, b.bubble.text, b.x + side * 16, headY - 6, { side, scale: easeBack(clamp01(k / 0.15)), alpha: 1 - clamp01((k - 0.8) / 0.2), size: 16 });
    }
  }
  function drawFx(g, S, layer) {
    for (const f of S.fx) {
      const p = clamp01(f.t / f.life);
      if (layer === 'back') {
        if (f.kind === 'drop') { g.fillStyle = 'rgba(235, 252, 255, .95)'; g.strokeStyle = 'rgba(43, 34, 51, .35)'; g.lineWidth = 1.2; g.beginPath(); g.arc(f.x, f.y, f.r * (1 - p * 0.4), 0, 7); g.fill(); g.stroke(); }
        else if (f.kind === 'ring') { g.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - p)})`; g.lineWidth = 3.5; g.beginPath(); g.ellipse(f.x, f.y, 10 + f.w * easeOut(p), 3 + f.w * 0.16 * easeOut(p), 0, 0, 7); g.stroke(); }
        else if (f.kind === 'spark') { g.fillStyle = f.red ? '#ff6a3a' : '#ffc94a'; g.beginPath(); g.arc(f.x, f.y, 2.6 * (1 - p), 0, 7); g.fill(); }
        else if (f.kind === 'puff') { g.fillStyle = `rgba(160, 150, 170, ${0.6 * (1 - p)})`; g.beginPath(); g.arc(f.x, f.y - p * 14, f.r * (0.5 + p), 0, 7); g.fill(); }
      } else if (f.kind === 'confetti') {
        g.save(); g.translate(f.x, f.y); g.rotate(f.rot); g.globalAlpha = 1 - clamp01((p - 0.7) / 0.3);
        g.fillStyle = f.color; g.fillRect(-4, -2.5, 8, 5); g.restore();
      } else if (f.kind === 'flash') {
        g.save(); g.globalAlpha = 1 - p; g.strokeStyle = '#ffffff'; g.lineWidth = 8 * (1 - p) + 2;
        g.beginPath(); g.arc(f.x, f.y, 20 + 90 * easeOut(p), 0, 7); g.stroke(); g.restore();
      } else if (f.kind === 'text') {
        const sc = p < 0.18 ? easeBack(p / 0.18) : 1;
        const dx = f.shake ? Math.sin(f.t * 70) * 4 * (1 - p) : 0;
        g.save(); g.translate(f.x + dx, f.y - (f.shake ? 0 : 30 * easeOut(p))); g.scale(sc, sc); g.globalAlpha = 1 - clamp01((p - 0.7) / 0.3);
        g.font = `700 ${f.size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        const ew = f.emoji ? f.size * 1.15 : 0, tx = ew / 2;
        if (f.emoji) drawEmoji(g, f.emoji, tx - g.measureText(f.text).width / 2 - ew / 2, 0, f.size);
        g.lineWidth = f.size * 0.32; g.strokeStyle = INK; g.strokeText(f.text, tx, 0);
        g.lineWidth = f.size * 0.14; g.strokeStyle = '#ffffff'; g.strokeText(f.text, tx, 0);
        g.fillStyle = f.color; g.fillText(f.text, tx, 0);
        g.restore();
      }
    }
  }
  function stepFx(S, dt) {
    for (const f of S.fx) {
      f.t += dt;
      if (f.vx != null) { f.x += f.vx * dt; f.y += f.vy * dt; if (f.g) f.vy += f.g * dt; }
      if (f.vr) f.rot += f.vr * dt;
      if (f.kind === 'drop' && f.y > WATERLINE + 6 && f.vy > 0) f.t = f.life;
    }
    S.fx = S.fx.filter((f) => f.t < f.life);
    for (const pc of S.pegs) pc.wob = Math.max(0, (pc.wob || 0) - dt * 1.4);
  }
  function pomeloMood(S) {
    if (S.stage === 'fuse' && S.fuse - S.stageT <= T.red) return 'worried';
    if (S.stage === 'resolve' && S.stageT >= 0.2) return S.ok ? 'happy' : 'shock';
    if (S.stage === 'over') return S.result === 'win' ? 'happy' : 'shock';
    return 'idle';
  }

  return {
    goal: 'Hop on the photo that fits the words. Glue 6 pairs before 3 splashes!',
    controls: [['← →', 'hop'], ['click', 'hop there']],
    duration: 0,
    setup(S, spec) {
      S.roundsData = Array.isArray(spec.rounds) && spec.rounds.length ? spec.rounds : FALLBACK_ROUNDS;
      S.toWin = spec.toWin ?? 6;
      S.toLose = spec.splashesToLose ?? 3;
      S.stickers = spec.brine?.stickers || STICKERS;
      S.seed = (Number.isFinite(spec.seed) ? spec.seed : Math.floor(Math.random() * 4294967296)) >>> 0;
      S.rng = S.seed;
      S.maxTime = Math.max(...S.roundsData.map((r) => r.time || 4));
      Object.assign(S, { stage: 'pre', stageT: 0, round: 0, rafts: [], oldRafts: [], at: -1, trueIdx: -1, glued: 0, splashes: 0,
        result: null, pegs: [], fx: [], shake: 0, hover: -1, hold: null, caption: '', fuse: S.roundsData[0].time || 4, introDur: T.introFirst });
      const rider = (x, face) => ({ x, y: DECK.y, mode: 'post', face, squash: 0, rot: 0, on: -1, hopT: 0, hopDur: 0, fromX: x, fromY: DECK.y, arc: 0, vx: 0, vy: 0, wet: false, cheer: 0, bubble: null });
      S.speck = rider(POST.speck, 1);
      S.brine = { ...rider(POST.brine, 1), score: 0, pick: -1, word: null, steps: 0, dove: false };
      ctx.keys.length = 0;
    },
    update(S, dt, input) {
      S.stageT += dt;
      if (S.stage === 'pre') startRound(S);
      else if (S.stage === 'intro') { if (S.stageT >= S.introDur) { S.stage = 'fuse'; S.stageT = 0; } }
      else if (S.stage === 'fuse') stepFuse(S, dt, input);
      else if (S.stage === 'resolve') stepResolve(S);
      if (S.stage !== 'fuse') { ctx.keys.length = 0; S.hover = -1; }
      for (const r of S.rafts) {
        r.offX = S.stage === 'intro' ? (1 - easeOut(clamp01(S.stageT / S.introDur))) * 720 : 0;
        r.dipV += (-150 * r.dip - 11 * r.dipV) * dt; r.dip += r.dipV * dt;
        if (r.sinkAt != null) {
          r.sinkP = clamp01((S.stageT - r.sinkAt) / T.sink);
          r.sinkY = easeIn(r.sinkP) * 210; r.rot = r.sinkDir * 0.5 * easeOut(r.sinkP);
          if (S.stage !== 'resolve') r.sinkP = 1;
        }
      }
      if (S.stage === 'intro') for (const r of S.oldRafts) r.offX = -easeIn(clamp01(S.stageT / S.introDur)) * 820;
      else S.oldRafts = [];
      stepRider(S, S.speck, dt, true);
      stepRider(S, S.brine, dt, false);
      ctx.setCursor(S.stage === 'fuse' && S.hover >= 0 && S.hover !== S.at ? 'pointer' : '');
    },
    draw(g, S) {
      const now = performance.now() / 1000;
      const rdt = Math.min(0.05, Math.max(0, now - (ctx.lastDraw || now)));
      ctx.lastDraw = now;
      stepFx(S, rdt);
      S.shake = Math.max(0, S.shake - rdt);
      g.save();
      if (S.shake > 0) { const k = (S.shake / 0.32) * 7; g.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k); }
      const SKIP = globalThis.__rrSkip || new Set(); // TEMP DEBUG
      if (!SKIP.has('sky')) drawSky(g, now);
      if (!SKIP.has('water')) drawWater(g, now);
      if (!SKIP.has('post')) drawPost(g);
      if (!SKIP.has('line')) drawClothesline(g, S, now);
      if (!SKIP.has('rafts')) for (const r of S.oldRafts) drawRaft(g, S, r, -1);
      if (!SKIP.has('rafts')) S.rafts.forEach((r, i) => drawRaft(g, S, r, i));
      if (!SKIP.has('riders')) drawRiders(g, S, now);
      if (!SKIP.has('fx')) drawFx(g, S, 'back');
      if (!SKIP.has('fuse')) drawFuse(g, S, now);
      if (!SKIP.has('pomelo')) drawPomelo(g, pomeloMood(S), now, 1);
      if (!SKIP.has('card')) drawCard(g, S, now);
      if (!SKIP.has('pomelo')) drawHooves(g, 1);
      if (!SKIP.has('pair')) drawPair(g, S);
      if (!SKIP.has('brine')) drawBrineUi(g, S);
      if (!SKIP.has('fx')) drawFx(g, S, 'front');
      g.restore();
    },
    result(S) { return S.result; },
    hud(S, spec) {
      return String(spec.hud || '★ {glued}/{toWin} · 💦 {splashes}/{toLose}')
        .replace('{glued}', S.glued).replace('{splashes}', S.splashes).replace('{toWin}', S.toWin).replace('{toLose}', S.toLose);
    },
  };
}

export default {
  mount(container, spec = {}, api = {}) {
    const keys = [];
    let pointerIn = false, lastPointer = -1e9;
    let canvas = null;
    const b = spec.brine?.bubbles || {};
    const ctx = {
      keys,
      colors: speckColors(),
      lines: { right: b.right || 'Ha!', splash: b.splash || 'Blast!', none: b.none || 'No sticker for THAT!' },
      sfx: (n) => { try { (api.sfx || gameSfx)(n); } catch { /* sound is optional */ } },
      pointerIn: () => pointerIn,
      pointerActive: () => pointerIn && performance.now() - lastPointer < 1500, // the mouse is in use

      setCursor: (c) => { if (canvas && canvas.style.cursor !== c) canvas.style.cursor = c; },
      lastDraw: 0,
    };
    const handle = runMinigame(container, spec, api, makeGame(ctx));
    canvas = container.querySelector('.mg-canvas');
    const onKey = (e) => {
      if (e.repeat) return;
      const d = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code];
      if (d) keys.push(d);
    };
    window.addEventListener('keydown', onKey, true);
    if (canvas) {
      canvas.addEventListener('pointermove', () => { pointerIn = true; lastPointer = performance.now(); });
      canvas.addEventListener('pointerdown', () => { pointerIn = true; lastPointer = performance.now(); });
      canvas.addEventListener('pointerleave', () => { pointerIn = false; });
    }
    return {
      destroy() {
        window.removeEventListener('keydown', onKey, true);
        handle.destroy();
      },
    };
  },
};
