// Shared chrome and helpers for world puzzles (public/js/puzzles/<name>.js).
//
//   const board = createBoard(container, spec, api, { theme: 'cork' | 'sea' | 'sand' });
//   board.body                      your puzzle goes here
//   board.button(label, fn, opts)   footer button ({ primary, title })
//   board.fail(key | [keys], vars)  wrong attempt: shows spec.feedback[key] ({var} filled in),
//                                   shakes, and after spec.hintAfterFailures.after fails shows its text
//   board.note(text)                neutral line in the feedback area
//   board.solve()                   stamp + spec.successText, then api.onSolved() exactly once
//
//   const dnd = createDnd(board.root, { onDrop(itemData, targetData, itemEl, targetEl), canDrop, sfx: board.sfx })
//   dnd.item(el, data) / dnd.target(el, data)
//   Drag with the mouse (or finger), or click an item then click where it goes.
import { sfx as gameSfx } from '../game/sfx.js';

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  parent?.appendChild(el);
  return el;
}

export const interp = (str, vars = {}) => String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

export function createBoard(container, spec = {}, api = {}, opts = {}) {
  const sfx = (n) => { try { (api.sfx || gameSfx)(n); } catch { /* sound is optional */ } };
  const root = h('div', { class: `pz-board pz-${opts.theme || 'cork'}`, role: 'dialog', 'aria-label': spec.title || 'Puzzle' });
  const close = h('button', { class: 'pz-close', title: 'Close (Esc)', 'aria-label': 'Close', text: '✕' });
  const head = h('div', { class: 'pz-head' }, [h('div', { class: 'pz-title', text: spec.title || '' }), close]);
  const controls = spec.controlsHint ? h('div', { class: 'pz-controls', text: spec.controlsHint }) : null;
  const body = h('div', { class: 'pz-body' });
  const feedback = h('div', { class: 'pz-feedback', 'aria-live': 'polite' });
  const actions = h('div', { class: 'pz-actions' });
  const foot = h('div', { class: 'pz-foot' }, [feedback, actions]);
  const hintEl = h('div', { class: 'pz-hint' });
  root.append(head, ...(controls ? [controls] : []), body, foot);
  const wrap = h('div', { class: 'pz-wrap' }, [root]);
  container.append(wrap);

  let fails = 0;
  let solved = false;
  let hintShown = false;
  let solveTimer = 0;
  close.addEventListener('click', () => { if (!solved) api.onClose?.(); });

  function show(nodes, kind) {
    feedback.className = `pz-feedback pz-${kind}`;
    feedback.replaceChildren(...nodes);
    feedback.classList.remove('pz-pulse'); void feedback.offsetWidth; feedback.classList.add('pz-pulse');
  }
  function feedbackNodes(key, vars, fallback) {
    const f = key != null ? spec.feedback?.[key] : null;
    if (f && typeof f === 'object') {
      return [f.badge ? h('b', { class: 'pz-badge', text: interp(f.badge, vars) }) : null,
        f.title || f.text ? h('span', { text: interp(f.title || f.text, vars) }) : null].filter(Boolean);
    }
    return [h('span', { text: interp(f ?? fallback, vars) })];
  }
  function showHint() {
    const cfg = spec.hintAfterFailures;
    if (hintShown || !cfg?.text || fails < (cfg.after || 3)) return;
    hintShown = true;
    hintEl.textContent = cfg.text;
    foot.prepend(hintEl);
  }

  return {
    root, body, foot, actions, sfx,
    get solved() { return solved; },
    get fails() { return fails; },
    button(label, onClick, { primary = false, title } = {}) {
      const b = h('button', { class: `etl-btn${primary ? ' primary' : ''}`, title, text: label });
      b.addEventListener('click', () => { if (!solved) onClick(); });
      actions.append(b);
      return b;
    },
    note(text, kind = 'info') { show([h('div', { class: 'pz-line' }, [h('span', { text })])], kind); },
    fail(key, vars = {}, fallback = 'Not yet.') {
      if (solved) return;
      fails++;
      sfx('buzz');
      // key: 'name' | ['a', 'b'] | [{ key: 'peeking', vars: { desk: 3 } }, ...]
      const keys = Array.isArray(key) ? key : [key];
      show(keys.map((k) => h('div', { class: 'pz-line' }, k && typeof k === 'object'
        ? feedbackNodes(k.key, { ...vars, ...k.vars }, fallback)
        : feedbackNodes(k, vars, fallback))), 'bad');
      root.classList.remove('pz-shake'); void root.offsetWidth; root.classList.add('pz-shake');
      showHint();
    },
    solve() {
      if (solved) return;
      solved = true;
      sfx('win');
      show([h('div', { class: 'pz-line' }, [h('span', { text: spec.successText || 'Solved!' })])], 'good');
      root.classList.add('pz-solved');
      root.append(h('div', { class: 'pz-stamp', text: '✓' }));
      solveTimer = setTimeout(() => api.onSolved?.(), opts.solveDelay ?? 1500);
    },
    destroy() { clearTimeout(solveTimer); wrap.remove(); },
  };
}

export function createDnd(root, { onDrop, canDrop = () => true, sfx = gameSfx } = {}) {
  const items = new Map();
  const targets = new Map();
  let picked = null;
  let drag = null;
  let swallowClick = false; // the click that follows an item's pointerup

  const play = (n) => { try { sfx?.(n); } catch { /* optional */ } };
  function setPicked(el) {
    picked?.classList.remove('pz-picked');
    picked = el;
    el?.classList.add('pz-picked');
    root.classList.toggle('pz-picking', !!el);
  }
  function clearHover() { root.querySelectorAll('.pz-hover').forEach((e) => e.classList.remove('pz-hover')); }
  function targetAt(x, y, except) {
    for (const el of document.elementsFromPoint(x, y)) {
      const t = el.closest?.('[data-pz-drop]');
      if (t && t !== except && targets.has(t) && root.contains(t)) return t;
    }
    return null;
  }
  const targetOf = (el) => {
    const t = el && (targets.has(el) ? el : el.closest?.('[data-pz-drop]'));
    return t && targets.has(t) && root.contains(t) ? t : null;
  };
  function drop(itemEl, targetEl) {
    const a = items.get(itemEl); const b = targets.get(targetEl);
    if (!canDrop(a, b, itemEl, targetEl)) { play('buzz'); return; }
    play('paper');
    onDrop?.(a, b, itemEl, targetEl);
  }

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const item = e.currentTarget;
    if (item.classList.contains('pz-locked')) return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    drag = { item, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, ghost: null };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
  }
  function move(e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      drag.moved = true;
      setPicked(null);
      const r = drag.item.getBoundingClientRect();
      const g = drag.item.cloneNode(true);
      g.classList.add('pz-ghost'); g.classList.remove('pz-picked');
      g.removeAttribute('data-pz-drag'); g.removeAttribute('data-pz-drop');
      Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px` });
      document.body.append(g);
      drag.ghost = g;
      drag.item.classList.add('pz-dragging');
    }
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) rotate(-3deg)`;
    clearHover();
    const t = targetAt(e.clientX, e.clientY, drag.item);
    if (t && canDrop(items.get(drag.item), targets.get(t), drag.item, t)) t.classList.add('pz-hover');
  }
  function end() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', end);
    if (drag) { drag.ghost?.remove(); drag.item.classList.remove('pz-dragging'); }
    clearHover();
    drag = null;
  }
  function up(e) {
    if (!drag) return;
    const { item, moved } = drag;
    const t = moved ? targetAt(e.clientX, e.clientY, item) : null;
    end();
    swallowClick = true;
    if (moved) { if (t) drop(item, t); return; }
    // a click on an item while another is picked: place it where this item is (unless both
    // sit in the same place, then just switch the selection); otherwise pick / unpick
    if (picked && picked !== item) {
      const t = targetOf(item);
      if (t && t !== targetOf(picked.parentElement)) { const p = picked; setPicked(null); drop(p, t); return; }
    }
    if (picked === item) { setPicked(null); return; }
    setPicked(item); play('pin');
  }
  // click-to-place on plain targets
  function onRootClick(e) {
    if (swallowClick) { swallowClick = false; return; }
    if (!picked) return;
    const t = e.target.closest?.('[data-pz-drop]');
    if (!t || !targets.has(t) || t === picked) return;
    const p = picked; setPicked(null); drop(p, t);
  }
  const resetSwallow = () => { swallowClick = false; };
  root.addEventListener('pointerdown', resetSwallow, true);
  root.addEventListener('click', onRootClick);

  return {
    item(el, data) {
      el.setAttribute('data-pz-drag', '');
      el.classList.add('pz-draggable');
      items.set(el, data);
      el.addEventListener('pointerdown', down);
      return el;
    },
    target(el, data) { el.setAttribute('data-pz-drop', ''); targets.set(el, data); return el; },
    forget(el) { items.delete(el); targets.delete(el); el.removeEventListener('pointerdown', down); if (picked === el) setPicked(null); },
    get picked() { return picked ? items.get(picked) : null; },
    unpick() { setPicked(null); },
    destroy() { end(); setPicked(null); root.removeEventListener('click', onRootClick); root.removeEventListener('pointerdown', resetSwallow, true); },
  };
}

// Puzzle-specific styles live in the puzzle module; inject them once.
export function injectCss(id, css) {
  if (document.getElementById(id)) return;
  document.head.append(h('style', { id, text: css }));
}

// Small shared bits
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const shuffle = (arr, seed = 7) => {
  const a = arr.slice(); let x = seed;
  for (let i = a.length - 1; i > 0; i--) { x = (x * 9301 + 49297) % 233280; const j = Math.floor((x / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
