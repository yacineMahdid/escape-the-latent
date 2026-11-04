// Mario Party-style mini-game shell for public/js/minigames/<name>.js:
// rules card -> 3, 2, 1, GO! -> play against the clock -> FINISH! -> win (stamp) or "Again?".
// A win is final: ▶ Continue, Space, the card's timer, ✕ and Esc all end it with api.onWin() (once).
//
//   import { runMinigame } from './kit.js';
//   export default { mount(container, spec, api) { return runMinigame(container, spec, api, GAME); } };
//
//   GAME = {
//     goal: 'one line: how you win',             // rules card (spec.goal overrides)
//     controls: [['← →', 'move'], ['Space', 'gulp']],  // rules card (spec.controls overrides)
//     duration: 30,                              // seconds on the clock (spec.duration overrides; 0 = no clock)
//     setup(S, spec),                            // fresh state for every try; S.W x S.H = 960 x 540 canvas units
//     update(S, dt, input, spec),                // input.left/right/up/down/action: held keys;
//                                                // input.pressed: Set of those names pressed this frame;
//                                                // input.pointer: { x, y, down, clicked } in canvas units
//     draw(g, S, spec),                          // CanvasRenderingContext2D; S.t = seconds played
//     result(S, spec),                           // 'win' | 'lose' | null (still playing), checked every frame
//     timeUp(S, spec),                           // when the clock runs out: 'win' | 'lose' (default 'lose')
//     hud(S, spec),                              // short score text for the top bar, e.g. '★ 7 / 10'
//   }
//   api: { onWin(), onClose(), sfx(name) } from the host (the kit stops the Esc keydowns it handles, so a host
//   modal's onEscape does not also fire). container.__mg exposes { status, state, force(result) }.
import { sfx as gameSfx } from '../game/sfx.js';

const W = 960, H = 540;
const CSS = `
.mg-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 14px;
  background: radial-gradient(circle at 50% 40%, rgba(255, 214, 120, .35), rgba(43, 34, 51, .55)); animation: mg-in .25s ease-out; }
.mg-stage { position: relative; width: min(1000px, 96vw, calc((100vh - 100px) * 16 / 9)); border: 5px solid var(--ink); border-radius: 26px; overflow: hidden;
  background: #fffdf6; box-shadow: 0 10px 0 rgba(43, 34, 51, .35), 0 30px 60px rgba(0, 0, 0, .3); font-family: var(--font-ui); color: var(--ink); }
.mg-top { display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: repeating-linear-gradient(-45deg, #ffd35a 0 18px, #ffc53a 18px 36px); border-bottom: 4px solid var(--ink); }
.mg-title { font-weight: 700; font-size: 22px; background: var(--paper); border: 3px solid var(--ink); border-radius: 12px; padding: 1px 14px; transform: rotate(-1.5deg); }
.mg-timer { flex: 1; height: 18px; border: 3px solid var(--ink); border-radius: 999px; background: #fff; overflow: hidden; }
.mg-timer i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #3ec7b5, #7bcd5d); transition: background .3s; }
.mg-timer.low i { background: linear-gradient(90deg, #e8566a, #ff9a4a); }
.mg-score { min-width: 96px; text-align: center; font-weight: 700; font-size: 20px; background: var(--paper); border: 3px solid var(--ink); border-radius: 12px; padding: 1px 10px; }
.mg-close { font: 700 18px var(--font-ui); width: 38px; height: 38px; border-radius: 50%; border: 3px solid var(--ink); background: var(--paper); cursor: pointer; }
.mg-canvas { display: block; width: 100%; aspect-ratio: 16 / 9; background: #cfeaf2; touch-action: none; }
.mg-card { position: absolute; left: 50%; top: 55%; transform: translate(-50%, -50%); min-width: 380px; max-width: 86%; text-align: center;
  background: var(--paper); border: 4px solid var(--ink); border-radius: 20px; padding: 16px 22px 18px; box-shadow: 0 8px 0 rgba(43, 34, 51, .3); }
.mg-ribbon { display: inline-block; margin: -34px 0 8px; padding: 4px 16px; font-weight: 700; letter-spacing: 2px; color: #fff; background: var(--pink); border: 3px solid var(--ink); border-radius: 10px; transform: rotate(-2deg); }
.mg-card h2 { margin: 2px 0 6px; font-size: 30px; }
.mg-goal { font-size: 19px; margin: 4px 0 10px; }
.mg-controls { display: flex; flex-wrap: wrap; gap: 8px 14px; justify-content: center; margin-bottom: 12px; font-size: 16px; }
.mg-controls kbd { display: inline-block; min-width: 26px; padding: 2px 8px; margin-right: 4px; font: 700 15px var(--font-ui); background: #fff; border: 2px solid var(--ink); border-bottom-width: 4px; border-radius: 8px; }
.mg-btns { display: flex; gap: 10px; justify-content: center; }
.mg-btns .etl-btn { font-size: 20px; padding: 8px 26px; }
.mg-big { position: absolute; left: 50%; top: 55%; transform: translate(-50%, -50%); font-size: 120px; font-weight: 700; color: #fff;
  -webkit-text-stroke: 6px var(--ink); paint-order: stroke fill; text-shadow: 0 8px 0 rgba(43, 34, 51, .35); pointer-events: none; animation: mg-pop .6s cubic-bezier(.2, 1.6, .4, 1) both; }
.mg-big.small { font-size: 84px; }
.mg-stamp { position: absolute; right: 8%; top: 22%; width: 150px; height: 150px; display: flex; align-items: center; justify-content: center;
  font: 700 96px var(--font-ui); color: #e8566a; border: 9px solid #e8566a; border-radius: 50%; transform: rotate(-14deg); animation: mg-stamp .5s cubic-bezier(.2, 1.6, .4, 1) both; pointer-events: none; }
@keyframes mg-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes mg-pop { from { transform: translate(-50%, -50%) scale(2.2); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
@keyframes mg-stamp { from { transform: rotate(-14deg) scale(2.4); opacity: 0; } to { transform: rotate(-14deg) scale(1); opacity: .9; } }
@media (max-width: 700px) { .mg-card { min-width: 0; padding: 12px; } .mg-card h2 { font-size: 22px; } .mg-big { font-size: 72px; } }
`;

function injectCss() {
  if (document.getElementById('mg-css')) return;
  const st = document.createElement('style'); st.id = 'mg-css'; st.textContent = CSS; document.head.append(st);
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'action', Enter: 'action', KeyE: 'action' };

export function runMinigame(container, spec = {}, api = {}, game = {}) {
  injectCss();
  const sfx = (n) => { try { (api.sfx || gameSfx)(n); } catch { /* optional */ } };
  const title = spec.title || game.title || 'Mini-game';
  const duration = spec.duration ?? game.duration ?? 30;

  const wrap = el('div', 'mg-wrap');
  const stage = el('div', 'mg-stage');
  const top = el('div', 'mg-top');
  const timer = el('div', 'mg-timer'); const bar = el('i'); timer.append(bar);
  const score = el('div', 'mg-score', '');
  const close = el('button', 'mg-close', '✕'); close.title = 'Close (Esc)';
  top.append(el('div', 'mg-title', title), timer, score, close);
  const canvas = el('canvas', 'mg-canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  stage.append(top, canvas);
  wrap.append(stage);
  container.append(wrap);
  if (!duration) timer.style.visibility = 'hidden';

  // ---- input
  const held = { left: false, right: false, up: false, down: false, action: false };
  let pressed = new Set();
  const pointer = { x: 0, y: 0, down: false, clicked: false };
  const onKey = (e, down) => {
    // the kit owns Esc while it runs: the host's modal Escape (a plain "close") must not also fire
    if (e.code === 'Escape') { if (down && !closed && phase !== 'done') { e.preventDefault(); e.stopPropagation(); closeNow(); } return; }
    const k = KEYMAP[e.code]; if (!k) return;
    e.preventDefault();
    if (down && !held[k]) pressed.add(k);
    held[k] = down;
    // the rules card is read first: a key still mashed from the intro lines (or held) must not skip it
    if (down && k === 'action' && (phase === 'intro' || phase === 'retry')) { if (!e.repeat && performance.now() - cardAt > 600) startCountdown(); }
    // the win card: a fresh press continues (not a key still held or mashed from the last move)
    else if (down && k === 'action' && phase === 'result' && !e.repeat && performance.now() - resultAt > 400) keepWin();
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
  const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); pointer.x = ((e.clientX - r.left) / r.width) * W; pointer.y = ((e.clientY - r.top) / r.height) * H; };
  canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; toCanvas(e); pointer.down = true; pointer.clicked = true; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', toCanvas);
  canvas.addEventListener('pointerup', (e) => { toCanvas(e); pointer.down = false; });
  close.addEventListener('click', () => closeNow());

  // ---- flow
  let phase = 'intro'; // intro | countdown | play | finish | result | retry | done
  let S = null; let last = 0; let raf = 0; let closed = false; let outcome = null; let overlay = null; let resultAt = 0; let cardAt = 0;
  const setOverlay = (node) => { overlay?.remove(); overlay = node; if (node) stage.append(node); };
  const freshState = () => { S = { W, H, t: 0, score: 0 }; game.setup?.(S, spec); };

  function rulesCard(again) {
    cardAt = performance.now();
    const card = el('div', 'mg-card');
    card.append(el('div', 'mg-ribbon', again ? 'AGAIN?' : 'MINI-GAME'), el('h2', '', title), el('div', 'mg-goal', spec.goal || game.goal || ''));
    const ctr = el('div', 'mg-controls');
    for (const [key, what] of spec.controls || game.controls || []) { const s = el('span'); s.append(el('kbd', '', key), document.createTextNode(what)); ctr.append(s); }
    const btns = el('div', 'mg-btns');
    const go = el('button', 'etl-btn primary', again ? '↻ Again' : '▶ Start'); go.addEventListener('click', () => startCountdown());
    btns.append(go);
    if (again) { const later = el('button', 'etl-btn', 'Later'); later.addEventListener('click', () => closeNow()); btns.append(later); }
    card.append(ctr, btns);
    return card;
  }
  function startCountdown() {
    if (phase !== 'intro' && phase !== 'retry') return;
    freshState();
    phase = 'countdown';
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    const tick = () => {
      if (closed) return;
      if (i < steps.length) { setOverlay(el('div', `mg-big${steps[i] === 'GO!' ? ' small' : ''}`, steps[i])); sfx(i < 3 ? 'tick' : 'ding'); i++; setTimeout(tick, i < 4 ? 600 : 450); }
      else { setOverlay(null); phase = 'play'; pressed = new Set(); }
    };
    tick();
  }
  function finish(res) {
    if (phase !== 'play') return;
    phase = 'finish';
    outcome = res;
    setOverlay(el('div', 'mg-big small', 'FINISH!'));
    sfx('stamp');
    setTimeout(() => {
      if (closed) return;
      if (res === 'win') {
        phase = 'result';
        const card = el('div', 'mg-card'); card.append(el('div', 'mg-ribbon', 'YOU WIN'), el('h2', '', spec.successText || 'You did it!'));
        const btns = el('div', 'mg-btns');
        const go = el('button', 'etl-btn primary', '▶ Continue'); go.addEventListener('click', () => keepWin());
        btns.append(go); card.append(btns);
        setOverlay(card); stage.append(el('div', 'mg-stamp', '✓'));
        resultAt = performance.now();
        sfx('win');
        setTimeout(keepWin, 1600);
      } else {
        phase = 'retry';
        const card = rulesCard(true);
        card.querySelector('.mg-goal').textContent = spec.loseText || game.loseText || 'So close! Try again?';
        setOverlay(card);
        sfx('buzz');
      }
    }, 900);
  }
  function frame(now) {
    if (closed) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (S && (phase === 'play' || phase === 'countdown' || phase === 'finish' || phase === 'result' || phase === 'retry')) {
      if (phase === 'play') {
        S.t += dt;
        game.update?.(S, dt, { ...held, pressed, pointer }, spec);
        pressed = new Set(); pointer.clicked = false;
        const r = game.result?.(S, spec);
        if (r) finish(r);
        else if (duration && S.t >= duration) finish(game.timeUp ? game.timeUp(S, spec) : 'lose');
      }
      g.clearRect(0, 0, W, H);
      game.draw?.(g, S, spec);
    } else if (!S) {
      freshState();
      g.clearRect(0, 0, W, H); game.draw?.(g, S, spec);
    }
    if (S && duration) { const left = Math.max(0, 1 - S.t / duration); bar.style.width = `${left * 100}%`; timer.classList.toggle('low', left < 0.25); }
    score.textContent = S ? (game.hud?.(S, spec) ?? '') : '';
    raf = requestAnimationFrame(frame);
  }
  // the win card ends the game won exactly once: Continue, Space, or its 1.6 s timer, whichever comes first
  function keepWin() {
    if (closed || phase !== 'result') return;
    phase = 'done';
    api.onWin?.();
  }
  function closeNow() {
    if (closed || phase === 'done') return;
    // a won game stays won: ✕ or Esc on FINISH! or the win card still counts the win
    if (outcome === 'win' && (phase === 'finish' || phase === 'result')) { closed = true; phase = 'done'; api.onWin?.(); return; }
    closed = true;
    api.onClose?.();
  }

  setOverlay(rulesCard(false));
  raf = requestAnimationFrame(frame);
  container.__mg = {
    get status() { return phase; },
    get state() { return S; },
    get outcome() { return outcome; },
    start() { startCountdown(); },
    force(res) { if (phase === 'play') finish(res); },
  };
  return {
    destroy() {
      closed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true);
      wrap.remove();
    },
  };
}

// small drawing helpers for paper-craft mini-games
export const draw = {
  roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); },
  // filled shape with the game's ink outline and a soft drop shadow
  paper(g, pathFn, fill, { stroke = '#2b2233', lw = 4, shadow = true } = {}) {
    if (shadow) { g.save(); g.translate(0, 5); pathFn(); g.fillStyle = 'rgba(43,34,51,.22)'; g.fill(); g.restore(); }
    pathFn(); g.fillStyle = fill; g.fill(); g.lineWidth = lw; g.strokeStyle = stroke; g.stroke();
  },
  text(g, s, x, y, { size = 28, color = '#2b2233', align = 'center', weight = 700, stroke = null } = {}) {
    g.font = `${weight} ${size}px Fredoka, sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    if (stroke) { g.lineWidth = 6; g.strokeStyle = stroke; g.strokeText(s, x, y); }
    g.fillStyle = color; g.fillText(s, x, y);
  },
};
