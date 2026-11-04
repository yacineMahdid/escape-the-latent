// The Cursed Book of Dimensionality ("the Cursed Book"): the player's dark tome. Its name sits on a
// plate on the cover; four ribbon tabs, each an icon and its word:
//   📄 Read     the real arXiv PDF (PDF.js): lazy pages, crisp at devicePixelRatio, zoom, text layer,
//               select text -> 🖍 Highlight / ✎ Note / ? Ask
//   ✎ Notes    every highlight + note for this paper (localStorage etl-notes-<arxivId>)
//   ? Ask      terse talk with the book (api.book); last 20 exchanges per region (etl-book-chat-<regionId>)
//   ✦ Learned  concepts the player has proven (getSave().learned), newest first, grouped by region
//
//   open({ paper: { arxivId, title }, regionId, tab? }) -> Promise, resolves when the book closes.
//   isOpen() -> boolean
//   clearBookData()   forget every note, chat, page and preference the book keeps (for a new game)
// localStorage: etl-notes-<arxivId>, etl-book-chat-<regionId|lab>, etl-book-page-<arxivId>,
//               etl-book-tab, etl-book-ink, etl-book-learned-seen
// Text rule (docs/ARCHITECTURE.md, "Concise text"): every control and state a first-time player must
// understand gets a short word or one line (all in SAY below); glyphs everyone knows (✕ close, ➤ send,
// + − zoom, ↗ arXiv, 🗑 erase, ink dots, a note's ✎ mark) stand alone with a tooltip; tooltips only add
// extras such as key hints.
// All player / AI text goes in with textContent, never as HTML.
import { openModal, closeModal, topModal } from './modal.js';
import { api } from '../api.js';
import { getSave } from '../game/save.js';

const CSS_HREF = '/css/book.css';
const PDFJS_URL = '/vendor/pdfjs/pdf.mjs';
const PDFJS_WORKER = '/vendor/pdfjs/pdf.worker.mjs';

// Every word the player reads in the book's own chrome (answers, notes and records are theirs / the book's).
const SAY = {
  name: 'The Cursed Book of Dimensionality',
  loadFail: 'The paper would not load.',
  retry: 'Try again',
  onArxiv: 'Read on arXiv',
  noPaper: 'Nothing to read yet.',
  highlight: 'Highlight',
  note: 'Note',
  ask: 'Ask',
  notePlaceholder: 'Write a note…',
  erase: 'Erase?',                     // a 🗑 pressed once: press again to erase
  notesEmpty: 'No notes yet. Select text in Read to highlight it or add a note.',
  askPlaceholder: "Ask about the paper. It's terse and won't solve challenges.",
  offline: 'Offline (no API key): the book only mutters hints.',
  askFail: 'No answer came.',
  learnedEmpty: 'Nothing learned yet. Concepts you prove to villagers are recorded here.',
};

const TABS = [
  { id: 'read', icon: '📄', label: 'Read', emoji: true },   // tooltips add the key: "Read (1)"
  { id: 'notes', icon: '✎', label: 'Notes' },
  { id: 'ask', icon: '?', label: 'Ask' },
  { id: 'learned', icon: '✦', label: 'Learned' },
];
const TAB_IDS = TABS.map((t) => t.id);
const INKS = ['#b48cff', '#ff8fcf', '#6fe3d2', '#ffd36b'];
const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const MAX_FIT_WIDTH = 1000;      // css px; fit-width never makes a page wider than this
const MAX_CANVAS_PX = 12e6;      // device pixels per page canvas
const RENDER_KEEP = 8;           // drawn pages kept at most...
const RENDER_BUDGET_PX = 32e6;   // ...and canvas pixels (~128 MB); pages near the view always stay
const CHAT_KEEP = 20;
const HISTORY_SEND = 6;
const HEX = /^#[0-9a-f]{6}$/i;

const KEY_TAB = 'etl-book-tab';
const KEY_INK = 'etl-book-ink';
const KEY_SEEN = 'etl-book-learned-seen';
const notesKey = (arxivId) => `etl-notes-${arxivId}`;
const chatKey = (regionId) => `etl-book-chat-${regionId || 'lab'}`;
const pageKey = (arxivId) => `etl-book-page-${arxivId}`;

// ---------------------------------------------------------------------------------------------
// small helpers

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const uid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const absUrl = (id) => `https://arxiv.org/abs/${encodeURIComponent(id)}`;
const nodeEl = (n) => (n && n.nodeType === 1 ? n : n?.parentElement || null);
const typing = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const outputScale = () => clamp(window.devicePixelRatio || 1, 1, 3);

// h('button', { class, text, title, onclick, ... }, ...children)
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'value') e.value = v;
      else if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids) if (kid != null && kid !== false) e.append(kid);
  return e;
}

// a glyph and its word, for a control: ...iw('↻', 'Try again')
const iw = (icon, word, emoji) => [
  h('span', { class: `bk-gi${emoji ? ' bk-emoji' : ''}`, 'aria-hidden': 'true', text: icon }),
  h('span', { class: 'bk-w', text: word }),
];

// localStorage, always guarded (private mode, blocked storage, quota)
const ls = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* keep it in memory */ }
  },
};

const getInk = () => { const c = ls.get(KEY_INK, INKS[0]); return HEX.test(c) ? c : INKS[0]; };
const setInk = (c) => ls.set(KEY_INK, c);
const nextInk = (c) => INKS[(INKS.indexOf(c) + 1) % INKS.length];

function autogrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

// Two-step destructive button: the first press arms it (it trembles and says "Erase?"), the second does it.
function armed(btn, fn) {
  let timer = 0;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.classList.contains('armed')) { clearTimeout(timer); btn.classList.remove('armed'); fn(); return; }
    btn.classList.add('armed');
    timer = setTimeout(() => btn.classList.remove('armed'), 2600);
  });
}

// an empty page: a faint breathing glyph and one line saying how the page fills up
const emptyState = (icon, line, emoji) => h('div', { class: 'bk-empty' },
  h('span', { class: `bk-empty-ico${emoji ? ' bk-emoji' : ''}`, 'aria-hidden': 'true', text: icon }),
  line ? h('p', { class: 'bk-empty-t', text: line }) : null);

// 🗑, armed by armed(): its word shows only while it waits for the second press
const eraseBtn = () => h('button', { class: 'bk-ib bk-del', type: 'button', title: 'Erase', 'aria-label': 'Erase' },
  h('span', { class: 'bk-emoji', 'aria-hidden': 'true', text: '🗑' }), h('span', { class: 'bk-arm', text: SAY.erase }));

function ensureCss() {
  if (ensureCss.p) return ensureCss.p;
  let link = document.querySelector(`link[rel="stylesheet"][href$="${CSS_HREF}"]`);
  if (link && link.sheet) return (ensureCss.p = Promise.resolve());
  if (!link) {
    link = h('link', { rel: 'stylesheet', href: CSS_HREF, id: 'etl-book-css' });
    document.head.append(link);
  }
  ensureCss.p = new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 2000);
  });
  return ensureCss.p;
}

let statusP = null;
const serverStatus = () => (statusP ??= api.status().catch(() => null));

// ---------------------------------------------------------------------------------------------
// PDF.js, loaded on first use. The last opened paper stays loaded so the book reopens instantly.

let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import(PDFJS_URL).then((m) => {
      m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return m;
    });
    pdfjsP.catch(() => { pdfjsP = null; });
  }
  return pdfjsP;
}

let docEntry = null; // { arxivId, promise, task, listeners }
function loadDoc(arxivId, onProgress) {
  if (docEntry && docEntry.arxivId === arxivId) {
    if (onProgress) docEntry.listeners.add(onProgress);
    return docEntry.promise;
  }
  if (docEntry) {
    // another paper: let the previous one go (destroy is safe to repeat, and also stops a half-done load)
    const old = docEntry;
    old.task?.destroy();
    old.promise.finally(() => old.task?.destroy()).catch(() => {});
  }
  const entry = { arxivId, task: null, listeners: new Set(onProgress ? [onProgress] : []) };
  entry.promise = loadPdfjs().then((pdfjs) => {
    // ERRORS only: PDF.js warns a lot ("Knockout groups not supported.") and the game watches the console
    const task = pdfjs.getDocument({ url: api.paperPdfUrl(arxivId), isEvalSupported: false, verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0 });
    entry.task = task;
    task.onProgress = (p) => { for (const fn of entry.listeners) { try { fn(p); } catch { /* ignore */ } } };
    return task.promise;
  });
  entry.promise.catch(() => {
    if (docEntry === entry) docEntry = null;
    entry.task?.destroy();
  });
  docEntry = entry;
  return entry.promise;
}

// ---------------------------------------------------------------------------------------------
// Annotations: [{ id, page, rects: [{ x, y, w, h } normalized 0..1], text, note, color, created }]

function sanitizeNotes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const page = Number(a.page);
    if (!Number.isInteger(page) || page < 1) continue;
    const rects = (Array.isArray(a.rects) ? a.rects : [])
      .map((r) => (r && typeof r === 'object' ? { x: +r.x, y: +r.y, w: +r.w, h: +r.h } : null))
      .filter((r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0)
      .map((r) => ({ x: clamp(r.x, 0, 1), y: clamp(r.y, 0, 1), w: clamp(r.w, 0, 1), h: clamp(r.h, 0, 1) }));
    out.push({
      ...a,
      id: typeof a.id === 'string' && a.id ? a.id : uid(),
      page,
      rects,
      text: str(a.text),
      note: str(a.note),
      color: HEX.test(a.color) ? a.color : INKS[0],
      created: typeof a.created === 'string' || typeof a.created === 'number' ? a.created : new Date().toISOString(),
    });
  }
  return out;
}

class NoteStore {
  constructor(arxivId) {
    this.key = arxivId ? notesKey(arxivId) : null;
    this.items = this.key ? sanitizeNotes(ls.get(this.key, [])) : [];
    this.subs = new Set();
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(change) { for (const fn of this.subs) { try { fn(change); } catch (e) { console.warn('[book]', e); } } }
  save() { if (this.key) ls.set(this.key, this.items); }
  all() { return this.items; }
  get(id) { return this.items.find((a) => a.id === id) || null; }
  forPage(n) { return this.items.filter((a) => a.page === n); }
  add(a, source) { this.items.push(a); this.save(); this.emit({ type: 'add', a, source }); return a; }
  update(id, patch, source) {
    const a = this.get(id);
    if (!a) return;
    Object.assign(a, patch);
    this.save();
    this.emit({ type: 'update', a, patch, source });
  }
  remove(id, source) {
    const i = this.items.findIndex((a) => a.id === id);
    if (i < 0) return;
    const [a] = this.items.splice(i, 1);
    this.save();
    this.emit({ type: 'remove', a, source });
  }
}

const byPosition = (a, b) => a.page - b.page
  || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0)
  || (a.rects[0]?.x ?? 0) - (b.rects[0]?.x ?? 0);

// Client rects of a selection -> one tidy box per line.
function mergeRects(rects) {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const r of sorted) {
    const same = out.find((o) => {
      const overlap = Math.min(o.y + o.h, r.y + r.h) - Math.max(o.y, r.y);
      return overlap > Math.min(o.h, r.h) * 0.55 && r.x <= o.x + o.w + 0.012 && r.x + r.w >= o.x - 0.012;
    });
    if (same) {
      const x1 = Math.min(same.x, r.x), y1 = Math.min(same.y, r.y);
      const x2 = Math.max(same.x + same.w, r.x + r.w), y2 = Math.max(same.y + same.h, r.y + r.h);
      Object.assign(same, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    } else out.push({ ...r });
  }
  return out.map((r) => ({ x: r4(r.x), y: r4(r.y), w: r4(r.w), h: r4(r.h) }));
}

// ---------------------------------------------------------------------------------------------
// 📄 Read

class Reader {
  constructor(book) {
    this.book = book;
    this.notes = book.notes;
    this.id = book.arxivId;
    this.views = [];
    this.doc = null;
    this.pdfjs = null;
    this.zoom = 1;
    this.scale = 1;
    this.fit = 1;
    this.current = 1;
    this.running = 0;
    this.closed = false;
    this.sel = null;
    this.pop = null;
    this.pendingJump = null;
    this.pointerDown = false;
    this.posKey = this.id ? pageKey(this.id) : null;
    const saved = this.posKey ? ls.get(this.posKey, null) : null;
    if (saved && Number.isInteger(saved.page) && saved.page > 0) this.restore = { num: saved.page, frac: clamp(Number(saved.frac) || 0, 0, 1) };
    if (saved && ZOOMS.includes(saved.zoom)) this.zoom = saved.zoom;

    this.pagesEl = h('div', { class: 'bk-pages' });
    this.scroller = h('div', { class: 'bk-scroll', tabindex: '-1' }, this.pagesEl);
    this.progress = h('div', { class: 'bk-progress', 'aria-hidden': 'true' });
    this.status = h('div', { class: 'bk-status' });
    this.pnum = h('input', { class: 'bk-pnum', value: '·', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', title: 'Page', 'aria-label': 'Page' });
    this.ptotal = h('span', { class: 'bk-ptotal' });
    this.zOut = h('button', { class: 'bk-ib', type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', text: '−', onclick: () => this.zoomBy(-1) });
    this.zIn = h('button', { class: 'bk-ib', type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', text: '+', onclick: () => this.zoomBy(1) });
    // a slim clasp on the book's right edge (outside the page, so it never covers the paper)
    this.bar = h('div', { class: 'bk-rbar', hidden: true },
      this.zIn,
      h('label', { class: 'bk-pc', title: 'Page' }, this.pnum, this.ptotal),
      this.zOut,
      this.id ? h('a', { class: 'bk-ib bk-ext', href: absUrl(this.id), target: '_blank', rel: 'noopener noreferrer', title: 'Open on arXiv', 'aria-label': 'Open on arXiv', text: '↗' }) : null);
    this.menu = this.buildMenu();
    this.root = h('section', { class: 'bk-pane bk-read', role: 'tabpanel', 'aria-label': 'Read', 'data-state': 'loading' },
      this.scroller, this.status, this.progress);
    book.bookEl.append(this.bar);
    this.bind();
  }

  buildMenu() {
    const b = (act, icon, word, fn, emoji) => h('button', { class: 'bk-mb', type: 'button', 'data-act': act, onclick: fn }, ...iw(icon, word, emoji));
    const menu = h('div', { class: 'bk-selmenu', role: 'toolbar', hidden: true },
      b('highlight', '🖍', SAY.highlight, () => this.highlight(false), true),
      b('note', '✎', SAY.note, () => this.highlight(true)),
      b('ask', '?', SAY.ask, () => this.askSelection()));
    // keep the text selection alive while the menu is pressed
    const keep = (e) => e.preventDefault();
    menu.addEventListener('pointerdown', keep);
    menu.addEventListener('mousedown', keep);
    return menu;
  }

  bind() {
    const sc = this.scroller;
    sc.addEventListener('scroll', () => {
      if (!this.scrollRaf) this.scrollRaf = requestAnimationFrame(() => { this.scrollRaf = 0; this.onScroll(); });
    }, { passive: true });
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !this.views.length) return;
      e.preventDefault();
      const now = performance.now();
      if (now - (this.wheelAt || 0) < 140) return;
      this.wheelAt = now;
      this.zoomBy(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    this.pagesEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.bk-selmenu, .bk-pop, .bk-mark')) return;
      this.pointerDown = true;
      e.target.closest('.textLayer')?.classList.add('selecting');
    });
    this.pagesEl.addEventListener('click', (e) => this.onClick(e));
    this.onUp = () => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      for (const tl of this.pagesEl.querySelectorAll('.textLayer.selecting')) tl.classList.remove('selecting');
      setTimeout(() => this.checkSelection(), 0);
    };
    this.onSelChange = () => {
      if (this.pointerDown) return;
      clearTimeout(this.selT);
      this.selT = setTimeout(() => this.checkSelection(), 120);
    };
    this.onAnyDown = (e) => {
      if (this.pop && !this.pop.el.contains(e.target)) this.closePop();
      if (!this.menu.hidden && !this.menu.contains(e.target)) this.hideMenu();
    };
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    document.addEventListener('selectionchange', this.onSelChange);
    this.book.root.addEventListener('pointerdown', this.onAnyDown, true);
    this.pnum.addEventListener('focus', () => this.pnum.select());
    this.pnum.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.gotoPage(parseInt(this.pnum.value, 10));
      this.scroller.focus({ preventScroll: true });
    });
    this.pnum.addEventListener('blur', () => { this.pnum.value = this.views.length ? String(this.current) : '·'; });
    this.ro = new ResizeObserver(() => { clearTimeout(this.roT); this.roT = setTimeout(() => this.onResize(), 90); });
    this.ro.observe(sc);
    this.unsub = this.notes.on((ch) => this.onNotes(ch));
  }

  // ---- loading

  async start() {
    if (!this.id) { this.setState('blank'); return; }
    if (this.starting || this.closed || this.views.length) return;
    this.starting = true;
    this.setState('loading');
    this.progress.style.setProperty('--p', '0');
    if (this.onProgress) docEntry?.listeners.delete(this.onProgress);
    this.onProgress = ({ loaded, total }) => {
      if (total > 0) this.progress.style.setProperty('--p', String(clamp(loaded / total, 0, 1)));
    };
    try {
      const [pdfjs, doc] = await Promise.all([loadPdfjs(), loadDoc(this.id, this.onProgress)]);
      if (this.closed) return;
      this.pdfjs = pdfjs;
      this.doc = doc;
      await this.build();
      if (this.closed) return;
      this.setState('ready');
      // arrows / PageDown scroll the paper straight away (unless the player is typing somewhere)
      if (this.book.tab === 'read' && !typing(document.activeElement)) this.scroller.focus({ preventScroll: true });
    } catch (err) {
      if (this.closed) return;
      console.warn('[book] the paper would not open:', err?.message || err);
      this.setState('error');
    } finally {
      this.starting = false;
    }
  }

  setState(state) {
    this.root.dataset.state = state;
    this.bar.hidden = state !== 'ready';
    this.status.replaceChildren();
    if (state === 'loading') this.status.append(h('div', { class: 'bk-sigil', 'aria-hidden': 'true', text: '✦' }));
    if (state === 'blank') this.status.append(emptyState('📄', SAY.noPaper, true));
    if (state === 'error') {
      // a cracked sigil, what happened, and the two ways on: try again, or read it on arXiv
      this.status.append(h('div', { class: 'bk-fail', role: 'alert' },
        h('div', { class: 'bk-sigil bk-dead', 'aria-hidden': 'true', text: '✦' }),
        h('p', { class: 'bk-fail-t', text: SAY.loadFail }),
        h('div', { class: 'bk-fail-row' },
          h('button', { class: 'bk-btn bk-again', type: 'button', onclick: () => this.start() }, ...iw('↻', SAY.retry)),
          h('a', { class: 'bk-btn bk-fail-link', href: absUrl(this.id), target: '_blank', rel: 'noopener noreferrer' }, ...iw('↗', SAY.onArxiv)))));
    }
  }

  async build() {
    const first = await this.doc.getPage(1);
    if (this.closed) return;
    const vp = first.getViewport({ scale: 1 });
    this.baseW = vp.width;
    this.computeScale();
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= this.doc.numPages; n++) {
      const hl = h('div', { class: 'bk-hls' });
      const textDiv = h('div', { class: 'textLayer' });
      const marks = h('div', { class: 'bk-marks' });
      const el = h('div', { class: 'bk-pg', 'data-page': String(n) }, hl, textDiv, marks);
      const pv = { num: n, w: vp.width, h: vp.height, el, hl, textDiv, marks, page: n === 1 ? first : null, canvas: null, textLayer: null, task: null, key: '', busy: false, near: false, token: 0 };
      this.views.push(pv);
      this.sizePage(pv);
      this.paintMarks(pv);
      frag.append(el);
    }
    this.pagesEl.append(frag);
    this.ptotal.textContent = String(this.doc.numPages);
    this.syncZoomButtons();
    if (this.pendingJump) { const j = this.pendingJump; this.pendingJump = null; this.jumpTo(j); }
    else if (this.restore) this.scrollToAnchor({ num: clamp(this.restore.num, 1, this.doc.numPages), frac: this.restore.frac });
    this.onScroll();
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const pv = this.views[Number(en.target.dataset.page) - 1];
        if (!pv) continue;
        pv.near = en.isIntersecting;
        pv.el.classList.toggle('near', pv.near);
        // flung past before it was drawn: stop drawing it
        if (!pv.near && pv.busy) { pv.token++; pv.task?.cancel(); }
      }
      this.trim();
      this.schedule();
    }, { root: this.scroller, rootMargin: '120% 0px' });
    for (const pv of this.views) this.io.observe(pv.el);
  }

  // ---- layout + zoom

  computeScale() {
    const w = this.scroller.clientWidth || 800;
    const pad = w < 640 ? 14 : 30;
    this.lastW = w;
    this.pagesEl.style.setProperty('--bk-pad', `${pad}px`);
    this.fit = clamp(Math.min(w - pad * 2, MAX_FIT_WIDTH) / (this.baseW || 612), 0.2, 4);
    this.scale = this.fit * this.zoom;
  }

  sizePage(pv) {
    pv.el.style.width = `${Math.floor(pv.w * this.scale)}px`;
    pv.el.style.height = `${Math.floor(pv.h * this.scale)}px`;
    pv.el.style.setProperty('--scale-factor', String(this.scale));
  }

  anchor() {
    if (!this.views.length) return null;
    const y = this.scroller.scrollTop + this.scroller.clientHeight * 0.3;
    let pv = this.views[0];
    for (const v of this.views) { if (v.el.offsetTop <= y) pv = v; else break; }
    return { num: pv.num, frac: clamp((y - pv.el.offsetTop) / (pv.el.offsetHeight || 1), 0, 1) };
  }

  scrollToAnchor({ num, frac }) {
    const pv = this.views[num - 1];
    if (!pv) return;
    this.scroller.scrollTop = pv.el.offsetTop + frac * pv.el.offsetHeight - this.scroller.clientHeight * 0.3;
  }

  relayout() {
    if (!this.views.length) return;
    const sc = this.scroller;
    const anchor = this.anchor();
    const cx = sc.scrollWidth > sc.clientWidth ? (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth : 0.5;
    this.closePop();
    this.hideMenu();
    this.computeScale();
    for (const pv of this.views) this.sizePage(pv);
    if (anchor) this.scrollToAnchor(anchor);
    sc.scrollLeft = Math.max(0, cx * sc.scrollWidth - sc.clientWidth / 2);
    for (const pv of this.views) {
      if (pv.busy) { pv.token++; pv.task?.cancel(); }
      if (!pv.near && pv.canvas) this.free(pv);
    }
    this.syncZoomButtons();
    this.schedule();
  }

  onResize() {
    if (this.closed || !this.views.length) return;
    const w = this.scroller.clientWidth;
    if (!w || Math.abs(w - (this.lastW || 0)) < 2) return;
    this.relayout();
  }

  zoomBy(dir) {
    const i = ZOOMS.indexOf(this.zoom);
    this.setZoom(ZOOMS[clamp((i < 0 ? ZOOMS.indexOf(1) : i) + dir, 0, ZOOMS.length - 1)]);
  }

  setZoom(z) {
    if (!this.views.length || z === this.zoom) return;
    this.zoom = z;
    this.relayout();
    this.savePosSoon();
  }

  syncZoomButtons() {
    this.zOut.disabled = this.zoom <= ZOOMS[0];
    this.zIn.disabled = this.zoom >= ZOOMS[ZOOMS.length - 1];
    this.bar.dataset.zoom = String(this.zoom);
  }

  onScroll() {
    const a = this.anchor();
    if (!a) return;
    if (a.num !== this.current || this.pnum.value === '·') {
      this.current = a.num;
      if (document.activeElement !== this.pnum) this.pnum.value = String(a.num);
      this.schedule();
    }
    this.savePosSoon();
  }

  savePosSoon() { clearTimeout(this.posT); this.posT = setTimeout(() => this.savePos(), 300); }

  savePos() {
    clearTimeout(this.posT);
    if (!this.posKey || !this.views.length) return;
    const a = this.anchor();
    if (a) ls.set(this.posKey, { page: a.num, frac: r4(a.frac), zoom: this.zoom });
  }

  gotoPage(n) {
    if (!this.views.length || !Number.isFinite(n)) return;
    const pv = this.views[clamp(Math.round(n), 1, this.views.length) - 1];
    this.scroller.scrollTop = pv.el.offsetTop - 12;
  }

  // a = annotation, or { page } to just turn to a page
  jumpTo(a) {
    if (!this.views.length) { this.pendingJump = a; return; }
    const pv = this.views[clamp(a.page, 1, this.views.length) - 1];
    const r = a.rects?.[0];
    if (!r) { this.gotoPage(pv.num); return; }
    const sc = this.scroller;
    sc.scrollTop = Math.max(0, pv.el.offsetTop + r.y * pv.el.offsetHeight - sc.clientHeight * 0.35);
    if (sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, pv.el.offsetLeft + (r.x + r.w / 2) * pv.el.offsetWidth - sc.clientWidth / 2);
    if (a.id) setTimeout(() => this.flash(a.id), 60);
  }

  flash(id) {
    for (const d of this.pagesEl.querySelectorAll('.bk-hl')) {
      if (d.dataset.id !== id) continue;
      d.classList.remove('flash');
      void d.offsetWidth;
      d.classList.add('flash');
    }
  }

  // ---- rendering (lazy: only pages near the viewport, nearest first, two at a time)

  schedule() {
    if (this.pumpRaf || this.closed) return;
    this.pumpRaf = requestAnimationFrame(() => { this.pumpRaf = 0; this.pump(); });
  }

  pump() {
    if (this.closed || !this.doc) return;
    const key = `${this.scale}@${outputScale()}`;
    const todo = this.views.filter((pv) => pv.near && !pv.busy && pv.key !== key);
    todo.sort((a, b) => Math.abs(a.num - this.current) - Math.abs(b.num - this.current));
    while (this.running < 2 && todo.length) this.renderPage(todo.shift());
  }

  async renderPage(pv) {
    pv.busy = true;
    this.running++;
    const token = ++pv.token;
    const scale = this.scale;
    const dpr = outputScale();
    let canvas = null;
    try {
      const page = pv.page || (pv.page = await this.doc.getPage(pv.num));
      if (token !== pv.token || this.closed) return;
      const base = page.getViewport({ scale: 1 });
      if (Math.abs(base.width - pv.w) > 0.5 || Math.abs(base.height - pv.h) > 0.5) {
        pv.w = base.width; pv.h = base.height; this.sizePage(pv);
      }
      const viewport = page.getViewport({ scale });
      let k = dpr;
      if (viewport.width * viewport.height * k * k > MAX_CANVAS_PX) k = Math.sqrt(MAX_CANVAS_PX / (viewport.width * viewport.height));
      canvas = h('canvas', { class: 'bk-pg-canvas', 'aria-hidden': 'true' });
      canvas.width = Math.max(1, Math.floor(viewport.width * k));
      canvas.height = Math.max(1, Math.floor(viewport.height * k));
      const task = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport,
        transform: k === 1 ? null : [k, 0, 0, k, 0, 0],
      });
      pv.task = task;
      try { await task.promise; } finally { if (pv.task === task) pv.task = null; }
      if (token !== pv.token || this.closed) return;
      if (pv.canvas) { const old = pv.canvas; old.replaceWith(canvas); old.width = 0; old.height = 0; } else pv.el.prepend(canvas);
      pv.canvas = canvas;
      if (pv.textLayer) pv.textLayer.update({ viewport });
      else {
        const tl = new this.pdfjs.TextLayer({
          textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
          container: pv.textDiv,
          viewport,
        });
        pv.textLayer = tl;
        await tl.render();
        if (pv.textLayer !== tl) return;
        pv.textDiv.append(h('div', { class: 'endOfContent' }));
      }
      pv.key = `${scale}@${dpr}`;
      pv.el.dataset.rendered = '1';
    } catch (err) {
      if (!/Cancel|Abort/i.test(err?.name || '')) console.warn('[book] page', pv.num, err?.message || err);
    } finally {
      if (canvas && canvas !== pv.canvas) { canvas.width = 0; canvas.height = 0; } // cancelled or superseded
      pv.busy = false;
      this.running--;
      if (!this.closed) { this.trim(); this.schedule(); }
    }
  }

  // Let the farthest drawn pages go once more than RENDER_KEEP pages (or RENDER_BUDGET_PX pixels) are kept.
  // Runs after every render too: a page that finishes after it left the view gets no later observer call.
  trim() {
    const drawn = this.views.filter((v) => v.canvas);
    let n = drawn.length;
    let px = drawn.reduce((s, v) => s + v.canvas.width * v.canvas.height, 0);
    if (n <= RENDER_KEEP && px <= RENDER_BUDGET_PX) return;
    const far = drawn.filter((v) => !v.near && !v.busy)
      .sort((a, b) => Math.abs(b.num - this.current) - Math.abs(a.num - this.current));
    for (const pv of far) {
      if (n <= RENDER_KEEP && px <= RENDER_BUDGET_PX) break;
      n--;
      px -= pv.canvas.width * pv.canvas.height;
      this.free(pv);
    }
  }

  free(pv) {
    pv.token++;
    pv.task?.cancel();
    pv.task = null;
    if (pv.canvas) { pv.canvas.width = 0; pv.canvas.height = 0; pv.canvas.remove(); pv.canvas = null; }
    if (pv.textLayer) { pv.textLayer.cancel(); pv.textLayer = null; pv.textDiv.replaceChildren(); }
    pv.key = '';
    delete pv.el.dataset.rendered;
  }

  // ---- highlights + note marks

  onNotes({ type, a }) {
    const pv = this.views[a.page - 1];
    if (pv) this.paintMarks(pv);
    if (type === 'remove' && this.pop?.id === a.id) this.closePop(false);
  }

  paintMarks(pv) {
    const hl = document.createDocumentFragment();
    const mk = document.createDocumentFragment();
    for (const a of this.notes.forPage(pv.num)) {
      for (const r of a.rects) {
        hl.append(h('div', { class: 'bk-hl', 'data-id': a.id, style: `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;--c:${a.color}` }));
      }
      if (a.note.trim()) {
        const y = a.rects[0]?.y ?? 0.04;
        mk.append(h('button', {
          class: 'bk-mark', type: 'button', title: clip(a.note.trim(), 140), 'aria-label': 'Note', 'data-id': a.id,
          style: `top:${y * 100}%;--c:${a.color}`, text: '✎',
          onclick: (e) => { e.stopPropagation(); this.openPop(a.id); },
        }));
      }
    }
    pv.hl.replaceChildren(hl);
    pv.marks.replaceChildren(mk);
  }

  // ---- selection -> a small menu: 🖍 Highlight / ✎ Note / ? Ask

  selectionInfo() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const range = s.getRangeAt(0);
    const pageEl = nodeEl(range.startContainer)?.closest('.textLayer')?.closest('.bk-pg');
    if (!pageEl || !this.pagesEl.contains(pageEl)) return null;
    const text = s.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const pr = pageEl.getBoundingClientRect();
    if (!pr.width || !pr.height) return null;
    const rects = [];
    for (const r of range.getClientRects()) {
      const x1 = Math.max(r.left, pr.left), x2 = Math.min(r.right, pr.right);
      const y1 = Math.max(r.top, pr.top), y2 = Math.min(r.bottom, pr.bottom);
      if (x2 - x1 < 0.5 || y2 - y1 < 0.5) continue;
      const q = { x: (x1 - pr.left) / pr.width, y: (y1 - pr.top) / pr.height, w: (x2 - x1) / pr.width, h: (y2 - y1) / pr.height };
      if (q.h > 0.05 || (q.w > 0.9 && q.h > 0.025)) continue; // the whole layer / end-of-content box
      rects.push(q);
    }
    const merged = mergeRects(rects);
    if (!merged.length) return null;
    return { page: Number(pageEl.dataset.page), text: clip(text, 4000), rects: merged, pageEl };
  }

  checkSelection() {
    if (this.closed || this.book.tab !== 'read') return;
    const info = this.selectionInfo();
    if (!info) { this.hideMenu(); return; }
    this.sel = info;
    this.showMenu(info);
  }

  showMenu(info) {
    const m = this.menu;
    if (!m.isConnected) this.pagesEl.append(m);
    m.hidden = false;
    const wr = this.pagesEl.getBoundingClientRect();
    const pr = info.pageEl.getBoundingClientRect();
    const xs = info.rects.map((r) => r.x), xe = info.rects.map((r) => r.x + r.w);
    const ys = info.rects.map((r) => r.y), ye = info.rects.map((r) => r.y + r.h);
    const ox = pr.left - wr.left, oy = pr.top - wr.top;
    const cx = ox + ((Math.min(...xs) + Math.max(...xe)) / 2) * pr.width;
    let top = oy + Math.min(...ys) * pr.height - m.offsetHeight - 12;
    const below = top < this.scroller.scrollTop + 6;
    if (below) top = oy + Math.max(...ye) * pr.height + 12;
    m.classList.toggle('below', below);
    this.place(m, cx, 6);
    m.style.top = `${top}px`;
  }

  // Centre a menu / popover (it is translated -50%) on x, kept inside the part of the pages the player
  // can see (zoomed pages are wider than the view). x is in .bk-pages coordinates, which are the
  // scroller's content coordinates. Its arrow (--ax) keeps pointing at x.
  place(el, x, margin) {
    const sc = this.scroller;
    const half = el.offsetWidth / 2;
    const lo = sc.scrollLeft + half + margin;
    const hi = sc.scrollLeft + sc.clientWidth - half - margin;
    const left = hi < lo ? sc.scrollLeft + sc.clientWidth / 2 : clamp(x, lo, hi);
    el.style.left = `${left}px`;
    el.style.setProperty('--ax', `${Math.round(clamp(x - left, -half + 16, half - 16))}px`);
  }

  hideMenu() {
    this.menu.hidden = true;
  }

  highlight(withNote) {
    const s = this.sel;
    if (!s) return;
    const a = this.notes.add({ id: uid(), page: s.page, rects: s.rects, text: s.text, note: '', color: getInk(), created: new Date().toISOString() }, 'read');
    this.sel = null;
    window.getSelection()?.removeAllRanges();
    this.hideMenu();
    if (withNote) this.openPop(a.id);
    else this.flash(a.id);
  }

  askSelection() {
    const s = this.sel;
    if (!s) return;
    this.sel = null;
    window.getSelection()?.removeAllRanges();
    this.hideMenu();
    this.book.askAbout(s.text);
  }

  onClick(e) {
    if (e.target.closest('.bk-selmenu, .bk-pop, .bk-mark')) return;
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    const pageEl = e.target.closest('.bk-pg');
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const pad = 0.004;
    const hit = this.notes.forPage(Number(pageEl.dataset.page)).reverse()
      .find((a) => a.rects.some((q) => x >= q.x - pad && x <= q.x + q.w + pad && y >= q.y - pad && y <= q.y + q.h + pad));
    if (hit) this.openPop(hit.id);
  }

  // ---- note popover on the page

  openPop(id) {
    this.closePop();
    const a = this.notes.get(id);
    const pv = a && this.views[a.page - 1];
    if (!pv) return;
    const ta = h('textarea', { class: 'bk-pop-ta', rows: '2', placeholder: SAY.notePlaceholder, maxlength: '2000', 'aria-label': 'Note' });
    ta.value = a.note;
    const dots = INKS.map((c) => h('button', {
      class: `bk-dot${c === a.color ? ' on' : ''}`, type: 'button', title: 'Ink', 'aria-label': 'Ink', style: `--c:${c}`,
      onclick: () => {
        for (const d of dots) d.classList.toggle('on', d === dotFor(c));
        this.notes.update(id, { color: c }, 'pop');
        setInk(c);
      },
    }));
    const dotFor = (c) => dots[INKS.indexOf(c)];
    const ask = h('button', { class: 'bk-btn bk-pop-ask', type: 'button', 'data-act': 'ask', onclick: () => { const t = a.text; this.closePop(); this.book.askAbout(t); } }, ...iw('?', SAY.ask));
    const del = eraseBtn();
    armed(del, () => { this.closePop(false); this.notes.remove(id, 'pop'); });
    const el = h('div', { class: 'bk-pop', role: 'dialog', 'aria-label': 'Note' }, ta, h('div', { class: 'bk-pop-row' }, ...dots, h('span', { class: 'bk-sp' }), ask, del));
    const last = a.rects[a.rects.length - 1] || { x: 0.3, y: 0.05, w: 0.4, h: 0.02 };
    this.pagesEl.append(el);
    this.place(el, pv.el.offsetLeft + (last.x + last.w / 2) * pv.el.offsetWidth, 8);
    el.style.top = `${pv.el.offsetTop + (last.y + last.h) * pv.el.offsetHeight + 12}px`;
    ta.addEventListener('input', () => {
      autogrow(ta);
      clearTimeout(this.popT);
      this.popT = setTimeout(() => this.notes.update(id, { note: ta.value }, 'pop'), 250);
    });
    this.pop = { id, el, ta };
    requestAnimationFrame(() => {
      autogrow(ta);
      ta.focus({ preventScroll: true });
      const sc = this.scroller;
      const bottom = el.offsetTop + el.offsetHeight + 16;
      if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
    });
  }

  closePop(save = true) {
    if (!this.pop) return;
    clearTimeout(this.popT);
    const { id, el, ta } = this.pop;
    this.pop = null;
    el.remove();
    const a = this.notes.get(id);
    if (save && a && a.note !== ta.value) this.notes.update(id, { note: ta.value }, 'pop');
  }

  // Esc: popover, then menu, then (caller) the book
  dismiss() {
    if (this.pop) { this.closePop(); this.scroller.focus({ preventScroll: true }); return true; }
    if (!this.menu.hidden) { this.hideMenu(); window.getSelection()?.removeAllRanges(); return true; }
    return false;
  }

  show() {
    if (this.root.dataset.state === 'ready') this.scroller.focus({ preventScroll: true });
    this.schedule();
  }

  hide() {
    this.closePop();
    this.hideMenu();
  }

  destroy() {
    this.savePos();
    this.closePop();
    this.closed = true;
    this.io?.disconnect();
    this.ro.disconnect();
    cancelAnimationFrame(this.pumpRaf);
    cancelAnimationFrame(this.scrollRaf);
    clearTimeout(this.selT); clearTimeout(this.roT); clearTimeout(this.posT);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    document.removeEventListener('selectionchange', this.onSelChange);
    this.book.root.removeEventListener('pointerdown', this.onAnyDown, true);
    this.unsub?.();
    if (this.onProgress) docEntry?.listeners.delete(this.onProgress);
    for (const pv of this.views) {
      pv.token++;
      pv.task?.cancel();
      pv.textLayer?.cancel();
      if (pv.canvas) { pv.canvas.width = 0; pv.canvas.height = 0; }
    }
    // PDF.js parks a hidden measuring canvas on <body>; take it away with the book
    setTimeout(() => { try { this.pdfjs?.TextLayer.cleanup(); } catch { /* ignore */ } }, 0);
  }
}

// ---------------------------------------------------------------------------------------------
// ✎ Notes

class NotesPane {
  constructor(book) {
    this.book = book;
    this.notes = book.notes;
    this.visible = false;
    this.dirty = true;
    this.timers = new Map();
    this.list = h('div', { class: 'bk-col bk-ncol' });
    this.scroll = h('div', { class: 'bk-pscroll', tabindex: '-1' }, this.list);
    this.empty = emptyState('✎', SAY.notesEmpty);
    this.root = h('section', { class: 'bk-pane bk-notes', role: 'tabpanel', 'aria-label': 'Notes' }, this.scroll, this.empty);
    this.unsub = this.notes.on((ch) => {
      if (ch.source === 'notes') return;
      this.dirty = true;
      if (this.visible) this.render();
    });
  }

  show({ initial } = {}) {
    this.visible = true;
    if (this.dirty) this.render();
    if (initial) this.book.home(this.scroll);
  }
  hide() { this.visible = false; this.flush(); }

  render() {
    this.flush();
    const top = this.scroll.scrollTop;
    const items = [...this.notes.all()].sort(byPosition);
    const groups = new Map();
    for (const a of items) {
      if (!groups.has(a.page)) groups.set(a.page, []);
      groups.get(a.page).push(a);
    }
    const frag = document.createDocumentFragment();
    for (const [page, list] of groups) {
      frag.append(h('section', { class: 'bk-ng', 'data-page': String(page) },
        h('button', { class: 'bk-ng-h', type: 'button', title: 'Turn to this page', onclick: () => this.book.jump({ page }) },
          h('span', { class: 'bk-ng-n', text: `Page ${page}` })),
        ...list.map((a) => this.card(a))));
    }
    this.list.replaceChildren(frag);
    this.empty.hidden = items.length > 0;
    this.dirty = false;
    this.scroll.scrollTop = top;
    requestAnimationFrame(() => { for (const ta of this.list.querySelectorAll('textarea')) autogrow(ta); });
  }

  card(a) {
    const quote = h('blockquote', {
      class: 'bk-nq', title: 'Show it in the paper', role: 'button', tabindex: '0', text: a.text || '…',
      onclick: () => this.book.jump(a),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.book.jump(a); } },
    });
    const ta = h('textarea', { class: 'bk-nn', rows: '1', placeholder: SAY.notePlaceholder, maxlength: '2000', 'aria-label': 'Note' });
    ta.value = a.note;
    ta.addEventListener('input', () => { autogrow(ta); this.saveSoon(a.id, ta.value); });
    ta.addEventListener('blur', () => this.flush(a.id));
    const dot = h('button', {
      class: 'bk-dot', type: 'button', title: 'Ink', 'aria-label': 'Ink', style: `--c:${a.color}`,
      onclick: () => {
        const c = nextInk(this.notes.get(a.id)?.color || a.color);
        this.notes.update(a.id, { color: c }, 'notes');
        card.style.setProperty('--c', c);
        dot.style.setProperty('--c', c);
        setInk(c);
      },
    });
    const del = eraseBtn();
    const card = h('article', { class: 'bk-note', 'data-id': a.id, style: `--c:${a.color}` },
      quote, h('div', { class: 'bk-ntools' }, dot, del), ta);
    armed(del, () => {
      this.timers.delete(a.id);
      this.notes.remove(a.id, 'notes');
      card.classList.add('gone');
      setTimeout(() => {
        const sec = card.parentElement;
        card.remove();
        if (sec && !sec.querySelector('.bk-note')) sec.remove();
        this.empty.hidden = this.notes.all().length > 0;
      }, 260);
    });
    return card;
  }

  saveSoon(id, value) {
    clearTimeout(this.timers.get(id)?.t);
    this.timers.set(id, { value, t: setTimeout(() => this.flush(id), 300) });
  }

  flush(only) {
    for (const [id, { value, t }] of [...this.timers]) {
      if (only && id !== only) continue;
      clearTimeout(t);
      this.timers.delete(id);
      this.notes.update(id, { note: value }, 'notes');
    }
  }

  destroy() { this.flush(); this.unsub(); }
}

// ---------------------------------------------------------------------------------------------
// ? Ask

function sanitizeChat(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x.q === 'string' && typeof x.a === 'string' && x.a.trim())
    .slice(-CHAT_KEEP)
    .map((x) => ({ q: x.q, a: x.a, refused: !!x.refused, offline: !!x.offline, sel: typeof x.sel === 'string' && x.sel ? x.sel : null, at: str(x.at) || null }));
}

const waitDots = () => h('span', { class: 'bk-dots', role: 'status', 'aria-label': '…' }, h('i'), h('i'), h('i'));
// a cracked sigil: something did not come through (a line beside it says what)
const deadSigil = () => h('span', { class: 'bk-sigil bk-dead', 'aria-hidden': 'true', text: '✦' });

// A half-typed question (and its ❝ passage) waits here for the next open, per chat. This session only.
const drafts = new Map();

class AskPane {
  constructor(book) {
    this.book = book;
    this.key = chatKey(book.regionId);
    this.items = sanitizeChat(ls.get(this.key, []));
    this.sel = null;
    this.busy = false;    // an exchange is under way: waiting for the book, then writing its answer
    this.skip = null;     // while writing: finish the answer at once
    this.queued = false;  // Enter while writing: ask as soon as the answer is down
    this.stick = true;    // the chat follows its newest line
    this.chat = h('div', { class: 'bk-chat', 'aria-live': 'polite' });
    this.wrap = h('div', { class: 'bk-chatwrap', tabindex: '-1' }, this.chat);
    this.empty = emptyState('?'); // the placeholder says what to do
    // no API key (or Claude unreachable): one line under the quill, so the player knows what answers to expect
    this.off = h('p', { class: 'bk-off', hidden: true }, h('span', { class: 'bk-off-i', 'aria-hidden': 'true', text: '⦸' }), SAY.offline);
    this.chipText = h('span', { class: 'bk-chip-t' });
    this.chip = h('div', { class: 'bk-chip', hidden: true },
      h('span', { class: 'bk-chip-q', 'aria-hidden': 'true', text: '❝' }), this.chipText,
      h('button', { class: 'bk-chip-x', type: 'button', title: 'Remove the passage', 'aria-label': 'Remove the passage', text: '✕', onclick: () => { this.attach(null); this.input.focus(); } }));
    this.input = h('input', { class: 'bk-qin', placeholder: SAY.askPlaceholder, maxlength: '600', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Ask the book' });
    this.sendBtn = h('button', { class: 'bk-send', type: 'submit', title: 'Ask (Enter)', 'aria-label': 'Ask', text: '➤' });
    this.form = h('form', { class: 'bk-compose', onsubmit: (e) => { e.preventDefault(); this.send(); } },
      this.chip, h('div', { class: 'bk-row' }, this.input, this.sendBtn), this.off);
    this.root = h('section', { class: 'bk-pane bk-ask', role: 'tabpanel', 'aria-label': 'Ask' },
      this.wrap, this.empty, this.form);
    for (const it of this.items) this.chat.append(this.exchange(it).el);
    this.syncEmpty();
    const draft = drafts.get(this.key);
    if (draft) { this.input.value = draft.text; this.attach(draft.sel); }
    // the ❝ chip (or the window) changes the chat's height: keep its newest line in view
    this.wrap.addEventListener('scroll', () => {
      this.stick = this.wrap.scrollHeight - this.wrap.scrollTop - this.wrap.clientHeight < 8;
    }, { passive: true });
    this.ro = new ResizeObserver(() => { if (this.stick) this.scrollDown(); });
    this.ro.observe(this.wrap);
    if (this.items.length && this.items[this.items.length - 1].offline) this.setOffline(true);
    serverStatus().then((s) => { if (s && s.ai === false && !this.book.closed) this.setOffline(true); });
  }

  // Opening the book on Ask leaves the keys to the book (B closes, 1-4 turn tabs);
  // choosing the Ask tab hands them to the quill.
  show({ initial } = {}) {
    this.scrollDown();
    if (initial) { this.book.home(this.wrap); return; }
    requestAnimationFrame(() => { if (!this.book.closed && this.book.tab === 'ask') this.input.focus({ preventScroll: true }); });
  }

  hide() {}

  setOffline(on) { this.off.hidden = !on; }
  syncEmpty() { this.empty.hidden = this.chat.childElementCount > 0; }
  scrollDown() { this.wrap.scrollTop = this.wrap.scrollHeight; this.stick = true; }

  attach(text) {
    const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    this.sel = t ? clip(t, 1500) : null;
    this.chip.hidden = !this.sel;
    this.chipText.textContent = this.sel ? clip(this.sel, 110) : '';
    this.chip.title = this.sel || '';
  }

  exchange(it, pending = false) {
    const q = h('div', { class: 'bk-q' });
    if (it.sel) q.append(h('span', { class: 'bk-q-sel', title: it.sel, text: `❝ ${clip(it.sel, 90)} ❞` }));
    q.append(h('span', { class: 'bk-q-t', text: it.q }));
    const a = h('div', { class: `bk-a${it.refused ? ' refused' : ''}${it.offline ? ' offline' : ''}` });
    if (pending) a.append(waitDots());
    else a.textContent = it.a;
    return { el: h('div', { class: 'bk-ex' }, q, a), a };
  }

  nudge() {
    this.form.classList.remove('nudge');
    void this.form.offsetWidth;
    this.form.classList.add('nudge');
  }

  send() {
    if (this.busy) {
      // the last answer is still being written: finish it at once, then ask; still waiting: not yet
      if (this.skip) { this.queued = true; this.skip(); } else this.nudge();
      return;
    }
    const typed = this.input.value.trim();
    const sel = this.sel;
    if (!typed && !sel) { this.nudge(); return; }
    this.input.value = '';
    this.attach(null);
    this.ask(typed, sel);
  }

  async ask(typed, sel) {
    const q = typed || '?'; // only a passage: ask about the passage
    this.busy = true;
    this.form.classList.add('busy');
    drafts.delete(this.key);
    const ex = this.exchange({ q, sel }, true);
    this.chat.append(ex.el);
    this.syncEmpty();
    this.scrollDown();
    const history = this.items.slice(-HISTORY_SEND).map(({ q: hq, a: ha }) => ({ q: hq, a: ha }));
    let res = null;
    try {
      res = await api.book({ regionId: this.book.regionId, question: q, selection: sel || undefined, history });
    } catch (err) {
      if (err?.body?.offline) this.setOffline(true);
      res = null;
    }
    const answer = typeof res?.answer === 'string' ? res.answer.trim() : '';
    let item = null;
    if (answer) {
      // kept even if the book was shut meanwhile: the answer waits on the page
      item = { q, a: answer, refused: !!res.refused, offline: !!res.offline, sel, at: new Date().toISOString() };
      const kept = sanitizeChat(ls.get(this.key, this.items));
      this.items = [...kept, item].slice(-CHAT_KEEP);
      ls.set(this.key, this.items);
    }
    if (this.book.closed) {
      // shut while waiting and nothing came: the question waits in the quill for next time
      if (!item && !drafts.has(this.key)) drafts.set(this.key, { text: typed, sel });
      return;
    }
    this.form.classList.remove('busy');
    if (!item) this.fail(ex, typed, sel);
    else {
      this.setOffline(item.offline);
      ex.a.classList.toggle('offline', item.offline);
      await this.type(ex.a, answer, item.refused);
    }
    this.busy = false;
    if (this.book.closed) return;
    if (this.queued) { this.queued = false; this.send(); return; }
    if (this.book.tab === 'ask') this.input.focus({ preventScroll: true });
  }

  // Nothing came back (network, server, timeout). Not a refusal: no cold box, a cracked sigil, one line
  // and ↻ Try again. The question and its passage go back into the quill.
  fail(ex, typed, sel) {
    ex.el.classList.add('failed');
    ex.a.className = 'bk-a';
    ex.a.replaceChildren(deadSigil(), h('span', { class: 'bk-fail-t', text: SAY.askFail }),
      h('button', { class: 'bk-btn bk-again', type: 'button', onclick: () => this.again(ex, typed, sel) }, ...iw('↻', SAY.retry)));
    if (!this.input.value.trim()) this.input.value = typed;
    if (!this.sel && sel) this.attach(sel);
    if (this.stick) this.scrollDown();
  }

  again(ex, typed, sel) {
    if (this.busy) { this.nudge(); return; }
    ex.el.remove();
    if (this.input.value.trim() === typed) this.input.value = '';
    if (this.sel === sel) this.attach(null);
    this.ask(typed, sel);
  }

  // the answer seeps in letter by letter, each letter flaring as it lands
  async type(el, text, cold) {
    el.replaceChildren();
    el.classList.toggle('refused', !!cold);
    el.classList.add('typing');
    let skip = reducedMotion();
    this.skip = () => { skip = true; };
    el.addEventListener('pointerdown', this.skip, { once: true });
    const chars = [...text];
    const step = clamp(2200 / Math.max(1, chars.length), 9, 30);
    for (const ch of chars) {
      if (this.book.closed) return;
      el.append(h('span', { class: 'bk-l', text: ch }));
      if (!skip) {
        if (this.stick) this.scrollDown();
        await wait(/[.!?…]/.test(ch) ? step * 5 : /[,;:]/.test(ch) ? step * 3 : ch === ' ' ? step * 0.6 : step);
      }
    }
    this.skip = null;
    if (this.stick) this.scrollDown();
    el.classList.remove('typing');
    setTimeout(() => { if (el.isConnected) el.textContent = text; }, 1500); // the glow has faded; drop the spans
  }

  destroy() {
    this.ro.disconnect();
    const text = this.input.value;
    if (text.trim() || this.sel) drafts.set(this.key, { text, sel: this.sel });
    else drafts.delete(this.key);
  }
}

// ---------------------------------------------------------------------------------------------
// ✦ Learned

function learnedEntries() {
  let learned = {};
  try { learned = getSave()?.learned || {}; } catch { learned = {}; }
  if (!learned || typeof learned !== 'object') return [];
  return Object.entries(learned)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([id, v]) => ({ id, title: str(v.title).trim(), record: str(v.record).trim(), region: str(v.region).trim(), at: str(v.at), t: Date.parse(v.at) || 0 }))
    .sort((a, b) => b.t - a.t);
}

// content/concepts.json, only fetched for an entry that lacks its title or the book's note (an old save)
let conceptsP = null;
const concepts = () => (conceptsP ??= fetch('/content/concepts.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((list) => (Array.isArray(list) ? list : []))
  .catch(() => { conceptsP = null; return []; }));

const regionNames = new Map();
function regionName(value) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) return Promise.resolve(value); // already a display name
  if (!regionNames.has(value)) {
    regionNames.set(value, api.region(value).then((r) => str(r?.region?.name).trim() || value).catch(() => value));
  }
  return regionNames.get(value);
}

class LearnedPane {
  constructor(book) {
    this.book = book;
    this.list = h('div', { class: 'bk-col bk-lcol' });
    this.scroll = h('div', { class: 'bk-pscroll', tabindex: '-1' }, this.list);
    this.empty = emptyState('✦', SAY.learnedEmpty);
    this.root = h('section', { class: 'bk-pane bk-learned', role: 'tabpanel', 'aria-label': 'Learned' }, this.scroll, this.empty);
  }

  show({ initial } = {}) {
    const seen = Date.parse(ls.get(KEY_SEEN, '')) || 0;
    this.render(seen);
    ls.set(KEY_SEEN, new Date().toISOString());
    this.book.syncLearnedDot();
    if (initial) this.book.home(this.scroll);
  }

  hide() {}

  render(seen = Infinity) {
    const entries = learnedEntries();
    const groups = new Map();
    for (const e of entries) {
      const g = e.region || '·';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e);
    }
    const frag = document.createDocumentFragment();
    for (const [region, list] of groups) {
      const name = h('span', { class: 'bk-lg-name', text: region === '·' ? '✦' : region });
      if (region !== '·') regionName(region).then((n) => { if (n && name.isConnected) name.textContent = n; });
      frag.append(h('section', { class: 'bk-lg' },
        h('div', { class: 'bk-lg-h' }, name),
        ...list.map((e) => this.entry(e, seen))));
    }
    this.list.replaceChildren(frag);
    this.empty.hidden = entries.length > 0;
  }

  // the concept's title and the book's note on it; an entry missing either borrows it from concepts.json
  entry(e, seen) {
    const title = h('h3', { class: 'bk-lt', text: e.title || e.id });
    const note = h('p', { class: 'bk-lr', text: e.record, hidden: !e.record });
    if (!e.title || !e.record) {
      concepts().then((list) => {
        const c = list.find((x) => x && x.id === e.id);
        if (!c || !title.isConnected) return;
        if (!e.title && str(c.title).trim()) title.textContent = c.title.trim();
        if (!e.record && str(c.summary).trim()) { note.textContent = c.summary.trim(); note.hidden = false; }
      });
    }
    return h('article', { class: `bk-le${e.t > seen ? ' fresh' : ''}`, 'data-concept': e.id, title: e.at ? new Date(e.at).toLocaleDateString() : null }, title, note);
  }

  destroy() {}
}

// ---------------------------------------------------------------------------------------------
// faint drifting motes behind the pages

// Each mote is a tiny element moved by compositor animations (transform + opacity), so the drift
// costs the main thread nothing while the player reads. The top 30% fades out with a static mask.
class Motes {
  constructor(host) {
    this.host = host;
    this.w = 0;
    this.h = 0;
    this.anims = [];
    // first size at once, later ones (window resizes) once they settle
    this.ro = new ResizeObserver(() => { clearTimeout(this.t); if (this.w) this.t = setTimeout(() => this.build(), 120); else this.build(); });
    this.ro.observe(host);
  }

  build() {
    // layout size, not getBoundingClientRect: the book opens with a scale-in transform
    const w = this.host.clientWidth, hgt = this.host.clientHeight;
    if (!w || !hgt || (Math.abs(w - this.w) < 2 && Math.abs(hgt - this.h) < 2)) return;
    this.stop();
    this.w = w;
    this.h = hgt;
    const still = reducedMotion() || typeof Element.prototype.animate !== 'function';
    const n = Math.round(clamp((w * hgt) / 12000, 24, 90));
    const rnd = Math.random;
    const frag = document.createDocumentFragment();
    const loop = (el, frames, duration, more) => {
      this.anims.push(el.animate(frames, { duration, iterations: Infinity, delay: -rnd() * duration * 2, ...more }));
    };
    for (let i = 0; i < n; i++) {
      const size = (0.7 + rnd() ** 2 * 2.6) * 7;
      const alpha = 0.9 * (0.1 + rnd() * 0.42);
      const dot = h('i');
      const mote = h('i', { class: `bk-mote${rnd() < 0.15 ? ' cold' : ''}`, style: `left:${(rnd() * this.w).toFixed(1)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px` }, dot);
      frag.append(mote);
      if (still) {
        mote.style.top = `${(rnd() * this.h).toFixed(1)}px`;
        dot.style.opacity = (alpha * 0.8).toFixed(3);
        continue;
      }
      // rise from just below the pages to just above them at 4-17 px/s, swaying and twinkling
      mote.style.top = `${(this.h + 2).toFixed(1)}px`;
      const rise = this.h + size + 4;
      const riseMs = (rise / (4 + rnd() * 13)) * 1000;
      this.anims.push(mote.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-rise.toFixed(1)}px)` }],
        { duration: riseMs, iterations: Infinity, delay: -rnd() * riseMs, easing: 'linear' }));
      const sway = (4 + rnd() * 18).toFixed(1);
      loop(dot, [{ transform: `translateX(${-sway}px)` }, { transform: `translateX(${sway}px)` }],
        (Math.PI / (0.15 + rnd() * 0.6)) * 1000, { direction: 'alternate', easing: 'ease-in-out' });
      loop(dot, [{ opacity: (alpha * 0.1).toFixed(3) }, { opacity: alpha.toFixed(3) }],
        (Math.PI / (0.6 + rnd() * 2.2)) * 1000, { direction: 'alternate', easing: 'ease-in-out' });
    }
    this.host.replaceChildren(frag);
  }

  stop() {
    for (const a of this.anims) { try { a.cancel(); } catch { /* ignore */ } }
    this.anims = [];
  }

  destroy() {
    clearTimeout(this.t);
    this.ro.disconnect();
    this.stop();
    this.host.replaceChildren();
  }
}

// ---------------------------------------------------------------------------------------------
// the book itself

const PANES = { read: Reader, notes: NotesPane, ask: AskPane, learned: LearnedPane };
let current = null;

class Book {
  constructor({ paper, regionId, tab } = {}, done) {
    this.done = done;
    this.paper = paper && typeof paper === 'object' ? paper : {};
    this.arxivId = str(this.paper.arxivId).trim() || null;
    this.regionId = str(regionId).trim() || null;
    this.closed = false;
    this.tab = null;
    this.panes = {};
    this.tabBtns = {};
    this.prevFocus = document.activeElement;
    this.notes = new NoteStore(this.arxivId);

    this.motesEl = h('div', { class: 'bk-motes', 'aria-hidden': 'true' });
    this.sheet = h('div', { class: 'bk-sheet' }, this.motesEl);
    this.tabsEl = h('nav', { class: 'bk-tabs', role: 'tablist', 'aria-label': 'Book' });
    for (const t of TABS) {
      const b = h('button', { class: `bk-tab bk-tab-${t.id}`, type: 'button', role: 'tab', title: `${t.label} (${TAB_IDS.indexOf(t.id) + 1})`, 'data-tab': t.id, onclick: () => this.show(t.id) },
        h('span', { class: `bk-ico${t.emoji ? ' bk-emoji' : ''}`, 'aria-hidden': 'true', text: t.icon }),
        h('span', { class: 'bk-tl', text: t.label }));
      this.tabBtns[t.id] = b;
      this.tabsEl.append(b);
    }
    this.closeBtn = h('button', { class: 'bk-x', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', text: '✕', onclick: () => this.close() });
    const deco = (cls) => h('i', { class: cls, 'aria-hidden': 'true' });
    this.bookEl = h('div', { class: 'bk' },
      deco('bk-leaves'), this.sheet, this.tabsEl, this.closeBtn,
      // two sparks of light crawling round the edge, on four thin rails
      ...['t', 'r', 'b', 'l'].map((side) => h('i', { class: `bk-rail bk-rail-${side}`, 'aria-hidden': 'true' }, h('i'), h('i'))),
      deco('bk-cn bk-cn-tl'), deco('bk-cn bk-cn-bl'), deco('bk-cn bk-cn-br'),
      // its name, on a plate across the top of the cover (the dialog's name too, so hidden from readers here)
      h('div', { class: 'bk-name', 'aria-hidden': 'true', text: SAY.name }));
    this.root = h('div', { class: 'bk-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': SAY.name, style: 'visibility:hidden' }, this.bookEl);
    this.root.addEventListener('pointerdown', (e) => { this.downOnBackdrop = e.target === this.root; });
    this.root.addEventListener('click', (e) => { if (e.target === this.root && this.downOnBackdrop) this.close(); });

    (document.getElementById('ui-root') || document.body).append(this.root);
    openModal(this.root, { onEscape: () => this.escape() });
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    // keep keyboard focus inside the book while it is the top modal
    this.onFocusIn = (e) => {
      if (this.closed || topModal() !== this.root || this.root.contains(e.target)) return;
      (this.tabBtns[this.tab] || this.closeBtn).focus({ preventScroll: true });
    };
    document.addEventListener('focusin', this.onFocusIn);

    this.reader = this.pane('read');
    const first = TAB_IDS.includes(tab) ? tab : (TAB_IDS.includes(ls.get(KEY_TAB, 'read')) ? ls.get(KEY_TAB, 'read') : 'read');
    ensureCss().then(() => {
      if (this.closed) return;
      this.root.style.visibility = '';
      this.root.classList.add('is-open');
      this.motes = new Motes(this.motesEl);
      this.show(first, { initial: true });
      this.syncLearnedDot();
      this.reader.start();
    });
  }

  // Opening the book: give the keyboard to the pane (arrows scroll it; B and 1-4 still work),
  // unless the player is already somewhere inside the book.
  home(el) {
    requestAnimationFrame(() => {
      if (!this.closed && el.isConnected && !this.root.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
  }

  pane(id) {
    if (!this.panes[id]) {
      const p = new PANES[id](this);
      this.panes[id] = p;
      p.root.inert = true;
      this.sheet.append(p.root);
    }
    return this.panes[id];
  }

  // opts.initial: the book is just opening (not the player choosing a tab)
  show(id, opts = {}) {
    if (this.closed || !TAB_IDS.includes(id)) return;
    const prev = this.tab;
    const pane = this.pane(id);
    if (prev === id) { pane.show?.(opts); return; }
    if (prev) this.panes[prev]?.hide?.();
    this.tab = id;
    for (const [k, p] of Object.entries(this.panes)) {
      p.root.classList.toggle('on', k === id);
      p.root.inert = k !== id;
    }
    for (const [k, b] of Object.entries(this.tabBtns)) {
      b.classList.toggle('on', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    this.root.dataset.tab = id;
    ls.set(KEY_TAB, id);
    pane.show?.(opts);
  }

  jump(a) { this.show('read'); this.reader.jumpTo(a); }

  askAbout(text) {
    this.show('ask');
    const ask = this.pane('ask');
    ask.attach(text);
    ask.input.focus({ preventScroll: true });
  }

  syncLearnedDot() {
    const newest = learnedEntries()[0]?.t || 0;
    const seen = Date.parse(ls.get(KEY_SEEN, '')) || 0;
    this.tabBtns.learned.classList.toggle('bk-new', newest > seen && this.tab !== 'learned');
  }

  key(e) {
    if (this.closed || e.repeat || topModal() !== this.root) return;
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^Digit[1-4]$/.test(e.code)) { e.preventDefault(); this.show(TAB_IDS[Number(e.code.slice(5)) - 1]); return; }
    if (e.code === 'KeyB') { e.preventDefault(); this.close(); return; }
    if (this.tab !== 'read') return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); this.reader.zoomBy(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.reader.zoomBy(-1); }
    else if (e.key === '0') { e.preventDefault(); this.reader.setZoom(1); }
  }

  escape() {
    if (this.tab === 'read' && this.reader.dismiss()) return;
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const p of Object.values(this.panes)) { try { p.destroy?.(); } catch (e) { console.warn('[book]', e); } }
    this.motes?.destroy();
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('focusin', this.onFocusIn);
    closeModal(this.root);
    this.root.classList.add('is-closing');
    const finish = () => {
      this.root.remove();
      try { if (this.prevFocus?.isConnected) this.prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (current === this) current = null;
      this.done();
    };
    if (reducedMotion() || this.root.style.visibility === 'hidden') finish();
    else setTimeout(finish, 190);
  }
}

export function open(opts = {}) {
  current?.close();
  return new Promise((resolve) => { current = new Book(opts || {}, resolve); });
}

export function isOpen() {
  return !!current && !current.closed;
}

// A new game: forget every note, highlight, chat, page position and preference the book keeps
// (localStorage etl-notes-* and etl-book-*, plus unsent drafts). For resetSave() to call.
export function clearBookData() {
  current?.close(); // an open book would write its page and tab back on closing
  drafts.clear();
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('etl-notes-') || k.startsWith('etl-book-'))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* storage unavailable: nothing kept anyway */ }
}

export default { open, isOpen, clearBookData };
