// Belly vs. Cart (Siftsand / Mamba, challenge m1): a side-scrolling race to Penny's post office, about 36-42 s.
// The Speck rides Noodle's head. Grains roll up to his mouth one tile at a time. GULP (Space, ↓ or the button) takes a
// bead into his one small belly, whose window shows it; sand or an 'um' is 'Blech!' and a stall. SHOUT (↑ or the
// button) at a bell: Noodle calls out his belly, right if it holds the last bead before that bell. Gulping a bell,
// shouting at nothing, or a wrong or missed bell also stalls him (small mistakes 0.6 s, bell mistakes 1.4 s).
// Kayvee races in the back lane and keeps EVERY grain in his cart: he starts fast (3.4 tiles/s), slows as
// 3.4 / (1 + 0.03 n) with n grains in the cart, and digs through all of them at every bell (0.3 + 0.015 n s), always
// right. A race strip on top shows both racers. First to the post office (tile road.length + 1) wins.
// The paper (Gu & Dao 2023): Selective Copying (§3.1, Fig. 2) played as input-dependent selection (§3.5.2). The player
// is the selection mechanism and decides grain by grain from what each grain is. The belly is the fixed-size state: a
// gulp is a large Δ (reset, take the bead in), letting a grain slide a small Δ (keep the belly, ignore the grain), a
// shout reads the belly out (C). Kayvee is attention with its KV cache: he never compresses, so he is never wrong, but
// every step and every lookup gets slower as his cart grows (§3.1; §4.5: without a KV cache, ~5x the throughput).
// Playing well = compressing the road into one belly by choosing, which is both fast and right.
// Spec: content/extra/mamba.json, challenge m1. Test hooks on container.__mg.state: road, roadIndex, dN, dK,
// n (Kayvee's cart), belly, right, bells, mistakes (= slips + bellMistakes), stall (seconds left), finish, winner,
// tiles [{ i, tok, kind, target, done: null | 'gulped' | 'slid' | 'missed' | 'ok' | 'wrong' }], log [{ ev, t, i }].
// The race logic (config, newRace, gulp, shout, advance, simulate) is pure and exported for headless tuning checks.
import { runMinigame, draw } from './kit.js';
import { getSave } from '../game/save.js';
import { sfx as gameSfx } from '../game/sfx.js';

const W = 960, H = 540;
const INK = '#2b2233';
const PAPER = '#fffdf6';
const RED = '#e8566a';
const PINK = '#ff7ab8';
const FONT = 'Fredoka, "Trebuchet MS", Verdana, sans-serif';
const TAU = Math.PI * 2;

// ---- layout (kit units), from the spec's layout block
const MOUTH = { x: 300, y: 375 };            // tile i is drawn at x = MOUTH.x + (i - dN) * tilePx; grains sit at y 375
const HORIZON = 150;
const LANE = { y0: 150, y1: 190, feet: 181 }; // Kayvee's back path
const ROADY = { y0: 330, y1: 420 };
const STRIP = { x0: 24, x1: 936, y0: 8, y1: 52, a: 70, b: 890, y: 28 };
const BTN = {
  gulp: { x: 40, y: 468, w: 240, h: 60, fill: '#7bcd5d', word: 'GULP', key: 'Space' },
  shout: { x: 680, y: 468, w: 240, h: 60, fill: '#ffd35a', word: 'SHOUT', key: '↑' },
};
const HEAD = { x: 266, y: 341, s: 1.15 };    // about 69 x 53, facing right, the mouth at its right end (x 300)
const BELLY = { x: 190, r: 26 };
const REACH = { gulp: 34, shout: 44, ring: 40 };
const BODY = { amp: 18, wave: 160, w: 26 };
const TUMBLE_X = 36;
const STRIP_P = 640;                         // scrolling ground details repeat every 8 tiles
const DUNE_P = 1280;

// ---- spec defaults (the spec overrides every one of them)
const DEF = {
  roads: [
    '...r...!..l..e...!..u..!..l.....!.r..!..e.l..u.!..!.r..!....',
    '....l..!.e....!..!.r.u..l..!....e.!..u.r...!.l.e..!...!.r...',
    '...e..r...!..u.!.l......!.e.!..r.u.l...!..!.e....!.l.r..!...',
  ],
  roadCode: { '.': 'sand', r: 'ruby', l: 'lapis', e: 'emerald', u: 'um', '!': 'bell' },
  grains: {
    ruby: { kind: 'bead', color: '#e61f33', cut: 'round', word: 'RUBY' },
    lapis: { kind: 'bead', color: '#2659e6', cut: 'square', word: 'LAPIS' },
    emerald: { kind: 'bead', color: '#1abf59', cut: 'tall octagon', word: 'EMERALD' },
    sand: { kind: 'sand', color: '#d9b87a' },
    um: { kind: 'noise', color: '#ffffff' },
    bell: { kind: 'bell', color: '#2b2233' },
  },
  bubbles: {
    gulp: 'gulp!', blech: 'Blech!', clang: 'Clang!', chatty: 'Hm?', missedBell: '…', mush: 'Mush…', empty: '…',
    right: '{WORD}!', wrongBead: '{WORD}?', kayveeAnswer: '{Word}!', kayveeTaunt: 'Ha!', pass: 'PASS!', tumble: 'Go!',
  },
};

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const hexOr = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

const CONF = new WeakMap();
export function config(spec = {}) {
  const keyed = !!spec && typeof spec === 'object';
  if (keyed && CONF.has(spec)) return CONF.get(spec);
  if (!keyed) spec = {};
  const race = spec.race || {}, kv = race.kayvee || {}, dig = kv.rummage || {}, st = race.stall || {};
  const grains = {};
  for (const [id, g] of Object.entries({ ...DEF.grains, ...(spec.grains || {}) })) {
    const d = DEF.grains[id] || {};
    const kind = ['bead', 'sand', 'noise', 'bell'].includes(g?.kind) ? g.kind : d.kind || 'sand';
    const cut = String(g?.cut || d.cut || '');
    grains[id] = {
      kind, color: hexOr(g?.color, d.color || '#d9b87a'), word: String(g?.word || d.word || id).toUpperCase(),
      cut: /square/i.test(cut) ? 'square' : /tall|emerald/i.test(cut) ? 'tall' : 'round',
    };
  }
  const roads = (Array.isArray(spec.roads) ? spec.roads : []).map(String).filter((r) => r.length > 0);
  const C = {
    roads: roads.length ? roads : DEF.roads,
    code: { ...DEF.roadCode, ...(spec.roadCode || {}) },
    grains,
    tilePx: num(race.tilePx, 80), start: num(race.start, -3),
    vN: num(race.noodle?.speed, 1.8),
    v0: num(kv.v0, 3.4), alpha: num(kv.alpha, 0.03), digBase: num(dig.base, 0.3), digPer: num(dig.perGrain, 0.015),
    stallSmall: num(st.small, 0.6), stallBell: num(st.bell, 1.4),
    reachGulp: REACH.gulp, reachShout: REACH.shout,
    bubbles: { ...DEF.bubbles, ...(spec.bubbles || {}) },
  };
  if (keyed) CONF.set(spec, C);
  return C;
}

// ---- the race (pure: no drawing, no sound; events go to S.events for the presentation and S.log for tests)
export function newRace(C, roadIndex = 0) {
  const nR = C.roads.length;
  const ri = ((roadIndex % nR) + nR) % nR;
  const road = C.roads[ri];
  const tiles = [];
  let last = null;
  for (let i = 0; i < road.length; i++) {
    const tok = C.code[road[i]] || 'sand';
    const t = { i, tok, kind: C.grains[tok]?.kind || 'sand', done: null };
    if (t.kind === 'bead') last = tok;
    if (t.kind === 'bell') t.target = last;   // the most recent bead before the bell on the road
    tiles.push(t);
  }
  const bellTiles = tiles.filter((t) => t.kind === 'bell').map((t) => t.i);
  return {
    road, roadIndex: ri, L: road.length, finish: road.length + 1, start: C.start, tiles, bellTiles, bells: bellTiles.length,
    dN: C.start, dK: C.start, n: 0, kDig: 0, kDigFull: 0, kDigBell: -1, kNext: 0,
    belly: null, right: 0, mistakes: 0, slips: 0, bellMistakes: 0, stall: 0, stallFull: 0,
    winner: null, lead: null, passes: 0, raceT: 0, passIdx: 0, events: [], log: [],
  };
}
function emit(S, ev, tile, extra) {
  const e = { ev, t: Math.round(S.raceT * 1000) / 1000, ...(tile ? { i: tile.i } : {}), ...extra };
  S.events.push(e); S.log.push(e);
}
function hiccup(S, C, kind, ev, tile) {   // a mistake: Noodle stalls (stalls add up)
  const sec = kind === 'bell' ? C.stallBell : C.stallSmall;
  S.stall += sec; S.stallFull = S.stall;
  S.mistakes++;
  if (kind === 'bell') S.bellMistakes++; else S.slips++;
  emit(S, ev, tile, { stall: sec });
}
function inReach(S, C, px, ok) {
  const r = px / C.tilePx, c = Math.round(S.dN);
  for (let j = c - 1; j <= c + 1; j++) { const t = S.tiles[j]; if (t && Math.abs(j - S.dN) <= r && ok(t)) return t; }
  return null;
}
// the grain in gulp reach (a gulped grain is gone; a bell's post stays, flag or not)
export const gulpTarget = (S, C) => inReach(S, C, C.reachGulp, (t) => t.kind === 'bell' || !t.done);
export const shoutTarget = (S, C) => inReach(S, C, C.reachShout, (t) => t.kind === 'bell' && !t.done);

export function gulp(S, C) {
  if (S.winner || S.stall > 0) return 'ignored';
  const t = gulpTarget(S, C);
  if (!t) { emit(S, 'chomp'); return 'chomp'; }
  if (t.kind === 'bell') { hiccup(S, C, 'small', 'clang', t); return 'clang'; }
  t.done = 'gulped';
  if (t.kind === 'bead') { S.belly = t.tok; emit(S, 'gulp', t, { tok: t.tok }); return 'gulp'; }
  S.belly = 'mush';
  hiccup(S, C, 'small', 'blech', t);
  return 'blech';
}
export function shout(S, C) {
  if (S.winner || S.stall > 0) return 'ignored';
  const b = shoutTarget(S, C);
  if (!b) { hiccup(S, C, 'small', 'hm'); return 'hm'; }
  b.said = S.belly;
  if (S.belly != null && S.belly === b.target) { b.done = 'ok'; S.right++; emit(S, 'right', b, { tok: b.target }); return 'right'; }
  b.done = 'wrong';
  hiccup(S, C, 'bell', 'wrong', b);
  return 'wrong';
}
function kayveeStep(S, C, dt) {   // exact: his speed changes at every tile, he digs at every bell
  let tau = dt;
  for (let guard = 0; tau > 1e-9 && S.dK < S.finish && guard < 400; guard++) {
    if (S.kDig > 0) {
      const s = Math.min(S.kDig, tau); S.kDig -= s; tau -= s;
      if (S.kDig <= 1e-9) { S.kDig = 0; const b = S.tiles[S.kDigBell]; emit(S, 'kAnswer', b, { tok: b?.target }); }
      continue;
    }
    const n = S.dK < 0 ? 0 : Math.min(S.L, Math.floor(S.dK) + 1);
    const v = C.v0 / (1 + C.alpha * n);
    const bell = S.bellTiles[S.kNext];
    const target = Math.min(Math.floor(S.dK) + 1, S.finish, bell ?? Infinity);
    const need = (target - S.dK) / v;
    if (need > tau) { S.dK += v * tau; tau = 0; }
    else {
      S.dK = target; tau -= need;
      if (bell !== undefined && target === bell) {
        S.kNext++; S.kDigBell = bell; S.kDig = S.kDigFull = C.digBase + C.digPer * (bell + 1);
        emit(S, 'dig', S.tiles[bell]);
      }
    }
  }
  S.n = S.dK < 0 ? 0 : Math.min(S.L, Math.floor(S.dK) + 1);
}
export function advance(S, C, dt) {
  if (S.winner) return;
  S.raceT += dt;
  let move = dt;
  if (S.stall > 0) { const s = Math.min(S.stall, move); S.stall -= s; move -= s; if (S.stall <= 1e-9) S.stall = 0; }
  if (move > 0) S.dN += C.vN * move;
  const gone = C.reachShout / C.tilePx;           // a grain is past once it leaves the shout reach
  while (S.passIdx < S.L && S.passIdx - S.dN < -gone) {
    const t = S.tiles[S.passIdx++];
    if (t.done) continue;
    if (t.kind === 'bell') { t.done = 'missed'; hiccup(S, C, 'bell', 'missBell', t); }
    else { t.done = 'slid'; if (t.kind === 'bead') emit(S, 'missBead', t); }
  }
  kayveeStep(S, C, dt);
  const gap = S.dN - S.dK;
  if (gap > 0.25 && S.lead !== 'noodle') {
    if (S.lead === 'kayvee') { S.passes++; emit(S, 'pass', null, { first: S.passes === 1 }); }
    S.lead = 'noodle';
  } else if (gap < -0.25 && S.lead !== 'kayvee') {
    if (S.lead === 'noodle') emit(S, 'kLead');
    S.lead = 'kayvee';
  }
  if (S.dN >= S.finish) { S.dN = S.finish; S.winner = 'noodle'; emit(S, 'won'); }   // Noodle first
  else if (S.dK >= S.finish) { S.winner = 'kayvee'; emit(S, 'lost'); }
}
// headless run of one race: policy(S, C) -> { gulp, shout } every step
export function simulate(spec, roadIndex, policy, { dt = 1 / 60, maxT = 150 } = {}) {
  const C = config(spec);
  const S = newRace(C, roadIndex);
  while (!S.winner && S.raceT < maxT) {
    const a = policy(S, C) || {};
    if (a.gulp) gulp(S, C);
    if (a.shout) shout(S, C);
    advance(S, C, dt);
    S.events.length = 0;
  }
  return S;
}

// ---- colours
function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function shade(hex, k) { // k > 0 toward white, k < 0 toward black
  const [r, g, b] = rgbOf(hex), t = k > 0 ? 255 : 0, a = Math.min(1, Math.abs(k));
  return `rgb(${Math.round(r + (t - r) * a)},${Math.round(g + (t - g) * a)},${Math.round(b + (t - b) * a)})`;
}
function speckColors() {
  let c = null;
  try { c = getSave()?.character; } catch { /* no save */ }
  c = c && typeof c === 'object' ? c : {};
  return { skin: hexOr(c.skin, '#e8b796'), hair: hexOr(c.hairColor, '#3b2a20'), top: hexOr(c.topColor, '#4f86d8'), bald: c.hairStyle === 'bald' };
}

// ---- cached art: whatever does not change from frame to frame is painted once into an offscreen canvas
const DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
function makeSprite(w, h, ox, oy, paint) { // (ox, oy): where the painter's origin sits inside the sprite
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = c.getContext('2d');
  g.scale(DPR, DPR); g.translate(ox, oy); g.lineJoin = 'round'; g.lineCap = 'round';
  paint(g);
  return { c, w, h, ox, oy };
}
const blit = (g, sp, x = 0, y = 0) => g.drawImage(sp.c, x - sp.ox, y - sp.oy, sp.w, sp.h);
function stamp(g, sp, x, y, s = 1, rot = 0, alpha = 1) {
  if (alpha <= 0) return;
  g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (s !== 1) g.scale(s, s); if (alpha !== 1) g.globalAlpha *= alpha;
  blit(g, sp); g.restore();
}
function outlined(sp, r = 3, color = '#ffffff') { // the same sprite with a cut-paper edge around it
  const pad = r + 1;
  return makeSprite(sp.w + 2 * pad, sp.h + 2 * pad, sp.ox + pad, sp.oy + pad, (g) => {
    const sil = document.createElement('canvas'); sil.width = sp.c.width; sil.height = sp.c.height;
    const sg = sil.getContext('2d'); sg.drawImage(sp.c, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = color; sg.fillRect(0, 0, sil.width, sil.height);
    for (let a = 0; a < 12; a++) g.drawImage(sil, -sp.ox + Math.cos((a / 12) * TAU) * r, -sp.oy + Math.sin((a / 12) * TAU) * r, sp.w, sp.h);
    g.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
  });
}
const ART = new Map();
const art = (key, make) => { let sp = ART.get(key); if (!sp) { sp = make(); ART.set(key, sp); } return sp; };
// text art made before the Fredoka web font arrives is made again once it is there
const fontKey = () => { try { return document.fonts.check(`700 16px ${FONT}`) ? '' : '~'; } catch { return ''; } };
let MEASURE = null;
const measure = () => (MEASURE ||= document.createElement('canvas').getContext('2d'));

// ---- small painters
function poly(g, pts) { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
function rr(g, x, y, w, h, r) { draw.roundRect(g, x, y, w, h, Math.min(r, w / 2, h / 2)); }
function star(g, x, y, r, pts = 5) {
  g.beginPath();
  for (let k = 0; k < pts * 2; k++) { const a = -Math.PI / 2 + (k * Math.PI) / pts, rr2 = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
  g.closePath();
}
function txt(g, s, x, y, { size = 20, color = INK, align = 'center', outline = null, lw = 0, weight = 700 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  if (outline) { g.lineJoin = 'round'; g.lineWidth = lw || size * 0.28; g.strokeStyle = outline; g.strokeText(s, x, y); }
  g.fillStyle = color; g.fillText(s, x, y);
}
function facet(g, pts, color) { // one facet of a cut gem, lit from the top left
  let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  const len = Math.hypot(cx, cy) || 1, lit = (-cx - cy) / (len * Math.SQRT2);
  poly(g, pts); g.fillStyle = lit > 0 ? shade(color, 0.1 + 0.48 * lit) : shade(color, 0.36 * lit); g.fill();
}
function paintBead(g, cut, color, s = 1, lw = 3) { // 34 px faceted gem centred on (0, 0)
  g.save(); g.scale(s, s); g.lineJoin = 'round';
  let outer, inner;
  if (cut === 'square') {                   // square, with a bevelled frame
    const R = 15, r = 7.5;
    outer = [[-R, -R], [R, -R], [R, R], [-R, R]]; inner = [[-r, -r], [r, -r], [r, r], [-r, r]];
  } else if (cut === 'tall') {              // tall octagon (emerald cut)
    const w = 12, h = 17, c = 5.5, w2 = 5.5, h2 = 10, c2 = 2.5;
    outer = [[-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c]];
    inner = [[-w2 + c2, -h2], [w2 - c2, -h2], [w2, -h2 + c2], [w2, h2 - c2], [w2 - c2, h2], [-w2 + c2, h2], [-w2, h2 - c2], [-w2, -h2 + c2]];
  } else {                                  // round: an octagon with a star of facets
    const R = 17, r = 8.6;
    outer = []; inner = [];
    for (let k = 0; k < 8; k++) { const a = -Math.PI / 2 + Math.PI / 8 + (k * Math.PI) / 4; outer.push([Math.cos(a) * R, Math.sin(a) * R]); }
    for (let k = 0; k < 8; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 4; inner.push([Math.cos(a) * r, Math.sin(a) * r]); }
  }
  // soft drop shadow, then facets
  g.save(); g.translate(0, 3); poly(g, outer); g.fillStyle = 'rgba(43,34,51,.25)'; g.fill(); g.restore();
  const n = outer.length;
  if (cut === 'round') {
    for (let k = 0; k < n; k++) {
      const o0 = outer[k], o1 = outer[(k + 1) % n], i0 = inner[k], i1 = inner[(k + 1) % n];
      facet(g, [i0, o0, i1], color); facet(g, [o0, o1, i1], shade(color, -0.12));
    }
  } else {
    for (let k = 0; k < n; k++) facet(g, [outer[k], outer[(k + 1) % n], inner[(k + 1) % n], inner[k]], color);
  }
  poly(g, inner); g.fillStyle = shade(color, 0.22); g.fill();
  g.strokeStyle = 'rgba(43,34,51,.42)'; g.lineWidth = 1.2;
  for (let k = 0; k < n; k++) { g.beginPath(); g.moveTo(...outer[k]); g.lineTo(...inner[cut === 'round' ? k : k]); g.stroke(); }
  if (cut === 'round') for (let k = 0; k < n; k++) { g.beginPath(); g.moveTo(...outer[k]); g.lineTo(...inner[(k + 1) % n]); g.stroke(); }
  poly(g, inner); g.stroke();
  poly(g, outer); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.save(); g.translate(cut === 'tall' ? -4 : -6, cut === 'tall' ? -9 : -7); g.rotate(-0.7); g.beginPath(); g.ellipse(0, 0, 4.2, 1.9, 0, 0, TAU); g.fill(); g.restore();
  g.beginPath(); g.arc(cut === 'tall' ? 3 : 5, cut === 'tall' ? -12 : -10, 1.3, 0, TAU); g.fill();
  g.restore();
}
function paintSand(g, v) { // a low heap with darker dots, sitting on (0, 8)
  const w = 18 + (v % 3) * 2.5, h = 10 + ((v >> 1) % 3) * 2.5;
  g.save(); g.translate(0, 3); g.beginPath(); g.ellipse(0, 6, w + 1, 4, 0, 0, TAU); g.fillStyle = 'rgba(43,34,51,.16)'; g.fill(); g.restore();
  g.beginPath(); g.moveTo(-w, 8); g.quadraticCurveTo(-w * 0.55, -h, 0, -h); g.quadraticCurveTo(w * 0.55, -h, w, 8); g.closePath();
  g.fillStyle = '#d9b87a'; g.fill(); g.lineWidth = 2.6; g.strokeStyle = 'rgba(43,34,51,.6)'; g.stroke();
  g.beginPath(); g.moveTo(-w * 0.5, -h * 0.35); g.quadraticCurveTo(-w * 0.2, -h * 0.95, w * 0.15, -h * 0.85); g.lineWidth = 3; g.strokeStyle = '#ecd6a4'; g.stroke();
  g.fillStyle = '#a8834c';
  let seed = 17 + v * 31;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 6; k++) { const x = (rnd() * 2 - 1) * w * 0.62, y = 5 - rnd() * (h * 0.85) * (1 - Math.abs(x) / w); g.beginPath(); g.arc(x, y, 1.5, 0, TAU); g.fill(); }
}
function paintUm(g) { // a little paper speech bubble: one of Umberto's fillers
  g.save(); g.rotate(-0.07);
  g.save(); g.translate(0, 3);
  rr(g, -21, -15, 42, 26, 12); g.fillStyle = 'rgba(43,34,51,.2)'; g.fill(); g.restore();
  g.beginPath(); g.moveTo(-11, 8); g.lineTo(-17, 18); g.lineTo(-2, 9); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke();
  rr(g, -21, -15, 42, 26, 12); g.fillStyle = '#fff'; g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-10, 9.6); g.lineTo(-4, 9.6); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  txt(g, 'um', 0, -2.5, { size: 17, color: '#8f879b' });
  g.restore();
}
const POST_TOP = -92;                         // the bell's post rises from the road (foot at y +16) above Noodle's head
const BELL_AT = { x: 13, y: POST_TOP + 4 };    // where the bell hangs, relative to the post's foot line
function paintPost(g, faint) { // the bell's post and bracket, foot at (0, 16)
  if (!faint) { g.save(); g.translate(0, 3); g.beginPath(); g.ellipse(0, 15, 12, 3.5, 0, 0, TAU); g.fillStyle = 'rgba(43,34,51,.2)'; g.fill(); g.restore(); }
  draw.paper(g, () => rr(g, -3, POST_TOP, 6, 16 - POST_TOP, 3), '#7a5634', { lw: 2.2, shadow: false });
  draw.paper(g, () => rr(g, -3, POST_TOP, 20, 5, 2.5), '#7a5634', { lw: 2.2, shadow: false });
  if (!faint) { // a small red ribbon
    const y = -4;
    g.fillStyle = '#e8566a'; g.strokeStyle = INK; g.lineWidth = 1.8;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(s * 9, y - 5); g.lineTo(s * 9, y + 5); g.closePath(); g.fill(); g.stroke(); }
    g.beginPath(); g.moveTo(-1, y + 2); g.lineTo(-5, y + 12); g.lineTo(-1, y + 9); g.lineTo(2, y + 12); g.lineTo(1, y + 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, y, 3, 0, TAU); g.fill(); g.stroke();
  }
}
function paintBell(g) { // the ink bell, hook at (0, 0)
  g.lineWidth = 2.4; g.strokeStyle = INK;
  g.beginPath(); g.arc(0, 2, 3, 0, TAU); g.stroke();
  g.beginPath();
  g.moveTo(-12, 22); g.quadraticCurveTo(-11, 6, -6, 5); g.quadraticCurveTo(0, 2, 6, 5); g.quadraticCurveTo(11, 6, 12, 22); g.closePath();
  g.save(); g.translate(0, 3); g.fillStyle = 'rgba(43,34,51,.2)'; g.fill(); g.restore();
  g.fillStyle = '#3a2f45'; g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-7, 18); g.quadraticCurveTo(-7, 9, -3, 8); g.lineWidth = 2.6; g.strokeStyle = '#7d6f90'; g.stroke();
  draw.paper(g, () => rr(g, -14.5, 19.5, 29, 6, 3), '#4a3d58', { lw: 2.2, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.arc(0, 28, 3.6, 0, TAU); }, '#ffd35a', { lw: 2, shadow: false });
}
function paintFlag(g, good) { // a pennant on top of the post: ✓ green or ✕ red
  draw.paper(g, () => rr(g, -2, -24, 4, 26, 2), '#7a5634', { lw: 1.8, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.moveTo(1, -24); g.lineTo(30, -16); g.lineTo(1, -7); g.closePath(); }, good ? '#5cc35a' : RED, { lw: 2.4 });
  g.strokeStyle = '#fff'; g.lineWidth = 3.2;
  g.beginPath();
  if (good) { g.moveTo(7, -16); g.lineTo(11, -12); g.lineTo(18, -20); } else { g.moveTo(8, -20); g.lineTo(16, -12); g.moveTo(16, -20); g.lineTo(8, -12); }
  g.stroke();
}

// ---- characters
function headPaths(g) { // Noodle's head, facing right, centre (0, 0), 60 x 46; the jaw hinges at (-8, 9)
  return {
    upper() {
      g.beginPath();
      g.moveTo(-28, 11);
      g.bezierCurveTo(-33, -9, -19, -23, 0, -23);
      g.bezierCurveTo(16, -23, 28, -15, 31, -3);
      g.quadraticCurveTo(33, 5, 27, 8.5);
      g.lineTo(-8, 9);
      g.quadraticCurveTo(-18, 14, -28, 11);
      g.closePath();
    },
    jaw() {
      g.beginPath();
      g.moveTo(-8, 9); g.lineTo(27, 8.5);
      g.quadraticCurveTo(27, 17, 15, 20);
      g.bezierCurveTo(4, 23, -15, 22, -21, 15);
      g.quadraticCurveTo(-14, 11, -8, 9);
      g.closePath();
    },
  };
}
function paintHead(g, mood) {
  const P = headPaths(g);
  const open = { open: 0.5, shout: 0.72, blech: 0.3, idle: 0, happy: 0.12, dizzy: 0, sad: 0 }[mood] || 0;
  g.save(); g.translate(0, 5); P.upper(); g.fillStyle = 'rgba(43,34,51,.22)'; g.fill(); g.restore();
  // the mouth inside, then the jaw (rotated open around the hinge), then the upper head
  if (open > 0) {
    g.save(); g.translate(-8, 9); g.rotate(open); g.translate(8, -9);
    P.jaw(); g.restore();
    g.beginPath(); g.moveTo(-8, 9); g.lineTo(27, 8.5);
    const jx = -8 + Math.cos(open) * 35, jy = 9 + Math.sin(open) * 35;
    g.lineTo(jx, jy); g.closePath(); g.fillStyle = '#7a2a3a'; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.ellipse(4 + 6 * open, 13 + 8 * open, 9, 4 + 3 * open, open * 0.5, 0, TAU); g.fillStyle = '#ff8fb0'; g.fill();
  }
  g.save(); g.translate(-8, 9); g.rotate(open); g.translate(8, -9);
  P.jaw(); g.fillStyle = '#a8dd7c'; g.fill(); g.lineWidth = 3.4; g.strokeStyle = INK; g.stroke();
  g.restore();
  if (mood === 'blech') { // tongue out, wiggly, forked
    g.beginPath(); g.moveTo(20, 13); g.bezierCurveTo(30, 12, 33, 22, 42, 20); g.lineTo(47, 16); g.moveTo(42, 20); g.lineTo(47, 24);
    g.lineWidth = 6.5; g.strokeStyle = INK; g.stroke(); g.lineWidth = 3.4; g.strokeStyle = '#ff6f98'; g.stroke();
  }
  P.upper(); g.fillStyle = '#6cc24a'; g.fill(); g.lineWidth = 3.6; g.strokeStyle = INK; g.stroke();
  g.fillStyle = '#58a83c';
  for (const [x, y, r] of [[-13, -14, 3.6], [-21, -3, 3], [-4, -19, 2.4], [-14, 2, 2.2]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  g.fillStyle = INK; g.beginPath(); g.ellipse(26, -6, 1.6, 1.2, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,122,150,.5)'; g.beginPath(); g.ellipse(13, 2.5, 5, 3, 0, 0, TAU); g.fill();
  if (open === 0 && mood !== 'sad' && mood !== 'dizzy') { g.beginPath(); g.moveTo(26, 9); g.quadraticCurveTo(20, 13.5, 13, 10); g.lineWidth = 2.4; g.strokeStyle = INK; g.stroke(); }
  // the eye
  const ex = 6, ey = -10;
  g.lineWidth = 2.6; g.strokeStyle = INK;
  if (mood === 'happy') { g.beginPath(); g.arc(ex, ey + 2, 6.5, Math.PI * 1.1, Math.PI * 1.9); g.lineWidth = 3.2; g.stroke(); }
  else if (mood === 'blech') { g.beginPath(); g.moveTo(ex - 6, ey - 5); g.lineTo(ex + 3, ey); g.lineTo(ex - 6, ey + 5); g.lineWidth = 3.2; g.stroke(); }
  else if (mood === 'dizzy') {
    g.beginPath(); g.arc(ex, ey, 8.5, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.stroke();
    g.beginPath(); for (let a = 0; a < 4 * Math.PI; a += 0.3) { const r = 0.6 + a * 0.52; g.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); } g.lineWidth = 1.8; g.stroke();
  } else {
    g.beginPath(); g.arc(ex, ey, 8.5, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.stroke();
    const big = mood === 'shout' || mood === 'open';
    g.fillStyle = INK; g.beginPath(); g.arc(ex + 2.2, ey + (mood === 'sad' ? 2 : 0.5), big ? 5.4 : 4.8, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + 0.6, ey - 1.6, 1.8, 0, TAU); g.fill();
    if (mood === 'sad') { g.beginPath(); g.moveTo(ex - 9, ey - 6); g.lineTo(ex + 8, ey - 10); g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); }
    if (mood === 'shout') { g.beginPath(); g.moveTo(ex - 7, ey - 13); g.quadraticCurveTo(ex, ey - 17, ex + 8, ey - 13); g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke(); }
  }
}
function paintSpeck(g, C, pose) { // the tiny paper human, feet at (0, 0), ~40 tall, facing right
  g.fillStyle = INK;
  for (const sx of [-4, 4]) { g.beginPath(); g.ellipse(sx + 1, -1.6, 3.6, 2.3, 0, 0, TAU); g.fill(); }
  for (const sx of [-5.2, 1.2]) draw.paper(g, () => rr(g, sx, -9, 4, 8, 2), '#3a3a5a', { lw: 1.8, shadow: false });
  const arm = (side, rot) => {
    g.save(); g.translate(side * 7, -19); g.rotate(rot);
    draw.paper(g, () => rr(g, -2.2, -1, 4.4, 9.5, 2.2), C.top, { lw: 1.8, shadow: false });
    g.fillStyle = C.skin; g.beginPath(); g.arc(0, 9, 2.4, 0, TAU); g.fill(); g.lineWidth = 1.4; g.strokeStyle = INK; g.stroke();
    g.restore();
  };
  const rots = { idle: [0.35, -0.35], point: [0.3, -1.9], cheer: [2.6, -2.6], sad: [0.15, -0.15] }[pose] || [0.35, -0.35];
  arm(-1, rots[0]);
  draw.paper(g, () => rr(g, -8, -22.5, 16, 15, 6), C.top, { lw: 2.2, shadow: false });
  arm(1, rots[1]);
  draw.paper(g, () => { g.beginPath(); g.arc(1, -30.5, 9.5, 0, TAU); }, C.skin, { lw: 2.2, shadow: false });
  if (!C.bald) {
    draw.paper(g, () => { g.beginPath(); g.arc(1, -30.5, 9.9, Math.PI * 0.95, Math.PI * 2.05); g.quadraticCurveTo(6, -31, 0, -33.5); g.quadraticCurveTo(-5, -31, -8.8, -27.5); g.closePath(); }, C.hair, { lw: 2, shadow: false });
  }
  g.fillStyle = INK;
  if (pose === 'cheer') { g.lineWidth = 1.6; g.strokeStyle = INK; for (const ex of [2.4, 7]) { g.beginPath(); g.arc(ex, -29, 1.8, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); } }
  else for (const ex of [2.6, 7.2]) { g.beginPath(); g.arc(ex, -29.5, 1.5, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(255,122,150,.55)'; g.beginPath(); g.ellipse(8, -25.5, 2, 1.3, 0, 0, TAU); g.fill();
  g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath();
  if (pose === 'sad') g.arc(5.5, -22.6, 2, Math.PI * 1.15, Math.PI * 1.85); else g.arc(5.5, -25.5, 2.2, 0.2, Math.PI - 0.2);
  g.stroke();
}
function paintTumble(g, cheer) { // the bunny's head on Noodle's tail, centre (0, 0)
  const FUR = '#fff4f8', INNER = '#ffc2d6';
  for (const [x, y, r] of [[-6, -22, -0.22], [6, -24, 0.18]]) {
    g.save(); g.translate(x, y); g.rotate(r + (cheer ? (x < 0 ? -0.25 : 0.25) : 0));
    draw.paper(g, () => { g.beginPath(); g.ellipse(0, 0, 5.6, 15, 0, 0, TAU); }, FUR, { lw: 2.4, shadow: false });
    g.fillStyle = INNER; g.beginPath(); g.ellipse(0, 1.5, 2.6, 10, 0, 0, TAU); g.fill();
    g.restore();
  }
  draw.paper(g, () => { g.beginPath(); g.ellipse(0, 0, 15.5, 13.5, 0, 0, TAU); }, FUR, { lw: 2.6, shadow: false });
  g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = 1.8;
  for (const ex of [-5, 6]) {
    if (cheer) { g.beginPath(); g.arc(ex, -1, 2.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    else { g.beginPath(); g.arc(ex, -2, 2, 0, TAU); g.fill(); }
  }
  g.fillStyle = 'rgba(255,122,150,.55)'; for (const cx of [-9.5, 10.5]) { g.beginPath(); g.ellipse(cx, 3.5, 3, 2, 0, 0, TAU); g.fill(); }
  g.fillStyle = '#ff8fb0'; g.beginPath(); g.moveTo(-1.8, 2); g.lineTo(2.4, 2); g.lineTo(0.3, 4.6); g.closePath(); g.fill();
  if (cheer) { g.beginPath(); g.ellipse(0.3, 8, 3.2, 2.6, 0, 0, TAU); g.fillStyle = '#7a2a3a'; g.fill(); }
  else { g.beginPath(); g.moveTo(-3, 6.5); g.quadraticCurveTo(-1.2, 8.4, 0.3, 6.5); g.quadraticCurveTo(1.8, 8.4, 3.6, 6.5); g.lineWidth = 1.5; g.stroke(); }
  draw.paper(g, () => { g.beginPath(); g.moveTo(-12, 10); g.quadraticCurveTo(0, 18, 12, 10); g.lineTo(9, 15); g.quadraticCurveTo(0, 20, -9, 15); g.closePath(); }, PINK, { lw: 2.2, shadow: false });
  for (const px of [-10, 10]) draw.paper(g, () => { g.beginPath(); g.ellipse(px, 16, 4.6, 3.4, 0, 0, TAU); }, FUR, { lw: 2, shadow: false });
}
const KFUR = '#c7a27a', KSHIRT = '#a05a8c', KWOOD = '#b8864e';
function paintKayvee(g, pose, step) { // the pack-rat, feet at (0, 0), facing right; hands at the cart handle (17, -24)
  const ph = (step / 8) * TAU, sw = Math.sin(ph) * 0.55, dig = pose === 'dig';
  g.save();
  if (dig) { g.rotate(0.32); }
  // tail
  g.beginPath(); g.moveTo(-9, -12); g.bezierCurveTo(-22, -10, -24, -24, -34, -20); g.lineWidth = 4.5; g.strokeStyle = INK; g.stroke(); g.lineWidth = 2.2; g.strokeStyle = '#eeb3c2'; g.stroke();
  // legs
  for (const [side, a] of [[-1, -sw], [1, sw]]) {
    g.save(); g.translate(side * 3, -9); g.rotate(a);
    draw.paper(g, () => rr(g, -2.6, -1, 5.2, 9.5, 2.4), KFUR, { lw: 1.8, shadow: false });
    g.fillStyle = INK; g.beginPath(); g.ellipse(1.5, 9, 3.6, 2.2, 0, 0, TAU); g.fill();
    g.restore();
  }
  // body (purple shirt)
  draw.paper(g, () => rr(g, -10, -30, 20, 22, 8), KSHIRT, { lw: 2.4, shadow: false });
  // arms to the handle (or into the heap while digging)
  for (const [y0, k] of [[-25, 0], [-22, 1]]) {
    g.save(); g.translate(4, y0); g.rotate(dig ? -1.2 - k * 0.5 + Math.sin(ph * 2 + k) * 0.4 : -0.15 + k * 0.12);
    draw.paper(g, () => rr(g, -2.4, -2.4, 15, 4.8, 2.4), KSHIRT, { lw: 1.8, shadow: false });
    g.fillStyle = KFUR; g.beginPath(); g.arc(13.5, 0, 2.8, 0, TAU); g.fill(); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke();
    g.restore();
  }
  // head: ears, round head, pointed snout with a pink nose
  for (const [x, y, r] of [[-7, -51, 7.5], [3, -54, 8]]) {
    draw.paper(g, () => { g.beginPath(); g.arc(x, y, r, 0, TAU); }, KFUR, { lw: 2.2, shadow: false });
    g.fillStyle = '#f2b8c6'; g.beginPath(); g.arc(x + 0.5, y + 0.5, r * 0.55, 0, TAU); g.fill();
  }
  draw.paper(g, () => { g.beginPath(); g.moveTo(-11, -40); g.bezierCurveTo(-12, -52, 4, -54, 9, -46); g.quadraticCurveTo(16, -42, 21, -39); g.quadraticCurveTo(12, -31, -2, -32); g.quadraticCurveTo(-11, -32, -11, -40); g.closePath(); }, KFUR, { lw: 2.4, shadow: false });
  g.fillStyle = '#ff8fb0'; g.beginPath(); g.arc(21, -39, 2.6, 0, TAU); g.fill(); g.lineWidth = 1.4; g.strokeStyle = INK; g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(6, -43, 1.9, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,122,150,.5)'; g.beginPath(); g.ellipse(8, -37, 2.6, 1.6, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(43,34,51,.6)'; g.lineWidth = 1;
  for (const dy of [-1.5, 1.5]) { g.beginPath(); g.moveTo(17, -38 + dy); g.lineTo(27, -38 + dy * 2.4); g.stroke(); }
  g.restore();
}
function cartItems(S) { // what Kayvee kept, tile by tile: positions in his heap
  const items = [];
  let seed = 9 + S.roadIndex * 101;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < S.L; k++) {
    const level = 4 + 0.86 * k;                       // item k sits at about this height in the pile
    const halfW = 27 * Math.sqrt(Math.max(0.08, 1 - level / 60)) + 3;
    items.push({ tok: S.tiles[k].tok, kind: S.tiles[k].kind, x: (rnd() * 2 - 1) * halfW, y: -level * (0.78 + rnd() * 0.12), rot: rnd() * 6, env: rnd() < 0.32 });
  }
  return items;
}
function heapHeight(n) { return n <= 0 ? 0 : Math.min(60, 5 + 0.9 * n); }
function paintHeap(g, S, C, n, items) { // his pile on the cart top, base at (0, 0)
  if (n <= 0) return;
  const h = heapHeight(n), tower = n > 50 ? (n - 50) / 10 : 0;
  const wB = 32, wT = lerp(10, 4, tower);
  const mound = () => { g.beginPath(); g.moveTo(-wB, 0); g.bezierCurveTo(-wB, -h * 0.55, -wT - 6, -h, 0, -h); g.bezierCurveTo(wT + 6, -h, wB, -h * 0.55, wB, 0); g.closePath(); };
  draw.paper(g, mound, '#f3e5c6', { lw: 2.6 });
  g.save(); mound(); g.clip();
  for (let k = 0; k < n; k++) {
    const it = items[k];
    g.save(); g.translate(it.x * (1 - tower * 0.45), it.y * (h / heapHeight(Math.max(n, 1))) * (k < n ? 1 : 0)); g.rotate(it.rot);
    if (it.env) { g.fillStyle = '#fffaf0'; g.strokeStyle = 'rgba(43,34,51,.6)'; g.lineWidth = 1.1; g.fillRect(-5, -3.5, 10, 7); g.strokeRect(-5, -3.5, 10, 7); g.beginPath(); g.moveTo(-5, -3.5); g.lineTo(0, 0.5); g.lineTo(5, -3.5); g.stroke(); }
    else if (it.kind === 'bead') { g.fillStyle = C.grains[it.tok]?.color || '#e61f33'; g.strokeStyle = INK; g.lineWidth = 1.1; g.beginPath(); g.moveTo(0, -4); g.lineTo(4, 0); g.lineTo(0, 4); g.lineTo(-4, 0); g.closePath(); g.fill(); g.stroke(); }
    else if (it.kind === 'bell') { g.fillStyle = '#3a2f45'; g.beginPath(); g.moveTo(-3.5, 3); g.quadraticCurveTo(-3.5, -3.5, 0, -3.5); g.quadraticCurveTo(3.5, -3.5, 3.5, 3); g.closePath(); g.fill(); }
    else if (it.kind === 'noise') { g.fillStyle = '#fff'; g.strokeStyle = 'rgba(43,34,51,.6)'; g.lineWidth = 1; rr(g, -4.5, -3, 9, 6, 3); g.fill(); g.stroke(); }
    else { g.fillStyle = '#d4af6c'; g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill(); }
    g.restore();
  }
  g.restore();
  mound(); g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke();
}
function paintCart(g) { // the wooden cart, front edge at (0, 0) = Kayvee's race position, wheels on the ground
  g.save(); g.translate(0, 0);
  g.lineWidth = 3; g.strokeStyle = INK;
  g.beginPath(); g.moveTo(-66, -22); g.lineTo(-84, -26); g.stroke();                       // handle
  g.lineWidth = 1.6; g.strokeStyle = '#8a5f33'; g.stroke();
  draw.paper(g, () => rr(g, -66, -34, 64, 24, 4), KWOOD, { lw: 3 });
  g.strokeStyle = '#8f6237'; g.lineWidth = 1.8;
  for (const x of [-50, -34, -18]) { g.beginPath(); g.moveTo(x, -31); g.lineTo(x, -13); g.stroke(); }
  g.beginPath(); g.moveTo(-63, -22); g.lineTo(-5, -22); g.stroke();
  for (const wx of [-52, -16]) {
    draw.paper(g, () => { g.beginPath(); g.arc(wx, -8, 8.5, 0, TAU); }, '#7a5230', { lw: 2.6, shadow: false });
    g.fillStyle = '#e9c48a'; g.beginPath(); g.arc(wx, -8, 2.6, 0, TAU); g.fill();
  }
  g.restore();
}
function paintSnakeIcon(g) { // race strip marker: Noodle's head (26 px) with the Speck's dot
  g.save(); g.scale(0.44, 0.44); paintHead(g, 'idle'); g.restore();
}
function paintMouseIcon(g) { // race strip marker: Kayvee's head
  for (const [x, y, r] of [[-6, -8, 5.2], [3, -10, 5.6]]) { draw.paper(g, () => { g.beginPath(); g.arc(x, y, r, 0, TAU); }, KFUR, { lw: 2, shadow: false }); g.fillStyle = '#f2b8c6'; g.beginPath(); g.arc(x, y, r * 0.5, 0, TAU); g.fill(); }
  draw.paper(g, () => { g.beginPath(); g.moveTo(-9, 2); g.bezierCurveTo(-10, -8, 4, -9, 7, -3); g.quadraticCurveTo(11, 0, 14, 2); g.quadraticCurveTo(7, 8, -2, 7); g.quadraticCurveTo(-9, 7, -9, 2); g.closePath(); }, KFUR, { lw: 2.2, shadow: false });
  g.fillStyle = '#ff8fb0'; g.beginPath(); g.arc(14, 2, 2, 0, TAU); g.fill();
  g.fillStyle = INK; g.beginPath(); g.arc(4, -1, 1.5, 0, TAU); g.fill();
}
function paintTinyCart(g, n) { // race strip: his cart, the heap growing with n
  const h = Math.min(14, 1 + n * 0.22);
  if (n > 0) draw.paper(g, () => { g.beginPath(); g.moveTo(-9, -5); g.quadraticCurveTo(-8, -5 - h, 0, -5 - h); g.quadraticCurveTo(8, -5 - h, 9, -5); g.closePath(); }, '#f3e5c6', { lw: 1.8, shadow: false });
  draw.paper(g, () => rr(g, -10, -6, 20, 9, 2), KWOOD, { lw: 2, shadow: false });
  for (const wx of [-5, 5]) { g.fillStyle = INK; g.beginPath(); g.arc(wx, 4.5, 2.6, 0, TAU); g.fill(); }
}
function paintPostBox(g) { // Penny's red post box on a post, foot at (0, 0)
  g.save(); g.translate(0, 2); g.beginPath(); g.ellipse(0, 0, 13, 3.5, 0, 0, TAU); g.fillStyle = 'rgba(43,34,51,.22)'; g.fill(); g.restore();
  draw.paper(g, () => rr(g, -3.5, -40, 7, 40, 3), '#5b4a3a', { lw: 2.2, shadow: false });
  draw.paper(g, () => { g.beginPath(); g.moveTo(-15, -40); g.lineTo(-15, -62); g.quadraticCurveTo(-15, -74, 0, -74); g.quadraticCurveTo(15, -74, 15, -62); g.lineTo(15, -40); g.closePath(); }, '#c8453c', { lw: 3 });
  draw.paper(g, () => rr(g, -9, -64, 18, 3.6, 1.8), INK, { lw: 1, shadow: false });
  g.fillStyle = '#fffdf6'; g.fillRect(-7, -56, 14, 9); g.strokeStyle = INK; g.lineWidth = 1.4; g.strokeRect(-7, -56, 14, 9);
  g.beginPath(); g.moveTo(-7, -56); g.lineTo(0, -51); g.lineTo(7, -56); g.stroke();
}
function paintPostOffice(g) { // the little post office behind the finish, base at (0, 0)
  g.save(); g.translate(0, 3); rr(g, -66, -96, 132, 96, 8); g.fillStyle = 'rgba(43,34,51,.18)'; g.fill(); g.restore();
  draw.paper(g, () => rr(g, -60, -92, 120, 92, 6), '#fff1d6', { lw: 3.2, shadow: false });
  g.strokeStyle = 'rgba(160,110,60,.28)'; g.lineWidth = 2; for (let y = -78; y < 0; y += 14) { g.beginPath(); g.moveTo(-57, y); g.lineTo(57, y); g.stroke(); }
  draw.paper(g, () => { g.beginPath(); g.moveTo(-72, -86); g.lineTo(0, -122); g.lineTo(72, -86); g.lineTo(64, -78); g.lineTo(0, -110); g.lineTo(-64, -78); g.closePath(); }, '#c8453c', { lw: 3 });
  draw.paper(g, () => rr(g, -18, -44, 36, 44, 5), '#c8453c', { lw: 3, shadow: false });
  g.fillStyle = '#ffd35a'; g.beginPath(); g.arc(10, -22, 2.6, 0, TAU); g.fill();
  // a round window with Penny peeking out
  draw.paper(g, () => { g.beginPath(); g.arc(-36, -52, 15, 0, TAU); }, '#8fd3ff', { lw: 3, shadow: false });
  g.save(); g.beginPath(); g.arc(-36, -52, 13.5, 0, TAU); g.clip();
  const BEAR = '#d08a4a';
  for (const ex of [-46, -26]) { g.fillStyle = BEAR; g.beginPath(); g.arc(ex, -60, 5, 0, TAU); g.fill(); }
  g.fillStyle = BEAR; g.beginPath(); g.ellipse(-36, -48, 11, 10, 0, 0, TAU); g.fill();
  g.fillStyle = '#f2c79a'; g.beginPath(); g.ellipse(-36, -44.5, 5.5, 4, 0, 0, TAU); g.fill();
  g.fillStyle = INK; for (const ex of [-40, -32]) { g.beginPath(); g.arc(ex, -50, 1.5, 0, TAU); g.fill(); }
  g.beginPath(); g.arc(-36, -46, 1.6, 0, TAU); g.fill();
  g.fillStyle = '#c8453c'; g.fillRect(-48, -40, 24, 6);
  g.restore();
  g.beginPath(); g.arc(-36, -52, 15, 0, TAU); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
  // the sign: an envelope
  draw.paper(g, () => rr(g, 18, -70, 34, 22, 4), '#fffdf6', { lw: 2.6, shadow: false });
  g.strokeStyle = '#c8453c'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(22, -66); g.lineTo(35, -57); g.lineTo(48, -66); g.stroke();
}
function paintCactus(g, kind) { // mid-ground decor, base at (0, 0)
  const G = '#79b85a', D = '#5f9a45';
  if (kind === 'saguaro') {
    const part = (fn) => draw.paper(g, fn, G, { lw: 2.6, shadow: false });
    part(() => rr(g, -7, -58, 14, 58, 7));
    part(() => { g.beginPath(); g.moveTo(-7, -26); g.lineTo(-18, -26); g.quadraticCurveTo(-22, -26, -22, -31); g.lineTo(-22, -44); g.quadraticCurveTo(-22, -49, -17.5, -49); g.quadraticCurveTo(-13, -49, -13, -44); g.lineTo(-13, -33); g.lineTo(-7, -33); g.closePath(); });
    part(() => { g.beginPath(); g.moveTo(7, -34); g.lineTo(16, -34); g.quadraticCurveTo(20, -34, 20, -39); g.lineTo(20, -48); g.quadraticCurveTo(20, -53, 15.5, -53); g.quadraticCurveTo(11, -53, 11, -48); g.lineTo(11, -41); g.lineTo(7, -41); g.closePath(); });
    g.strokeStyle = D; g.lineWidth = 1.6; for (const x of [-2.5, 2.5]) { g.beginPath(); g.moveTo(x, -53); g.lineTo(x, -4); g.stroke(); }
  } else if (kind === 'barrel') {
    draw.paper(g, () => { g.beginPath(); g.ellipse(0, -11, 13, 12, 0, 0, TAU); }, G, { lw: 2.6, shadow: false });
    g.strokeStyle = D; g.lineWidth = 1.6; for (const x of [-6, 0, 6]) { g.beginPath(); g.moveTo(x, -21); g.quadraticCurveTo(x * 1.3, -11, x, -1); g.stroke(); }
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; draw.paper(g, () => { g.beginPath(); g.ellipse(Math.cos(a) * 4, -24 + Math.sin(a) * 2, 3.4, 2.2, a, 0, TAU); }, '#ff8fb0', { lw: 1.4, shadow: false }); }
    g.fillStyle = '#ffd35a'; g.beginPath(); g.arc(0, -24, 2, 0, TAU); g.fill();
  } else if (kind === 'rock') {
    draw.paper(g, () => { g.beginPath(); g.moveTo(-20, 0); g.quadraticCurveTo(-18, -16, -4, -17); g.quadraticCurveTo(12, -18, 16, -6); g.lineTo(18, 0); g.closePath(); }, '#c9a275', { lw: 2.6, shadow: false });
    draw.paper(g, () => { g.beginPath(); g.moveTo(10, 0); g.quadraticCurveTo(12, -10, 20, -10); g.quadraticCurveTo(28, -9, 29, 0); g.closePath(); }, '#b8915f', { lw: 2.4, shadow: false });
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-12, -10); g.quadraticCurveTo(-6, -14, 2, -14); g.stroke();
  } else { // a dry tuft
    g.strokeStyle = INK; g.lineWidth = 4.2;
    const blades = () => { g.beginPath(); for (const [x, y] of [[-10, -12], [-4, -18], [2, -20], [8, -15], [12, -9]]) { g.moveTo(0, 0); g.quadraticCurveTo(x * 0.4, y * 0.6, x, y); } };
    blades(); g.stroke(); g.lineWidth = 2; g.strokeStyle = '#c99a4a'; blades(); g.stroke();
  }
}
function paintCloud(g) {
  const puffs = () => { g.beginPath(); for (const [cx, cy, r] of [[-24, 4, 14], [0, -5, 19], [25, 4, 14]]) { g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, TAU); } g.rect(-28, 4, 54, 14); };
  puffs(); g.lineWidth = 6; g.strokeStyle = 'rgba(160,190,220,.7)'; g.stroke();
  puffs(); g.fillStyle = '#fffaf0'; g.fill();
}

// ---- static scenery
function paintSky(g) {
  const sky = g.createLinearGradient(0, 0, 0, HORIZON + 8);
  sky.addColorStop(0, '#9fd2f2'); sky.addColorStop(0.62, '#ffe9c9'); sky.addColorStop(1, '#ffe2b0');
  g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON + 10);
  g.fillStyle = 'rgba(255,236,160,.6)'; g.beginPath(); g.arc(868, 114, 46, 0, TAU); g.fill();
  draw.paper(g, () => { g.beginPath(); g.arc(868, 114, 30, 0, TAU); }, '#ffe07a', { lw: 3, stroke: 'rgba(43,34,51,.3)', shadow: false });
}
function paintDunes(g) { // far dunes and mesas, seamless over DUNE_P
  const P = DUNE_P;
  const mesa = (x, w, top, fill, band) => {
    draw.paper(g, () => { g.beginPath(); g.moveTo(x - w / 2 - 24, HORIZON + 4); g.lineTo(x - w / 2, top + 6); g.quadraticCurveTo(x - w / 2, top, x - w / 2 + 8, top); g.lineTo(x + w / 2 - 8, top); g.quadraticCurveTo(x + w / 2, top, x + w / 2 + 2, top + 6); g.lineTo(x + w / 2 + 26, HORIZON + 4); g.closePath(); }, fill, { lw: 2.6, stroke: 'rgba(43,34,51,.32)', shadow: false });
    g.strokeStyle = band; g.lineWidth = 3;
    for (let k = 1; k <= 2; k++) { const y = top + ((HORIZON - top) * k) / 3.2; g.beginPath(); g.moveTo(x - w / 2 - (y - top) * 0.3, y); g.lineTo(x + w / 2 + (y - top) * 0.3, y); g.stroke(); }
  };
  mesa(330, 170, 86, '#e2a06e', 'rgba(170,90,50,.28)');
  mesa(980, 90, 104, '#ebb58a', 'rgba(170,90,50,.2)');
  const yAt = (x) => HORIZON - 12 - 9 * Math.sin((x / P) * TAU * 3 + 0.6) - 5 * Math.sin((x / P) * TAU * 7 + 2);
  draw.paper(g, () => { g.beginPath(); g.moveTo(0, HORIZON + 6); for (let x = 0; x <= P; x += 16) g.lineTo(x, yAt(x)); g.lineTo(P, HORIZON + 6); g.closePath(); }, '#f2c47e', { lw: 2.4, stroke: 'rgba(43,34,51,.3)', shadow: false });
  g.strokeStyle = 'rgba(255,240,200,.75)'; g.lineWidth = 2.5;
  for (let x = 40; x < P; x += 210) { g.beginPath(); g.moveTo(x, yAt(x) + 6); g.quadraticCurveTo(x + 22, yAt(x + 22) + 3, x + 46, yAt(x + 46) + 7); g.stroke(); }
}
function paintGround(g) { // from the horizon down, static bands
  g.fillStyle = '#f6d9a2'; g.fillRect(0, HORIZON, W, ROADY.y0 - HORIZON);
  const mid = g.createLinearGradient(0, LANE.y1, 0, ROADY.y0); mid.addColorStop(0, '#f5d494'); mid.addColorStop(1, '#efc27c');
  g.fillStyle = mid; g.fillRect(0, LANE.y1 + 6, W, ROADY.y0 - LANE.y1 - 6);
  // Kayvee's paler back path
  g.fillStyle = 'rgba(43,34,51,.1)'; g.fillRect(0, LANE.y1, W, 6);
  g.fillStyle = '#f0dfb8'; g.fillRect(0, LANE.y0, W, LANE.y1 - LANE.y0);
  g.strokeStyle = 'rgba(43,34,51,.3)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(0, LANE.y0); g.lineTo(W, LANE.y0); g.moveTo(0, LANE.y1); g.lineTo(W, LANE.y1); g.stroke();
  // the road: a paper strip with an ink edge and a soft shadow under it
  g.fillStyle = 'rgba(43,34,51,.18)'; g.fillRect(0, ROADY.y1, W, 9);
  g.fillStyle = '#ead7ad'; g.fillRect(0, ROADY.y0, W, ROADY.y1 - ROADY.y0);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, ROADY.y0 + 2, W, 5);
  g.strokeStyle = INK; g.lineWidth = 3; g.globalAlpha = 0.55;
  g.beginPath(); g.moveTo(0, ROADY.y0); g.lineTo(W, ROADY.y0); g.moveTo(0, ROADY.y1); g.lineTo(W, ROADY.y1); g.stroke();
  g.globalAlpha = 1;
  const fg = g.createLinearGradient(0, ROADY.y1, 0, H); fg.addColorStop(0, '#e8b770'); fg.addColorStop(1, '#d9a25c');
  g.fillStyle = fg; g.fillRect(0, ROADY.y1 + 9, W, H - ROADY.y1 - 9);
}
function paintStrip(g, band) { // scrolling details, one STRIP_P period: ruts on the back path, pebbles on the road, tufts in front
  let seed = band === 'road' ? 77 : band === 'path' ? 31 : 53;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  if (band === 'path') {
    g.strokeStyle = 'rgba(150,110,60,.22)'; g.lineWidth = 2.2;
    for (const y of [162, 179]) for (let x = 0; x < STRIP_P; x += 46) { g.beginPath(); g.moveTo(x + rnd() * 8, y + rnd() * 2); g.lineTo(x + 26 + rnd() * 8, y + rnd() * 2); g.stroke(); }
    for (let k = 0; k < 7; k++) { g.fillStyle = 'rgba(160,120,70,.35)'; g.beginPath(); g.ellipse(rnd() * STRIP_P, 155 + rnd() * 30, 2.5 + rnd() * 2, 1.6, 0, 0, TAU); g.fill(); }
  } else if (band === 'road') {
    for (let k = 0; k < 18; k++) {
      const x = rnd() * STRIP_P, y = ROADY.y0 + 10 + rnd() * (ROADY.y1 - ROADY.y0 - 18), r = 2.5 + rnd() * 3.5;
      if (y > 352 && y < 398 && rnd() < 0.7) continue;
      g.fillStyle = '#c9ae7a'; g.beginPath(); g.ellipse(x, y, r * 1.4, r, rnd(), 0, TAU); g.fill();
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(43,34,51,.3)'; g.stroke();
    }
    g.strokeStyle = 'rgba(160,120,70,.3)'; g.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) { const x = rnd() * STRIP_P, y = ROADY.y0 + 12 + rnd() * 70; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 3, x + 20, y + 1); g.stroke(); }
  } else {
    for (let k = 0; k < 6; k++) {
      const x = rnd() * STRIP_P, y = 436 + rnd() * 24;
      g.strokeStyle = 'rgba(150,95,40,.45)'; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(x - 18, y); g.quadraticCurveTo(x, y - 6, x + 18, y); g.stroke();
    }
    for (let k = 0; k < 4; k++) {
      const x = rnd() * STRIP_P, y = 444 + rnd() * 14;
      g.strokeStyle = '#b98a3e'; g.lineWidth = 2.2;
      g.beginPath(); for (const [dx, dy] of [[-6, -9], [-1, -13], [4, -11], [8, -6]]) { g.moveTo(x, y); g.quadraticCurveTo(x + dx * 0.4, y + dy * 0.6, x + dx, y + dy); } g.stroke();
    }
  }
}
function paintRibbon(g) { // the race strip: cream paper ribbon, dotted track, start flag and post box
  const { x0, x1, y0, y1, a, b, y } = STRIP;
  const shape = () => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1 - 12, (y0 + y1) / 2); g.lineTo(x1, y1); g.lineTo(x0, y1); g.lineTo(x0 + 12, (y0 + y1) / 2); g.closePath(); };
  draw.paper(g, shape, PAPER, { lw: 3 });
  g.fillStyle = 'rgba(43,34,51,.35)';
  for (let x = a + 8; x < b - 10; x += 12) { g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill(); }
  // start flag
  g.lineWidth = 2.4; g.strokeStyle = INK; g.beginPath(); g.moveTo(a, y + 14); g.lineTo(a, y - 15); g.stroke();
  draw.paper(g, () => { g.beginPath(); g.moveTo(a + 1, y - 15); g.lineTo(a + 17, y - 9); g.lineTo(a + 1, y - 3); g.closePath(); }, PINK, { lw: 2, shadow: false });
  // post box at the end
  g.save(); g.translate(b + 6, y + 17); g.scale(0.42, 0.42); paintPostBox(g); g.restore();
}
function paintButton(g, B, state) { // state: 'up' | 'down' | 'dim'
  const dy = state === 'down' ? 4 : 0;
  g.save(); g.translate(0, 6); rr(g, 0, 0, B.w, B.h, 18); g.fillStyle = 'rgba(43,34,51,.3)'; g.fill(); g.restore();
  g.save(); g.translate(0, dy);
  rr(g, 0, 0, B.w, B.h, 18); g.fillStyle = state === 'down' ? shade(B.fill, 0.35) : state === 'dim' ? shade(B.fill, -0.18) : B.fill; g.fill();
  g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.35)'; rr(g, 10, 6, B.w - 20, 9, 5); g.fill();
  const keyW = B.key.length > 1 ? 58 : 32;
  txt(g, B.word, B.w / 2 - keyW / 2 - 4, B.h / 2 + 1, { size: 26, color: INK });
  g.font = `700 26px ${FONT}`;
  const kx = B.w / 2 + g.measureText(B.word).width / 2 - keyW / 2 + 6;
  rr(g, kx, B.h / 2 - 13, keyW, 26, 8); g.fillStyle = '#fffdf6'; g.fill(); g.lineWidth = 2.4; g.strokeStyle = INK; g.stroke();
  g.fillStyle = INK; g.fillRect(kx + 3, B.h / 2 + 10, keyW - 6, 2.5);
  txt(g, B.key, kx + keyW / 2, B.h / 2, { size: B.key.length > 1 ? 15 : 19, color: INK });
  g.restore();
}

// ---- sprite getters
const skyArt = () => art('sky', () => makeSprite(W, HORIZON + 10, 0, 0, paintSky));
const duneArt = () => art('dunes', () => makeSprite(DUNE_P, HORIZON + 8, 0, 0, paintDunes));
const groundArt = () => art('ground', () => makeSprite(W, H - HORIZON, 0, -HORIZON, paintGround));
const stripArt = (band) => art(`strip|${band}`, () => {
  const [y0, y1] = band === 'path' ? [LANE.y0, LANE.y1] : band === 'road' ? [ROADY.y0, ROADY.y1] : [ROADY.y1 + 9, 468];
  return makeSprite(STRIP_P + 40, y1 - y0, 20, -y0, (g) => { g.save(); g.beginPath(); g.rect(-20, y0, STRIP_P + 40, y1 - y0); g.clip(); paintStrip(g, band); g.translate(STRIP_P, 0); paintStrip(g, band); g.translate(-2 * STRIP_P, 0); paintStrip(g, band); g.restore(); });
});
const cloudArt = () => art('cloud', () => makeSprite(90, 50, 45, 25, paintCloud));
const sandArt = (v, hl) => art(`sand|${v}|${hl ? 1 : 0}`, () => { const sp = makeSprite(56, 40, 28, 22, (g) => paintSand(g, v)); return hl ? outlined(sp, 3) : sp; });
const beadArt = (C, tok, hl, s = 1) => art(`bead|${C.grains[tok]?.color}|${C.grains[tok]?.cut}|${hl ? 1 : 0}|${s}`, () => {
  const gr = C.grains[tok] || DEF.grains.ruby;
  const sp = makeSprite(48 * s, 50 * s, 24 * s, 24 * s, (g) => paintBead(g, gr.cut, gr.color, s));
  return hl ? outlined(sp, 3) : sp;
});
const umArt = (hl) => art(`um|${hl ? 1 : 0}|${fontKey()}`, () => { const sp = makeSprite(52, 44, 26, 20, paintUm); return hl ? outlined(sp, 3) : sp; });
const postArt = (faint) => art(`post|${faint ? 1 : 0}`, () => makeSprite(46, 128, 14, 104, (g) => paintPost(g, faint)));
const bellArt = (hl) => art(`bell|${hl ? 1 : 0}`, () => { const sp = makeSprite(36, 40, 18, 6, paintBell); return hl ? outlined(sp, 3) : sp; });
const flagArt = (good) => art(`flag|${good ? 1 : 0}`, () => makeSprite(40, 34, 6, 28, (g) => paintFlag(g, good)));
const headArt = (mood) => art(`head|${mood}`, () => makeSprite(126, 92, 48, 39, (g) => { g.scale(HEAD.s, HEAD.s); paintHead(g, mood); }));
const speckArt = (C, pose) => art(`speck|${C.skin}${C.hair}${C.top}${C.bald ? 'b' : ''}|${pose}`, () => makeSprite(40, 52, 18, 46, (g) => paintSpeck(g, C, pose)));
const tumbleArt = (cheer) => art(`tumble|${cheer ? 1 : 0}`, () => makeSprite(46, 70, 23, 44, (g) => paintTumble(g, cheer)));
const kayveeArt = (pose, step) => art(`kayvee|${pose}|${step}`, () => makeSprite(80, 76, 44, 66, (g) => paintKayvee(g, pose, step)));
const cartArt = () => art('cart', () => makeSprite(100, 46, 90, 38, paintCart));
const heapArt = (S, C, n) => art(`heap|${S.road}|${n}`, () => makeSprite(76, 80, 38, 72, (g) => paintHeap(g, S, C, n, S.fx.items)));
const snakeIconArt = () => art('snakeIcon', () => makeSprite(40, 32, 18, 16, paintSnakeIcon));
const mouseIconArt = () => art('mouseIcon', () => makeSprite(32, 30, 12, 16, paintMouseIcon));
const tinyCartArt = (n) => art(`tinyCart|${Math.min(60, n)}`, () => makeSprite(26, 28, 13, 20, (g) => paintTinyCart(g, n)));
const postBoxArt = () => art('postBox', () => makeSprite(40, 84, 20, 78, paintPostBox));
const officeArt = () => art('office', () => makeSprite(160, 132, 80, 126, paintPostOffice));
const cactusArt = (kind) => art(`decor|${kind}`, () => makeSprite(70, 72, 35, 64, (g) => paintCactus(g, kind)));
const ribbonArt = () => art('ribbon', () => makeSprite(W, 70, 0, 0, paintRibbon));
const buttonArt = (which, state) => art(`btn|${which}|${state}|${fontKey()}`, () => makeSprite(BTN[which].w + 4, BTN[which].h + 12, 2, 2, (g) => paintButton(g, BTN[which], state)));
function textArt(text, size, color, outline = INK) { // a pop-up word: ink and white outlines
  return art(`text|${text}|${size}|${color}|${outline}|${fontKey()}`, () => {
    const m = measure(); m.font = `700 ${size}px ${FONT}`;
    const w = Math.ceil(m.measureText(text).width + size * 0.9), h = Math.ceil(size * 1.7);
    return makeSprite(w, h, w / 2, h / 2, (g) => {
      g.font = `700 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = size * 0.34; g.strokeStyle = outline; g.strokeText(text, 0, 0);
      g.lineWidth = size * 0.15; g.strokeStyle = '#ffffff'; g.strokeText(text, 0, 0);
      g.fillStyle = color; g.fillText(text, 0, 0);
    });
  });
}
function labelArt(text, size) { // small plain text, centred
  return art(`label|${text}|${size}|${fontKey()}`, () => {
    const m = measure(); m.font = `700 ${size}px ${FONT}`;
    const w = Math.ceil(m.measureText(text).width + 8), h = Math.ceil(size * 1.6);
    return makeSprite(w, h, w / 2, h / 2, (g) => txt(g, text, 0, 1, { size }));
  });
}
function bubbleArt(text, o = {}) { // a speech bubble anchored at its tail's point; o.edge red for mistakes
  const size = o.size || 20, color = o.color || INK, edge = o.edge || INK, side = o.side || 1;
  return art(`bubble|${text}|${size}|${color}|${edge}|${side}|${fontKey()}`, () => {
    const m = measure(); m.font = `700 ${size}px ${FONT}`;
    const w = Math.max(size * 1.6, m.measureText(text).width + 24), h = size + 16;
    const lw = edge === INK ? 3 : 4;
    return makeSprite(w + 24, h + 26, side > 0 ? 6 : w + 18, h + 14, (g) => {
      const cx = side * (w / 2 + 4), cy = -h / 2 - 8;
      g.save(); g.translate(0, 4); rr(g, cx - w / 2, cy - h / 2, w, h, h / 2); g.fillStyle = 'rgba(43,34,51,.22)'; g.fill(); g.restore();
      g.beginPath(); g.moveTo(side * 6, -12); g.lineTo(0, 0); g.lineTo(side * 18, -12); g.closePath(); g.fillStyle = PAPER; g.fill(); g.lineWidth = lw; g.strokeStyle = edge; g.stroke();
      rr(g, cx - w / 2, cy - h / 2, w, h, h / 2); g.fillStyle = PAPER; g.fill(); g.lineWidth = lw; g.strokeStyle = edge; g.stroke();
      g.beginPath(); g.moveTo(side * 7.5, -13.5); g.lineTo(side * 16.5, -13.5); g.lineWidth = lw + 1; g.strokeStyle = PAPER; g.stroke();
      txt(g, text, cx, cy + 1, { size, color });
    });
  });
}
function badgeArt(dir, gap) { // Kayvee off screen: '🐭 ▶ 6' on the right, '◀ 🐭 3' on the left
  return art(`badge|${dir}|${gap}|${fontKey()}`, () => makeSprite(92, 40, dir > 0 ? 88 : 4, 20, (g) => {
    const x0 = dir > 0 ? -84 : 0;
    draw.paper(g, () => rr(g, x0, -15, 84, 30, 12), PAPER, { lw: 2.6 });
    const icon = (x) => { g.save(); g.translate(x, 2); g.scale(0.85, 0.85); paintMouseIcon(g); g.restore(); };
    if (dir > 0) { icon(x0 + 16); txt(g, '▶', x0 + 44, 0, { size: 14 }); txt(g, String(gap), x0 + 64, 1, { size: 18 }); }
    else { txt(g, '◀', x0 + 12, 0, { size: 14 }); icon(x0 + 32); txt(g, String(gap), x0 + 66, 1, { size: 18 }); }
  }));
}

// ---- presentation state (per try)
function newFx(S) {
  const decor = [];
  let seed = 5 + S.roadIndex * 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const kinds = ['saguaro', 'rock', 'barrel', 'tuft', 'rock', 'tuft', 'saguaro', 'barrel'];
  for (let tile = S.start - 6, k = 0; tile < S.finish + 10; tile += 2.2 + rnd() * 3.2, k++) {
    if (Math.abs(tile - (S.finish + 0.8)) < 2.4) continue;   // leave room for the post office
    decor.push({ tile, kind: kinds[k % kinds.length], y: 250 + rnd() * 70, s: 0.62 + rnd() * 0.32 });
  }
  decor.sort((a, b) => a.y - b.y);
  return {
    items: cartItems(S), decor,
    parts: [], pops: [], flies: [], swallow: [], puffs: [],
    say: { noodle: null, kayvee: null, tumble: null },
    flash: { gulp: 0, shout: 0, gulpDim: 0, shoutDim: 0 },
    shake: 0, shakeAmp: 0, jaw: 0, hic: 0,
    mood: null, speck: null, tumbleCheer: 0,
    bellyShown: null, bellyPulse: 0, bells: {}, tauntCd: 0, lastN: 0, clock: 0,
  };
}
const tileX = (S, i, T) => MOUTH.x + (i - S.dN) * T;
const kayveeX = (S, T) => MOUTH.x + (S.dK - S.dN) * T;
const kayveeOnScreen = (S, T) => { const x = kayveeX(S, T); return x > 10 && x < W + 30; };
function say(F, who, text, o = {}) { F.say[who] = { text, age: 0, life: o.life || 0.85, color: o.color, edge: o.edge, size: o.size }; }
function setMood(F, name, sec, then, thenSec) { F.mood = { name, left: sec, then, thenSec }; }
function burst(F, x, y, n, o) {
  for (let k = 0; k < n; k++) {
    const a = (o.a0 ?? -Math.PI) + Math.random() * (o.spread ?? Math.PI);
    const v = (o.v ?? 160) * (0.45 + Math.random() * 0.75);
    F.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.g ?? 520, life: (o.life ?? 0.7) * (0.7 + Math.random() * 0.5), age: 0,
      kind: o.kind || 'dot', color: Array.isArray(o.color) ? o.color[k % o.color.length] : o.color || '#d9b87a', size: (o.size ?? 4) * (0.7 + Math.random() * 0.6), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
  }
  if (F.parts.length > 260) F.parts.splice(0, F.parts.length - 260);
}
function react(S, C, e, ctx) { // what the player sees and hears for each race event
  const F = S.fx, B = C.bubbles, T = C.tilePx, sfx = ctx.sfx;
  const t = e.i != null ? S.tiles[e.i] : null;
  const word = (tok) => C.grains[tok]?.word || String(tok || '').toUpperCase();
  const Word = (tok) => { const w = word(tok).toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); };
  const fill = (tpl, tok) => String(tpl).replace('{WORD}', word(tok)).replace('{Word}', Word(tok));
  const colorOf = (tok) => C.grains[tok]?.color;
  const taunt = () => {
    if (F.tauntCd > 0 || !kayveeOnScreen(S, T) || F.say.kayvee) return;
    say(F, 'kayvee', B.kayveeTaunt, { life: 0.9 }); F.tauntCd = 3;
  };
  const oops = (bubble, o = {}) => { say(F, 'noodle', bubble, { edge: RED, ...o }); F.hic = 0.25; F.shake = Math.max(F.shake, 0.22); F.shakeAmp = o.big ? 7 : 4.5; taunt(); };
  switch (e.ev) {
    case 'chomp': F.jaw = 0.12; break;
    case 'gulp':
      sfx('pop'); F.jaw = 0.2;
      F.flies.push({ tok: e.tok, x0: tileX(S, t.i, T), age: 0 });
      F.swallow.push({ tok: e.tok, age: -0.14 });   // then a bulge slides down his neck into the belly window
      say(F, 'noodle', B.gulp, { life: 0.6, size: 18 });
      F.speck = { pose: 'point', left: 0.25 };
      break;
    case 'blech':
      sfx('buzz'); setMood(F, 'blech', e.stall); F.swallow.push({ tok: 'mush', age: -0.05 });
      burst(F, MOUTH.x + 4, MOUTH.y - 14, 14, { a0: -Math.PI * 0.9, spread: Math.PI * 0.8, v: 190, color: ['#d9b87a', '#c19a5b', '#ecd6a4'], size: 4 });
      oops(B.blech);
      break;
    case 'clang':
      sfx('buzz'); setMood(F, 'dizzy', e.stall);
      F.bells[t.i] = { ...(F.bells[t.i] || {}), wob: 0.7 };
      burst(F, tileX(S, t.i, T) + BELL_AT.x, MOUTH.y + BELL_AT.y + 16, 7, { kind: 'star', color: '#ffd35a', v: 140, g: 200, size: 7, life: 0.6 });
      oops(B.clang);
      break;
    case 'hm': sfx('buzz'); setMood(F, 'dizzy', e.stall); oops(B.chatty); break;
    case 'right': {
      sfx('ding'); setMood(F, 'shout', 0.35, 'happy', 0.45);
      const col = colorOf(e.tok) || INK;
      say(F, 'noodle', fill(B.right, e.tok), { color: col, size: 24, life: 1 });
      F.bells[t.i] = { ...(F.bells[t.i] || {}), swing: 1.3, flagT: 0 };
      burst(F, tileX(S, t.i, T) + BELL_AT.x, MOUTH.y + BELL_AT.y + 10, 18, { kind: 'confetti', color: [col, '#ffd35a', '#ffffff', PINK], v: 230, g: 420, size: 6, life: 1 });
      F.speck = { pose: 'cheer', left: 0.6 };
      break;
    }
    case 'wrong': {
      sfx('buzz'); setMood(F, 'shout', 0.22, 'dizzy', Math.max(0.1, e.stall - 0.22));
      const said = t.said;
      const isBead = C.grains[said]?.kind === 'bead';
      const text = isBead ? fill(B.wrongBead, said) : said === 'mush' ? B.mush : B.empty;
      F.bells[t.i] = { ...(F.bells[t.i] || {}), wob: 0.5, flagT: 0 };
      burst(F, MOUTH.x + 20, MOUTH.y - 40, 8, { color: ['#9a90a6', '#c9c1d2'], v: 90, g: -40, size: 7, life: 0.7 });
      oops(text, { color: isBead ? colorOf(said) : INK, size: 22, big: true, life: 1 });
      F.speck = { pose: 'sad', left: 0.8 };
      break;
    }
    case 'missBell':
      sfx('buzz'); setMood(F, 'dizzy', e.stall);
      F.bells[t.i] = { ...(F.bells[t.i] || {}), flagT: 0 };
      oops(B.missedBell, { big: true, size: 22 });
      F.speck = { pose: 'sad', left: 0.8 };
      break;
    case 'missBead': sfx('tick'); F.puffs.push({ i: t.i, age: 0 }); break;
    case 'dig': {
      sfx('paper');
      if (kayveeOnScreen(S, T)) burst(F, kayveeX(S, T) - 34, LANE.feet - 50, 6, { kind: 'letter', color: '#fffaf0', v: 150, g: 380, size: 7, life: 0.9, a0: -Math.PI * 0.85, spread: Math.PI * 0.7 });
      break;
    }
    case 'kAnswer':
      if (kayveeOnScreen(S, T)) say(F, 'kayvee', fill(B.kayveeAnswer, e.tok), { color: colorOf(e.tok), size: 18, life: 0.9 });
      break;
    case 'pass':
      sfx('pin'); F.pops.push({ text: B.pass, age: 0, life: 1.1, size: 64, color: PINK });
      if (e.first) { say(F, 'tumble', B.tumble, { life: 1.2 }); F.tumbleCheer = 1.4; }
      break;
    case 'kLead': if (kayveeOnScreen(S, T) && !F.say.kayvee) say(F, 'kayvee', B.kayveeTaunt); break;
    case 'won':
      setMood(F, 'happy', 99); F.speck = { pose: 'cheer', left: 99 }; F.tumbleCheer = 99;
      burst(F, MOUTH.x, MOUTH.y - 60, 40, { kind: 'confetti', color: ['#e61f33', '#2659e6', '#1abf59', '#ffd35a', PINK], v: 320, g: 380, size: 7, life: 1.6, a0: -Math.PI, spread: Math.PI });
      break;
    case 'lost':
      setMood(F, 'sad', 99); F.speck = { pose: 'sad', left: 99 };
      if (kayveeOnScreen(S, T)) say(F, 'kayvee', B.kayveeTaunt, { life: 2 });
      break;
    default: break;
  }
}
function stepFx(S, rdt) { // presentation timers run on real time, so they finish during FINISH! and the cards
  const F = S.fx;
  F.clock += rdt;
  for (const p of F.parts) { p.age += rdt; p.vy += p.g * rdt; p.x += p.vx * rdt; p.y += p.vy * rdt; p.rot += p.vr * rdt; }
  F.parts = F.parts.filter((p) => p.age < p.life);
  for (const k of ['flies', 'swallow', 'puffs', 'pops']) for (const o of F[k]) o.age += rdt;
  F.flies = F.flies.filter((o) => o.age < 0.2);
  for (const o of F.swallow) if (o.age >= 0.32 && !o.done) { o.done = true; F.bellyShown = o.tok; F.bellyPulse = 0.35; }
  F.swallow = F.swallow.filter((o) => o.age < 0.34);
  F.puffs = F.puffs.filter((o) => o.age < 0.7);
  F.pops = F.pops.filter((o) => o.age < o.life);
  for (const who of Object.keys(F.say)) { const b = F.say[who]; if (b) { b.age += rdt; if (b.age > b.life) F.say[who] = null; } }
  for (const k of Object.keys(F.flash)) F.flash[k] = Math.max(0, F.flash[k] - rdt);
  F.shake = Math.max(0, F.shake - rdt); F.jaw = Math.max(0, F.jaw - rdt); F.hic = Math.max(0, F.hic - rdt);
  F.bellyPulse = Math.max(0, F.bellyPulse - rdt); F.tumbleCheer = Math.max(0, F.tumbleCheer - rdt); F.tauntCd = Math.max(0, F.tauntCd - rdt);
  if (F.mood) { F.mood.left -= rdt; if (F.mood.left <= 0) F.mood = F.mood.then ? { name: F.mood.then, left: F.mood.thenSec || 0.4 } : null; }
  if (F.speck) { F.speck.left -= rdt; if (F.speck.left <= 0) F.speck = null; }
  for (const b of Object.values(F.bells)) { if (b.swing) b.swing = Math.max(0, b.swing - rdt); if (b.wob) b.wob = Math.max(0, b.wob - rdt); if (b.flagT != null) b.flagT += rdt; }
}

// ---- drawing
function bodyY(S, x, T) { // Noodle's body centreline: the neck from the head down to the belly, then a slow wave
  if (x >= 190) { const u = clamp01((250 - x) / 60); return 354 + 42 * (u * u * (3 - 2 * u)); }
  const k = Math.min(1, (190 - x) / 90);
  return 396 + BODY.amp * k * Math.sin((TAU * (x + S.dN * T)) / BODY.wave);
}
function drawBody(g, S, T) {
  const pts = [];
  for (let x = 252; x >= -60; x -= 8) pts.push([x, bodyY(S, x, T)]);
  const path = (dy = 0) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy))); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  path(5); g.lineWidth = BODY.w + 8; g.strokeStyle = 'rgba(43,34,51,.2)'; g.stroke();
  path(); g.lineWidth = BODY.w + 8; g.strokeStyle = INK; g.stroke();
  path(); g.lineWidth = BODY.w; g.strokeStyle = '#6cc24a'; g.stroke();
  path(10); g.lineWidth = 9; g.strokeStyle = '#a8dd7c'; g.stroke();
  path(-8); g.lineWidth = 7; g.strokeStyle = '#58a83c'; g.setLineDash([6, 17]); g.stroke(); g.setLineDash([]);
}
function drawBellyWindow(g, S, C, F, T) {
  const x = BELLY.x, y = bodyY(S, x, T) + 2;
  const p = F.bellyPulse > 0 ? easeOut(F.bellyPulse / 0.35) : 0;
  const r = BELLY.r * (1 + 0.22 * p);
  draw.paper(g, () => { g.beginPath(); g.arc(x, y, r + 7, 0, TAU); }, '#6cc24a', { lw: 3.6 });
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = PAPER; g.fill();
  const b = F.bellyShown;
  if (b === 'mush') {
    g.save(); g.beginPath(); g.arc(x, y, r - 1, 0, TAU); g.clip();
    g.fillStyle = '#d9b87a'; g.fillRect(x - r, y - r * 0.2, 2 * r, 2 * r);
    g.beginPath(); g.moveTo(x - r, y - r * 0.2); g.quadraticCurveTo(x - r * 0.4, y - r * 0.55, x, y - r * 0.25); g.quadraticCurveTo(x + r * 0.5, y + 0.02 * r, x + r, y - r * 0.35); g.lineTo(x + r, y); g.lineTo(x - r, y); g.closePath(); g.fill();
    g.fillStyle = '#a8834c'; for (const [dx, dy] of [[-12, 4], [-3, 12], [8, 2], [13, 13], [-14, 15], [2, -4]]) { g.beginPath(); g.arc(x + dx, y + dy, 1.8, 0, TAU); g.fill(); }
    g.restore();
  } else if (b && C.grains[b]) {
    stamp(g, beadArt(C, b, false, 0.82), x, y - 1, 1 + 0.15 * p);
  }
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.lineWidth = 3.6; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.4, r * 0.32, Math.PI * 1.05, Math.PI * 1.6); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.8)'; g.stroke();
}
function drawSwallows(g, S, C, F, T) { // a bulge slides down the neck into the belly
  for (const o of F.swallow) {
    if (o.age < 0) continue;
    const u = clamp01(o.age / 0.32);
    const x = lerp(246, BELLY.x + 6, u), y = bodyY(S, x, T);
    draw.paper(g, () => { g.beginPath(); g.ellipse(x, y, 24, 25, 0, 0, TAU); }, '#6cc24a', { lw: 3.4, shadow: false });
    g.fillStyle = o.tok === 'mush' ? 'rgba(217,184,122,.85)' : C.grains[o.tok]?.color || '#fff'; g.globalAlpha = 0.55;
    g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill(); g.globalAlpha = 1;
  }
}
function drawScarf(g, F) { // Noodle's yellow neckerchief, tied behind his head, one end fluttering
  const wave = Math.sin(F.clock * 10) * 2.5;
  draw.paper(g, () => { g.beginPath(); g.moveTo(236, 346); g.quadraticCurveTo(222, 341 + wave, 208, 343 + wave * 1.5); g.lineTo(213, 352 + wave); g.quadraticCurveTo(224, 355, 236, 356); g.closePath(); }, '#ffd35a', { lw: 2.6, shadow: false });
  draw.paper(g, () => { g.save(); g.translate(241, 357); g.rotate(-0.5); rr(g, -7, -22, 13, 44, 6); g.restore(); }, '#ffd35a', { lw: 3, shadow: false });
  g.strokeStyle = '#e8b33a'; g.lineWidth = 2; g.beginPath(); g.moveTo(232, 343); g.lineTo(246, 372); g.stroke();
  draw.paper(g, () => { g.beginPath(); g.arc(235, 350, 4.5, 0, TAU); }, '#ffc53a', { lw: 2.2, shadow: false });
}
function noodleMood(S, F) {
  if (F.mood) return F.mood.name;
  if (S.stall > 0) return 'dizzy';
  if (F.jaw > 0) return 'open';
  return 'idle';
}
function visibleTiles(S, T) {
  return [Math.max(0, Math.floor(S.dN - MOUTH.x / T) - 1), Math.min(S.L - 1, Math.ceil(S.dN + (W - MOUTH.x) / T) + 1)];
}
const passedFade = (off) => (off < -REACH.gulp ? clamp01(1 - (-REACH.gulp - off) / 70) : 1);
// back pass (before Noodle): every bell's post, and the grains already past his mouth, fading under his chin
function drawRoadBack(g, S, C, T) {
  const [first, last] = visibleTiles(S, T);
  for (let i = last; i >= first; i--) {
    const t = S.tiles[i], x = tileX(S, i, T), off = x - MOUTH.x, a = passedFade(off);
    if (a <= 0) continue;
    g.save(); if (a < 1) g.globalAlpha = a;
    if (t.kind === 'bell') blit(g, postArt(false), x, MOUTH.y);
    else if (t.done !== 'gulped' && off <= -REACH.gulp) {
      g.fillStyle = 'rgba(43,34,51,.13)'; g.beginPath(); g.ellipse(x, MOUTH.y + 13, 17, 4.5, 0, 0, TAU); g.fill();
      blit(g, grainArt(C, t, false), x, MOUTH.y);
    }
    g.restore();
  }
}
function grainArt(C, t, hl) { return t.kind === 'bead' ? beadArt(C, t.tok, hl) : t.kind === 'noise' ? umArt(hl) : sandArt(t.i % 6, hl); }
// the bells (after Noodle's head, before the Speck): they hang above his head, flags on top once handled
function drawBells(g, S, C, T) {
  const [first, last] = visibleTiles(S, T);
  const hlShout = S.stall > 0 || S.winner ? null : shoutTarget(S, C);
  for (let i = last; i >= first; i--) {
    const t = S.tiles[i];
    if (t.kind !== 'bell') continue;
    const x = tileX(S, i, T), a = passedFade(x - MOUTH.x);
    if (a <= 0) continue;
    const b = S.fx.bells[i] || {}, hl = t === hlShout;
    const sw = b.swing ? Math.sin(b.swing * 14) * 0.5 * (b.swing / 1.3) : 0, wob = b.wob ? Math.sin(b.wob * 40) * 0.25 * (b.wob / 0.7) : 0;
    stamp(g, bellArt(hl), x + BELL_AT.x, MOUTH.y + BELL_AT.y - (hl ? 4 : 0), 1, sw + wob, a);
    if (t.done === 'ok' || t.done === 'wrong' || t.done === 'missed') {
      const ft = b.flagT ?? 1, s = ft < 0.3 ? easeBack(ft / 0.3) : 1;
      stamp(g, flagArt(t.done === 'ok'), x, MOUTH.y + POST_TOP, Math.max(0.01, s), 0, a);
    }
  }
}
// front pass (after Noodle): the grains coming up to his mouth; the one in reach lifts and gets a white edge
function drawRoadFront(g, S, C, T) {
  const [first, last] = visibleTiles(S, T);
  const hlGulp = S.stall > 0 || S.winner ? null : gulpTarget(S, C);
  for (let i = last; i >= first; i--) {
    const t = S.tiles[i];
    if (t.kind === 'bell' || t.done === 'gulped') continue;
    const x = tileX(S, i, T);
    if (x - MOUTH.x <= -REACH.gulp) continue;
    const hl = t === hlGulp;
    g.fillStyle = 'rgba(43,34,51,.13)'; g.beginPath(); g.ellipse(x, MOUTH.y + 13, 17, 4.5, 0, 0, TAU); g.fill();
    blit(g, grainArt(C, t, hl), x, MOUTH.y - (hl ? 6 : 0));
  }
}
function drawLane(g, S, C, F, T, now) { // Kayvee's back lane: faint bell posts, the chalk lines, Kayvee and his cart
  for (const b of S.bellTiles) {
    const x = tileX(S, b, T);
    if (x < -30 || x > W + 30) continue;
    g.save(); g.globalAlpha = 0.55; g.translate(x, LANE.feet - 6); g.scale(0.42, 0.42); blit(g, postArt(true), 0, 0); blit(g, bellArt(false), BELL_AT.x, BELL_AT.y); g.restore();
  }
  for (const tile of [S.start, S.finish]) {
    const x = tileX(S, tile, T);
    if (x < -20 || x > W + 20) continue;
    chalk(g, x, LANE.y0 + 3, LANE.y1 - 3);
    chalk(g, x, ROADY.y0 + 3, ROADY.y1 - 3);
  }
  const kx = kayveeX(S, T);
  if (kx > -40 && kx < W + 110) {
    const digging = S.kDig > 0;
    const v = C.v0 / (1 + C.alpha * S.n);
    const step = digging ? Math.floor(now * 10) % 8 : Math.floor((S.dK - S.start) * 3.2) % 8;
    const jig = digging ? Math.sin(now * 46) * 1.6 : 0;
    const bob = digging ? 0 : Math.abs(Math.sin(((S.dK - S.start) * 3.2 / 8) * TAU)) * 1.6 * Math.min(1, v / 2);
    g.fillStyle = 'rgba(43,34,51,.16)'; g.beginPath(); g.ellipse(kx - 46, LANE.feet + 2, 52, 5, 0, 0, TAU); g.fill();
    const n = S.n;
    if (n !== F.lastN) {
      if (n > 30 && n > F.lastN && kayveeOnScreen(S, T)) burst(F, kx - 40, LANE.feet - 34 - heapHeight(n) * 0.6, 1, { kind: 'letter', color: '#fffaf0', v: 70, g: 420, size: 7, life: 0.8, a0: -Math.PI * 0.95, spread: Math.PI * 0.3 });
      F.lastN = n;
    }
    const wobble = n > 50 ? Math.sin(now * 5) * 0.07 * ((n - 50) / 10) : n > 30 ? Math.sin(now * 3.3) * 0.025 : 0;
    stamp(g, heapArt(S, C, n), kx - 34 + jig, LANE.feet - 34, 1, wobble + (digging ? Math.sin(now * 30) * 0.03 : 0));
    blit(g, cartArt(), kx + jig, LANE.feet);
    blit(g, kayveeArt(digging ? 'dig' : 'push', step), kx - 100, LANE.feet - bob);
  } else {
    const gap = Math.round(Math.abs(S.dK - S.dN));
    if (kx >= W + 110) blit(g, badgeArt(1, gap), W - 6, 165);
    else blit(g, badgeArt(-1, gap), 6, 165);
  }
}
function chalk(g, x, y0, y1) {
  g.save(); g.lineCap = 'butt';
  g.strokeStyle = 'rgba(43,34,51,.18)'; g.lineWidth = 8; g.setLineDash([9, 7]);
  g.beginPath(); g.moveTo(x + 2, y0 + 2); g.lineTo(x + 2, y1 + 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
  g.restore();
}
function drawDecor(g, S, F, T) {
  for (const d of F.decor) {
    const x = tileX(S, d.tile, T);
    if (x < -50 || x > W + 50) continue;
    stamp(g, cactusArt(d.kind), x, d.y, d.s);
  }
  const fx = tileX(S, S.finish, T);
  if (fx > -120 && fx < W + 140) {
    blit(g, officeArt(), fx + 52, 324);
    blit(g, postBoxArt(), fx + 28, 338);
  }
}
function drawStrip(g, S, C, F, now) {
  blit(g, ribbonArt(), 0, 0);
  const span = S.finish - S.start, X = (d) => STRIP.a + ((STRIP.b - STRIP.a) * clamp01((d - S.start) / span));
  for (const b of S.bellTiles) { // the bells on the track: grey, then green ✓ or red ✕
    const t = S.tiles[b], x = X(b);
    const fill = t.done === 'ok' ? '#5cc35a' : t.done ? RED : '#e6dccb';
    g.beginPath(); g.arc(x, STRIP.y, 5, 0, TAU); g.fillStyle = fill; g.fill(); g.lineWidth = 1.8; g.strokeStyle = t.done ? INK : 'rgba(43,34,51,.45)'; g.stroke();
  }
  const xn = X(S.dN), xk = X(S.dK);
  const drawK = () => {
    blit(g, tinyCartArt(S.n), xk + 6, STRIP.y + 4);
    blit(g, mouseIconArt(), xk - 12, STRIP.y + 2);
    blit(g, labelArt(`🛒${S.n}`, 13), xk - 2, STRIP.y + 21);
    if (S.kDig > 0) { // digging: a magnifier with a filling ring
      const p = 1 - S.kDig / (S.kDigFull || 1), mx = xk + 2, my = STRIP.y - 20;
      g.beginPath(); g.arc(mx, my, 10, 0, TAU); g.fillStyle = PAPER; g.fill(); g.lineWidth = 2; g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.arc(mx, my, 10, -Math.PI / 2, -Math.PI / 2 + TAU * p); g.lineWidth = 3.4; g.strokeStyle = '#a05a8c'; g.stroke();
      g.beginPath(); g.arc(mx - 1.5, my - 1.5, 4, 0, TAU); g.lineWidth = 2; g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.moveTo(mx + 1.5, my + 1.5); g.lineTo(mx + 5, my + 5); g.lineWidth = 2.6; g.stroke();
    }
  };
  const drawN = () => blit(g, snakeIconArt(), xn - 4, STRIP.y);
  if (S.dN >= S.dK) { drawK(); drawN(); } else { drawN(); drawK(); }
}
function drawButtons(g, S, F) {
  for (const which of ['gulp', 'shout']) {
    const B = BTN[which];
    const state = F.flash[which] > 0 ? 'down' : (S.stall > 0 && !S.winner) || F.flash[`${which}Dim`] > 0 ? 'dim' : 'up';
    blit(g, buttonArt(which, state), B.x, B.y);
  }
}
function drawBubble(g, b, x, y, side = 1) {
  if (!b) return;
  const pop = b.age < 0.14 ? easeBack(b.age / 0.14) : 1, fade = b.age > b.life - 0.15 ? clamp01((b.life - b.age) / 0.15) : 1;
  stamp(g, bubbleArt(b.text, { size: b.size || 20, color: b.color || INK, edge: b.edge || INK, side }), x, y, Math.max(0.05, pop), 0, fade);
}
function drawParts(g, F) {
  for (const p of F.parts) {
    const a = clamp01(1 - p.age / p.life) * 1.4;
    g.save(); g.globalAlpha = Math.min(1, a); g.translate(p.x, p.y); g.rotate(p.rot);
    if (p.kind === 'star') { star(g, 0, 0, p.size); g.fillStyle = p.color; g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke(); }
    else if (p.kind === 'confetti') { g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.lineWidth = 1; g.strokeStyle = 'rgba(43,34,51,.5)'; g.strokeRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
    else if (p.kind === 'letter') { g.fillStyle = p.color; g.fillRect(-p.size * 0.7, -p.size / 2, p.size * 1.4, p.size); g.lineWidth = 1.2; g.strokeStyle = 'rgba(43,34,51,.7)'; g.strokeRect(-p.size * 0.7, -p.size / 2, p.size * 1.4, p.size); g.beginPath(); g.moveTo(-p.size * 0.7, -p.size / 2); g.lineTo(0, p.size * 0.1); g.lineTo(p.size * 0.7, -p.size / 2); g.stroke(); }
    else { g.fillStyle = p.color; g.beginPath(); g.arc(0, 0, p.size / 2, 0, TAU); g.fill(); }
    g.restore();
  }
}
function drawNoodle(g, S, C, F, T) { // Tumble on the tail, the body with its belly window, the scarf and the head
  const now = F.clock, moving = S.stall <= 0 && !S.winner && S.raceT > 0;
  const hic = F.hic > 0 ? Math.sin((F.hic / 0.25) * Math.PI) * -7 : 0;
  const bob = moving ? Math.sin(now * 9) * 1.4 : 0;
  const shakeX = noodleMood(S, F) === 'blech' && F.mood ? Math.sin(now * 60) * 1.8 : 0;
  const ty = bodyY(S, TUMBLE_X, T) - 40 - (F.tumbleCheer > 0 ? Math.abs(Math.sin(now * 12)) * 9 : moving ? Math.abs(Math.sin(now * 7)) * 3 : 0);
  blit(g, tumbleArt(F.tumbleCheer > 0), TUMBLE_X, ty);
  drawBody(g, S, T);
  drawSwallows(g, S, C, F, T);
  drawBellyWindow(g, S, C, F, T);
  drawScarf(g, F);
  const hx = HEAD.x + shakeX, hy = HEAD.y + bob + hic;
  blit(g, headArt(noodleMood(S, F)), hx, hy);
  return { hx, hy, ty };
}
function drawSpeck(g, S, F, colors, nd) { // the Speck rides his head, telling him when
  const pose = F.speck ? F.speck.pose : 'idle', now = F.clock;
  const sb = pose === 'cheer' ? -Math.abs(Math.sin(now * 14)) * 4 : pose === 'point' ? 1.5 : 0;
  blit(g, speckArt(colors, pose), nd.hx - 16, nd.hy - 24 + sb);
  if (S.stall > 0 && !S.winner) { // a hiccup: stars swirl round his head while the ring at his mouth runs out
    for (let k = 0; k < 3; k++) { const a = now * 5 + (k * TAU) / 3; star(g, nd.hx - 6 + Math.cos(a) * 32, nd.hy - 26 + Math.sin(a) * 7, 5.5); g.fillStyle = '#ffd35a'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = INK; g.stroke(); }
  }
}
function drawReach(g, S) {
  g.save();
  g.beginPath(); g.arc(MOUTH.x, MOUTH.y, REACH.ring, 0, TAU); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  g.setLineDash([6, 7]); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke(); g.setLineDash([]);
  if (S.stall > 0 && !S.winner) {
    const p = S.stall / (S.stallFull || 1);
    g.beginPath(); g.arc(MOUTH.x, MOUTH.y, REACH.ring + 5, -Math.PI / 2, -Math.PI / 2 + TAU * p); g.lineWidth = 6; g.strokeStyle = 'rgba(232,86,106,.85)'; g.stroke();
  }
  g.restore();
}
function drawFlies(g, S, C, F) { // gulped gems fly into the mouth
  for (const o of F.flies) {
    const u = easeOut(clamp01(o.age / 0.18));
    stamp(g, beadArt(C, o.tok, false), lerp(o.x0, MOUTH.x - 4, u), lerp(MOUTH.y - 6, MOUTH.y - 18, u) - Math.sin(u * Math.PI) * 14, 1 - 0.55 * u);
  }
}
function drawPuffs(g, S, T, F) { // a passed bead: a small grey ✕ puff
  for (const o of F.puffs) {
    const x = tileX(S, o.i, T), u = o.age / 0.7;
    g.save(); g.globalAlpha = clamp01(1.4 - 1.4 * u); g.translate(x + 10, MOUTH.y - 62 - u * 26); g.scale(1.35, 1.35);
    g.beginPath(); for (const [dx, dy, r] of [[-7, 2, 7], [0, -3, 9], [8, 2, 7]]) { g.moveTo(dx + r, dy); g.arc(dx, dy, r, 0, TAU); }
    g.fillStyle = '#e4dfe8'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(43,34,51,.45)'; g.stroke();
    g.strokeStyle = '#7d7488'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(-4, -4); g.lineTo(4, 4); g.moveTo(4, -4); g.lineTo(-4, 4); g.stroke();
    g.restore();
  }
}
function drawPops(g, F) {
  for (const o of F.pops) {
    const s = o.age < 0.25 ? easeBack(o.age / 0.25) : 1, a = o.age > o.life - 0.25 ? clamp01((o.life - o.age) / 0.25) : 1;
    stamp(g, textArt(o.text, o.size, o.color), W / 2, 252 - o.age * 10, Math.max(0.05, s), -0.05, a);
  }
}

// ---- the game
let ROAD_CALLS = 0; // every setup call takes the next road in order (the kit's idle preview uses one call)
const hit = (B, p) => p.x >= B.x && p.x <= B.x + B.w && p.y >= B.y && p.y <= B.y + B.h + 6;

function makeGame(ctx) {
  return {
    goal: 'Beat Kayvee to the post! Gulp every bead, let sand slide, shout at every 🔔.',
    controls: [['Space', 'gulp'], ['↑', 'shout'], ['click', 'the buttons']],
    duration: 0,
    loseText: "Kayvee's cart got there first. Every hiccup costs you!",
    setup(S, spec) {
      const C = config(spec);
      Object.assign(S, newRace(C, ROAD_CALLS++));
      S.fx = newFx(S);
    },
    update(S, dt, input, spec) {
      const C = config(spec), F = S.fx, p = input.pointer;
      let g = input.pressed.has('action') || input.pressed.has('down');
      let s = input.pressed.has('up');
      if (p.clicked) { if (hit(BTN.gulp, p)) g = true; else if (hit(BTN.shout, p)) s = true; }
      if (g) { const r = gulp(S, C); if (r === 'ignored') F.flash.gulpDim = 0.15; else F.flash.gulp = 0.13; }
      if (s) { const r = shout(S, C); if (r === 'ignored') F.flash.shoutDim = 0.15; else F.flash.shout = 0.13; }
      advance(S, C, dt);
      for (const e of S.events) react(S, C, e, ctx);
      S.events.length = 0;
    },
    draw(g, S, spec) {
      const C = config(spec), T = C.tilePx, F = S.fx;
      const now = performance.now() / 1000;
      const rdt = Math.min(0.05, Math.max(0, now - (ctx.lastDraw || now)));
      ctx.lastDraw = now;
      stepFx(S, rdt);
      const cam = S.dN * T;
      // sky, clouds, far dunes (parallax), the ground
      blit(g, skyArt());
      for (const [x, y, s] of [[160, 92, 0.9], [520, 74, 0.7], [760, 98, 0.8]]) stamp(g, cloudArt(), ((((x - cam * 0.03) % 1100) + 1100) % 1100) - 70, y, s);
      const dOff = ((cam * 0.14) % DUNE_P + DUNE_P) % DUNE_P;
      blit(g, duneArt(), -dOff, 0); blit(g, duneArt(), DUNE_P - dOff, 0);
      blit(g, groundArt());
      g.save();
      if (F.shake > 0) { const k = (F.shake / 0.22) * F.shakeAmp; g.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k); }
      const sOff = ((cam % STRIP_P) + STRIP_P) % STRIP_P;
      for (const band of ['path', 'road', 'fg']) { const sp = stripArt(band); for (let x = -sOff; x < W; x += STRIP_P) blit(g, sp, x, 0); }
      drawLane(g, S, C, F, T, now);
      drawDecor(g, S, F, T);
      drawReach(g, S);
      drawRoadBack(g, S, C, T);
      const nd = drawNoodle(g, S, C, F, T);
      drawBells(g, S, C, T);
      drawSpeck(g, S, F, ctx.colors, nd);
      drawRoadFront(g, S, C, T);
      drawFlies(g, S, C, F);
      drawPuffs(g, S, T, F);
      drawParts(g, F);
      // speech
      drawBubble(g, F.say.noodle, MOUTH.x + 40, nd.hy - 26);
      const kx = kayveeX(S, T);
      if (F.say.kayvee && kx > -40 && kx < W + 110) drawBubble(g, F.say.kayvee, Math.min(W - 120, Math.max(20, kx - 78)), LANE.feet - 66);
      drawBubble(g, F.say.tumble, TUMBLE_X + 14, nd.ty - 26);
      g.restore();
      drawStrip(g, S, C, F, now);
      drawButtons(g, S, F);
      drawPops(g, F);
    },
    result(S) { return S.winner === 'noodle' ? 'win' : S.winner === 'kayvee' ? 'lose' : null; },
    hud(S, spec) { return String(spec.hud || '🔔 {right}/{bells}').replace('{right}', S.right).replace('{bells}', S.bells); },
  };
}

export default {
  mount(container, spec = {}, api = {}) {
    const ctx = {
      colors: speckColors(),
      sfx: (n) => { try { (api.sfx || gameSfx)(n); } catch { /* sound is optional */ } },
      lastDraw: 0,
    };
    const game = makeGame(ctx);
    const handle = runMinigame(container, spec, api, game);
    const canvas = container.querySelector('.mg-canvas');
    let gone = false;
    const redrawPreview = () => { // the kit paints the idle preview once, maybe before the web font arrived
      const m = container.__mg;
      if (gone || !canvas || m?.status !== 'intro' || !m.state) return;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, W, H);
      game.draw(g, m.state, spec);
    };
    try { Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.ready]).then(() => setTimeout(redrawPreview, 30), () => {}); } catch { /* no font loading API */ }
    const onMove = (e) => {
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const p = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
      const c = hit(BTN.gulp, p) || hit(BTN.shout, p) ? 'pointer' : '';
      if (canvas.style.cursor !== c) canvas.style.cursor = c;
    };
    canvas?.addEventListener('pointermove', onMove);
    return {
      destroy() {
        gone = true;
        canvas?.removeEventListener('pointermove', onMove);
        handle.destroy();
      },
    };
  },
};
