// Python challenge terminal (owner: terminal).
//
//   open({ challenge, regionId }) -> Promise<{ solved: boolean, code: string }>
//
// A cozy typewriter terminal: the task on the left (a markdown subset), an editor and a console on
// the right, worded keys (▶ Run, ✓ Run tests, ↺ Reset code, ✕ Close). Player code runs in a
// Pyodide worker (js/workers/pyodide-worker.js); a run longer than 20 s is killed and the worker
// respawned. Drafts autosave to localStorage `etl-code-<regionId>-<challengeId>`. All tests passing ->
// a "Solved!" stamp and paper confetti -> the draft is deleted -> resolves { solved: true, code }.
// Esc closes with solved: false. The console: a status line while Python loads or runs (or the
// offline line as soon as it fails to load), then "n / N tests pass" (one pip per test), what the code
// printed, and each failing test's own message, said once for tests that fail the same way.
import { openModal, closeModal, topModal } from './modal.js';

const CSS_HREF = '/css/terminal.css';
const WORKER_URL = '/js/workers/pyodide-worker.js';
export const RUN_TIMEOUT_MS = 20000;
const INDENT = '    ';
const draftKey = (regionId, id) => `etl-code-${regionId}-${id}`;

// ---------------------------------------------------------------------------------------------
// small helpers

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;   // only ever our own escaped markup
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* full or blocked: keep going */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureCss() {
  if (ensureCss.p) return ensureCss.p;
  let link = document.querySelector(`link[rel="stylesheet"][href$="${CSS_HREF}"]`);
  if (link && link.sheet) return (ensureCss.p = Promise.resolve());
  if (!link) {
    link = h('link', { rel: 'stylesheet', href: CSS_HREF, id: 'etl-terminal-css' });
    document.head.append(link);
  }
  ensureCss.p = new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 2000);
  });
  return ensureCss.p;
}

// Line icons (SVG, so they look the same everywhere). currentColor, 24x24.
const ICON_PATHS = {
  run: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  test: '<path d="M4.8 12.6l4.6 4.6L19.4 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  reset: '<path d="M5.2 13.2A7 7 0 1 0 7.4 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M6.6 3.4v4.4H11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.4" fill="currentColor"/>',
  send: '<path d="M4 12.2L19.5 5l-4.6 14.6-3.2-5.9z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11.7 13.7L19.5 5" stroke="var(--paper, #fffdf6)" stroke-width="1.6" stroke-linecap="round"/>',
  offline: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M6.8 6.8l10.4 10.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  timer: '<circle cx="12" cy="13.2" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 13.2V9.6M10 3.6h4M18 6.6l1.4-1.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  pen: '<path d="M5 19l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L9.2 18z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
};
export function icon(name, cls = 'etl-ico') {
  const span = h('span', { class: cls, 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" focusable="false">${ICON_PATHS[name] || ''}</svg>`;
  return span;
}

// A key's words. Several labels can share one spot (only the .on one shows), so a key that swaps
// its label (Run / Stop) keeps its width.
function keyText(...labels) {
  return h('span', { class: 'term-key-txt' }, ...labels.map((text, i) => h('span', { class: i ? '' : 'on', text })));
}
function showLabel(key, text) {
  for (const s of key.querySelector('.term-key-txt').children) s.classList.toggle('on', s.textContent === text);
}

// ---------------------------------------------------------------------------------------------
// Python syntax colouring (for the editor overlay and fenced code)

const PY_KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const PY_BUILTINS = new Set('abs all any bool dict divmod enumerate filter float int isinstance len list map max min print range reversed round set sorted str sum tuple type zip super object len Exception ValueError TypeError IndexError KeyError NotImplementedError AssertionError'.split(' '));
const PY_TOKEN = /(#[^\n]*)|((?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*(?:"|(?=\n)|$)|'(?:\\.|[^'\\\n])*(?:'|(?=\n)|$)))|((?:\b\d[\d_]*(?:\.[\d_]*)?|(?<![\w.])\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)/g;

export function highlightPython(src) {
  const text = String(src ?? '');
  let out = '';
  let last = 0;
  let wantName = false;
  for (const m of text.matchAll(PY_TOKEN)) {
    out += esc(text.slice(last, m.index));
    last = m.index + m[0].length;
    const t = m[0];
    let cls = '';
    if (m[1]) cls = 'c';
    else if (m[2]) cls = 's';
    else if (m[3]) cls = 'n';
    else if (m[4]) cls = 'd';
    else if (m[5]) cls = wantName ? 'f' : PY_KEYWORDS.has(t) ? 'k' : PY_BUILTINS.has(t) ? 'b' : (t === 'self' || t === 'np') ? 'v' : '';
    wantName = !!m[5] && (t === 'def' || t === 'class');
    out += cls ? `<span class="tk-${cls}">${esc(t)}</span>` : esc(t);
  }
  return out + esc(text.slice(last));
}

// ---------------------------------------------------------------------------------------------
// $math$: a little TeX, drawn as styled monospace (greek, operators, sub/superscripts, fractions, roots)

const TEX = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  sim: '∼', equiv: '≡', propto: '∝', ll: '≪', gg: '≫', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', sum: 'Σ', prod: 'Π', int: '∫', infty: '∞', partial: '∂', nabla: '∇', odot: '⊙', otimes: '⊗',
  oplus: '⊕', circ: '∘', star: '⋆', to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', iff: '⇔', mapsto: '↦',
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', top: 'ᵀ', intercal: 'ᵀ', prime: '′', Vert: '‖', lVert: '‖', rVert: '‖',
  vert: '|', mid: '|', lvert: '|', rvert: '|', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '{': '{', '}': '}',
  '\\': ' ', _: '_', '%': '%', $: '$', '&': '&', '#': '#',
  log: 'log', ln: 'ln', exp: 'exp', max: 'max', min: 'min', arg: 'arg', argmax: 'argmax', argmin: 'argmin', sin: 'sin',
  cos: 'cos', tanh: 'tanh', det: 'det', dim: 'dim', lim: 'lim', sup: 'sup', inf: 'inf', softmax: 'softmax',
};
const TEX_SKIP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle', 'limits', 'nolimits']);
const TEX_FONT = { text: 'rm', textrm: 'rm', mathrm: 'rm', operatorname: 'rm', mathsf: 'rm', texttt: 'rm', mathcal: 'rm', mathit: 'i', textit: 'i', mathbf: 'b', textbf: 'b', boldsymbol: 'b', bm: 'b' };
const TEX_ACCENT = { hat: '̂', widehat: '̂', bar: '̄', overline: '̅', tilde: '̃', widetilde: '̃', vec: '⃗', dot: '̇', ddot: '̈' };
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', E: '𝔼', P: 'ℙ' };

export function renderTex(src) {
  const s = String(src ?? '');
  let i = 0;
  const text = (t) => document.createTextNode(t);
  const skipSpace = () => { while (s[i] === ' ') i++; };
  function group() {               // after '{'
    const frag = document.createDocumentFragment();
    while (i < s.length && s[i] !== '}') frag.append(atom());
    i++;
    return frag;
  }
  function arg() {                 // one braced group, one command, or one character (as TeX does)
    skipSpace();
    if (s[i] === '{') { i++; return group(); }
    if (s[i] === '\\') return atom();
    return text(i < s.length ? s[i++] : '');
  }
  function rawArg() {
    skipSpace();
    if (s[i] !== '{') return s[i++] ?? '';
    let depth = 1;
    let j = ++i;
    while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
    const t = s.slice(i, depth ? j : j - 1);
    i = j;
    return t;
  }
  function atom() {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|[^A-Za-z])/.exec(s.slice(i));
      i += m ? m[0].length : 1;
      const name = m ? m[1] : '';
      if (TEX_SKIP.has(name)) return text('');
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const num = arg();
        const den = arg();
        return h('span', { class: 'tx-frac' }, h('span', { class: 'tx-num' }, num), h('span', { class: 'tx-den' }, den));
      }
      if (name === 'sqrt') {
        let index = '';
        if (s[i] === '[') { const j = s.indexOf(']', i); index = s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; }
        return h('span', { class: 'tx-sqrt' }, index ? h('sup', { class: 'tx-s', text: index }) : null, '√', h('span', { class: 'tx-rad' }, arg()));
      }
      if (name === 'mathbb') return text([...rawArg()].map((ch) => BLACKBOARD[ch] || ch).join(''));
      if (name in TEX_FONT) {
        const raw = rawArg();
        const literal = name.startsWith('text') || name === 'operatorname';
        return h('span', { class: `tx-${TEX_FONT[name]}` }, literal ? raw : renderTex(raw));
      }
      if (name in TEX_ACCENT) return text(rawArg() + TEX_ACCENT[name]);
      if (name in TEX) return text(TEX[name]);
      return text(name);
    }
    if (c === '{') { i++; return group(); }
    if (c === '^' || c === '_') {
      i++;
      skipSpace();
      if (c === '^' && /^\\(top|intercal)(?![A-Za-z])/.test(s.slice(i))) { i += s.startsWith('\\top', i) ? 4 : 9; return text('ᵀ'); }
      return h(c === '^' ? 'sup' : 'sub', { class: 'tx-s' }, arg());
    }
    if (c === '~') { i++; return text(' '); }
    const m = /^[^\\{}^_~]+/.exec(s.slice(i));
    if (m) { i += m[0].length; return text(m[0]); }
    i++;                             // a stray '}'
    return text('');
  }
  const frag = document.createDocumentFragment();
  while (i < s.length) frag.append(atom());
  return frag;
}

// ---------------------------------------------------------------------------------------------
// Markdown subset: headings, paragraphs, lists, quotes, rules, **bold**, *italic*, `code`,
// fenced code, $math$ / $$math$$. Built as DOM nodes (content is never parsed as HTML).

const INLINE_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\$\$([^$]+?)\$\$|\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?!\d)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)|(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])|(?<![\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)|\\([\\`*_$[\]#|~-])/g;

export function renderInline(src, parent = document.createDocumentFragment()) {
  const s = String(src ?? '');
  let last = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    if (m.index > last) parent.append(s.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      let code = m[2];
      if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
      // short chips like `(n_q, d_v)` never break in the middle; long ones may
      parent.append(h('code', { class: code.length < 24 ? 'md-code md-nowrap' : 'md-code', text: code }));
    } else if (m[3] != null) parent.append(h('span', { class: 'md-math' }, renderTex(m[3])));
    else if (m[4] != null) parent.append(h('span', { class: 'md-math' }, renderTex(m[4])));
    else if (m[5] != null || m[6] != null) parent.append(renderInline(m[5] ?? m[6], h('strong')));
    else if (m[7] != null || m[8] != null) parent.append(renderInline(m[7] ?? m[8], h('em')));
    else if (m[9] != null) parent.append(renderInline(m[9], h('span', { class: 'md-link', title: m[10] })));
    else if (m[11] != null) parent.append(m[11]);
  }
  if (last < s.length) parent.append(s.slice(last));
  return parent;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>/;
const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const isBlockStart = (l) => FENCE_RE.test(l) || HEADING_RE.test(l) || RULE_RE.test(l) || QUOTE_RE.test(l) || /^\s*\$\$/.test(l);

function parseList(lines, i, parent) {
  const stack = [];   // { indent, ordered, list, li }
  while (i < lines.length) {
    const line = lines[i];
    const m = LIST_RE.exec(line);
    if (!m || RULE_RE.test(line)) {
      if (!line.trim()) {           // a blank line inside a list keeps the list going
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && LIST_RE.test(lines[j]) && !RULE_RE.test(lines[j])) { i = j; continue; }
      }
      break;
    }
    const indent = m[1].replace(/\t/g, INDENT).length;
    const ordered = /\d/.test(m[2]);
    while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    if (top && indent === top.indent && ordered !== top.ordered) { stack.pop(); top = stack[stack.length - 1]; }
    if (!top || indent > top.indent) {
      const list = h(ordered ? 'ol' : 'ul', { class: 'md-list' });
      const start = parseInt(m[2], 10);
      if (ordered && start > 1) list.setAttribute('start', String(start));
      (top ? top.li : parent).append(list);
      top = { indent, ordered, list, li: null };
      stack.push(top);
    }
    let body = m[3];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !LIST_RE.test(lines[j]) && !isBlockStart(lines[j])) body += ` ${lines[j++].trim()}`;
    top.li = renderInline(body, h('li'));
    top.list.append(top.li);
    i = j;
  }
  return i;
}

export function renderMarkdown(src) {
  const frag = document.createDocumentFragment();
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => {
    if (para.length) frag.append(renderInline(para.join(' '), h('p')));
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m = FENCE_RE.exec(line);
    if (m) {
      flush();
      const fence = m[1];
      const lang = m[2].toLowerCase();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      const code = h('code');
      const text = body.join('\n');
      if (!lang || lang === 'python' || lang === 'py') code.innerHTML = highlightPython(text);
      else code.textContent = text;
      frag.append(h('pre', { class: 'md-pre' }, code));
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      flush();
      let rest = line.trim().slice(2);
      const body = [];
      i++;
      if (rest.includes('$$')) body.push(rest.slice(0, rest.indexOf('$$')));
      else {
        body.push(rest);
        while (i < lines.length && !lines[i].includes('$$')) body.push(lines[i++]);
        if (i < lines.length) { body.push(lines[i].slice(0, lines[i].indexOf('$$'))); i++; }
      }
      frag.append(h('div', { class: 'md-math md-math-block' }, renderTex(body.join(' ').trim())));
      continue;
    }
    m = HEADING_RE.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      frag.append(renderInline(m[2], h(`h${Math.min(level + 1, 6)}`, { class: `md-h md-h${Math.min(level, 4)}` })));
      i++;
      continue;
    }
    if (RULE_RE.test(line)) { flush(); frag.append(h('hr', { class: 'md-hr' })); i++; continue; }
    if (QUOTE_RE.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      frag.append(h('blockquote', { class: 'md-quote' }, renderMarkdown(body.join('\n'))));
      continue;
    }
    if (LIST_RE.test(line)) { flush(); i = parseList(lines, i, frag); continue; }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return frag;
}

// ---------------------------------------------------------------------------------------------
// The Python runner: one worker shared by every terminal, so Python loads once per session.

const LOAD_TIMEOUT_MS = 120000;
const IDLE_MS = 4 * 60 * 1000;          // Python is let go a few minutes after the last terminal closes

class Runner {
  constructor() {
    this.worker = null;
    this.state = 'idle';          // idle | loading | ready | running | failed
    this.readyP = null;
    this.readyResolve = null;
    this.seq = 0;
    this.job = null;              // { id, resolve, timer, posted }
    this.subs = new Set();
    this.users = 0;
    this.idleTimer = 0;
    this.loadedOnce = false;      // after that, a fresh worker is a restart (after Stop, a timeout...)
  }

  // open terminals hold Python; with none open it is freed after IDLE_MS (it reloads from cache)
  hold() {
    this.users++;
    clearTimeout(this.idleTimer);
  }

  release() {
    this.users = Math.max(0, this.users - 1);
    this.idleLater();
  }

  idleLater() {
    clearTimeout(this.idleTimer);
    if (this.users) return;
    this.idleTimer = setTimeout(() => {
      if (this.users || this.job) return;
      this.dropWorker();
      this.set('idle');
    }, IDLE_MS);
  }

  set(state) {
    this.state = state;
    if (state === 'ready') this.loadedOnce = true;
    for (const fn of this.subs) { try { fn(state); } catch (e) { console.error(e); } }
  }

  subscribe(fn) {
    this.subs.add(fn);
    fn(this.state);
    return () => this.subs.delete(fn);
  }

  spawn() {
    this.dropWorker();
    let w;
    try { w = new Worker(WORKER_URL); } catch (err) {
      console.error('[terminal] no worker', err);
      this.set('failed');
      return (this.readyP = Promise.resolve(false));
    }
    this.worker = w;
    this.set('loading');
    this.readyP = new Promise((resolve) => {
      this.readyResolve = resolve;
      const giveUp = setTimeout(() => fail('load timeout'), LOAD_TIMEOUT_MS);
      const fail = (why) => {
        clearTimeout(giveUp);
        if (this.worker !== w) return resolve(false);
        console.warn('[terminal] Python failed to load:', why);
        this.dropWorker();
        this.set('failed');
        resolve(false);
      };
      w.onmessage = (e) => {
        const msg = e.data || {};
        if (msg.type === 'ready') {
          clearTimeout(giveUp);
          if (!msg.ok) return fail(msg.error);
          if (this.worker === w && this.state === 'loading') this.set('ready');
          resolve(true);
        } else if (msg.type === 'result') this.settle(msg);
      };
      w.onerror = (e) => { e.preventDefault?.(); fail(e.message || 'worker error'); };
      w.postMessage({ type: 'init' });
    });
    return this.readyP;
  }

  ensure() {
    if (!this.worker || this.state === 'failed') return this.spawn();
    return this.readyP;
  }

  dropWorker() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* gone */ } }
    this.worker = null;
    const wake = this.readyResolve;
    this.readyResolve = null;
    wake?.(false);                    // nobody waits forever on a dead worker
  }

  // -> the worker's result, or { timeout | cancelled | offline: true }
  run(code, tests) {
    if (this.job) this.cancel();
    const job = { id: ++this.seq, resolve: null, timer: 0, posted: false };
    const done = new Promise((r) => { job.resolve = r; });
    this.job = job;
    (async () => {
      let ok = false;
      for (let tries = 0; tries < 4 && this.job === job; tries++) {
        ok = await this.ensure();
        if (ok && this.worker) break;
        if (this.state !== 'loading') break;   // a fresh worker replaced the old one: wait for it
      }
      if (this.job !== job) return;            // cancelled while Python was loading
      if (!ok || !this.worker) { this.job = null; job.resolve({ offline: true }); return; }
      job.posted = true;
      job.timer = setTimeout(() => {
        if (this.job !== job) return;
        this.job = null;
        this.spawn();                          // terminate + respawn
        job.resolve({ timeout: true });
      }, RUN_TIMEOUT_MS);
      this.set('running');
      this.worker.postMessage({ type: 'run', id: job.id, code, tests });
    })();
    return done;
  }

  settle(msg) {
    const job = this.job;
    if (!job || job.id !== msg.id) return;
    this.job = null;
    clearTimeout(job.timer);
    if (msg.fatal) this.spawn();
    else this.set('ready');
    job.resolve(msg);
  }

  cancel() {
    const job = this.job;
    if (!job) return;
    this.job = null;
    clearTimeout(job.timer);
    if (job.posted) this.spawn();              // a program is running: kill it
    job.resolve({ cancelled: true });
  }

  get busy() { return !!this.job; }
}

const runner = new Runner();

// Start loading Python early (e.g. when the player walks up to a terminal).
export function preload() {
  runner.ensure();
  runner.idleLater();
}

// ---------------------------------------------------------------------------------------------
// The editor: a textarea over a syntax-coloured <pre>, with a line-number gutter.

function createEditor(initial, { onChange }) {
  const lns = h('div', { class: 'term-lns' });
  const gutter = h('div', { class: 'term-gutter', 'aria-hidden': 'true' }, lns);
  const codeEl = h('code');
  const stripe = h('div', { class: 'term-stripe' });
  stripe.hidden = true;
  const pre = h('pre', { class: 'term-hl', 'aria-hidden': 'true' }, stripe, codeEl);
  const ta = h('textarea', {
    class: 'term-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
    wrap: 'off', 'aria-label': 'Python', 'data-gramm': 'false',
  });
  ta.value = initial;
  const view = h('div', { class: 'term-view' }, pre, ta);
  const el = h('div', { class: 'term-editor' }, gutter, view);

  let lineCount = 0;
  let marked = null;

  function lineHeight() { return parseFloat(getComputedStyle(ta).lineHeight) || 22; }
  function padTop() { return parseFloat(getComputedStyle(ta).paddingTop) || 0; }

  function renderGutter() {
    const n = ta.value.split('\n').length;
    if (n === lineCount) return;
    lineCount = n;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i++) frag.append(h('div', { class: 'term-ln', text: String(i) }));
    lns.replaceChildren(frag);
    paintMark();
  }

  function paintMark() {
    lns.querySelector('.term-ln.bad')?.classList.remove('bad');
    if (!marked || marked > lineCount) { stripe.hidden = true; return; }
    lns.children[marked - 1]?.classList.add('bad');
    stripe.hidden = false;
    stripe.style.top = `${padTop() + (marked - 1) * lineHeight()}px`;
    stripe.style.height = `${lineHeight()}px`;
  }

  function sync() {
    const v = ta.value;
    codeEl.innerHTML = highlightPython(v) + (v.endsWith('\n') || !v ? ' ' : '');
    renderGutter();
    scrollSync();
  }

  function scrollSync() {
    pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    lns.style.transform = `translateY(${-ta.scrollTop}px)`;
  }

  // Replace [start, end) with text, through the browser's editing stack so Ctrl+Z still works.
  function edit(start, end, text, selStart = start + text.length, selEnd = selStart) {
    const before = ta.value;
    const want = before.slice(0, start) + text + before.slice(end);
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand(text ? 'insertText' : 'delete', false, text); } catch { ok = false; }
    if (!ok || ta.value !== want) {
      ta.value = want;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(selStart, selEnd);
  }

  const lineStart = (v, pos) => v.lastIndexOf('\n', pos - 1) + 1;

  function blockRange() {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const ls = lineStart(v, s);
    const last = e > s && v[e - 1] === '\n' ? e - 1 : e;
    const nl = v.indexOf('\n', last);
    return { s, e, ls, le: nl < 0 ? v.length : nl, v };
  }

  function indent() {
    const { s, e, ls, le, v } = blockRange();
    if (!v.slice(s, e).includes('\n')) {
      const col = s - lineStart(v, s);
      edit(s, e, ' '.repeat(4 - (col % 4)));
      return;
    }
    const lines = v.slice(ls, le).split('\n');
    const out = lines.map((l) => (l.trim() ? INDENT + l : l));
    const firstAdd = lines[0].trim() ? 4 : 0;
    const added = out.join('\n').length - (le - ls);
    edit(ls, le, out.join('\n'), s + firstAdd, e + added);
  }

  function dedent() {
    const { s, e, ls, le, v } = blockRange();
    const lines = v.slice(ls, le).split('\n');
    let first = 0;
    let total = 0;
    const out = lines.map((l, k) => {
      const lead = /^ */.exec(l)[0].length;
      const cut = lead ? (lead % 4 || 4) : (l[0] === '\t' ? 1 : 0);
      if (k === 0) first = cut;
      total += cut;
      return l.slice(cut);
    });
    if (!total) return;
    const ns = Math.max(ls, s - first);
    edit(ls, le, out.join('\n'), ns, s === e ? ns : Math.max(ns, e - total));
  }

  function newline() {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const ls = lineStart(v, s);
    const line = v.slice(ls, s);
    let pad = /^[ \t]*/.exec(line)[0];
    const code = line.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').trimEnd();
    if (/[:([{]$/.test(code)) pad += INDENT;
    else if (/^\s*(return|pass|break|continue|raise)\b/.test(code)) pad = pad.slice(0, Math.max(0, pad.length - 4));
    edit(s, e, `\n${pad}`);
  }

  function backspace() {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    if (s !== e) return false;
    const before = v.slice(lineStart(v, s), s);
    if (before.length < 2 || /[^ ]/.test(before)) return false;
    edit(s - (before.length % 4 || 4), s, '');
    return true;
  }

  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') return;      // the terminal's window-level shortcut handles it
    if (e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); (e.shiftKey ? dedent : indent)(); return; }
    if (e.key === 'Enter' && !mod && !e.altKey) { e.preventDefault(); newline(); return; }
    if (e.key === 'Backspace' && !mod && !e.altKey && !e.shiftKey && backspace()) e.preventDefault();
  });
  ta.addEventListener('input', () => {
    if (marked) { marked = null; paintMark(); }
    sync();
    onChange(ta.value);
  });
  ta.addEventListener('scroll', scrollSync, { passive: true });

  sync();

  return {
    el,
    ta,
    get value() { return ta.value; },
    replaceAll(text) { edit(0, ta.value.length, text, 0, 0); ta.scrollTop = 0; ta.scrollLeft = 0; scrollSync(); },
    mark(line) { marked = Number.isInteger(line) && line > 0 ? line : null; paintMark(); },
    goTo(line) {
      const lines = ta.value.split('\n');
      const n = Math.min(Math.max(1, line), lines.length);
      let pos = 0;
      for (let k = 0; k < n - 1; k++) pos += lines[k].length + 1;
      const indentLen = /^\s*/.exec(lines[n - 1])[0].length;
      ta.focus();
      ta.setSelectionRange(pos + indentLen, pos + lines[n - 1].length);
      const y = (n - 1) * lineHeight();
      if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - 2 * lineHeight()) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
      scrollSync();
    },
    // caret on the first TODO / NotImplementedError line, keeping the top of the file in view when it fits
    focusStart() {
      const v = ta.value;
      const m = /^[ \t]*(?:#.*(?:your code|todo)|raise NotImplementedError|pass\b)/im.exec(v);
      const at = m ? m.index + /^[ \t]*/.exec(m[0])[0].length : 0;
      ta.setSelectionRange(at, at);
      ta.focus({ preventScroll: true });
      const lh = lineHeight();
      const y = (v.slice(0, at).split('\n').length - 1) * lh;
      ta.scrollTop = y + 3 * lh > ta.clientHeight ? y - ta.clientHeight + 4 * lh : 0;
      ta.scrollLeft = 0;
      scrollSync();
    },
    refresh: sync,
  };
}

// ---------------------------------------------------------------------------------------------
// Paper confetti over the terminal (cut-paper bits with an ink edge)

function paperConfetti(host, count = 80) {
  const layer = h('div', { class: 'term-confetti', 'aria-hidden': 'true' });
  const colors = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#8fd3ff', '#b39cff', '#ff8a3d', '#fffdf6'];
  for (let i = 0; i < count; i++) {
    const p = h('i', { class: `cf cf-${i % 3}` });
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 220)}px`);
    p.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 1100)}deg`);
    p.style.animationDuration = `${(1.5 + Math.random() * 1.5).toFixed(2)}s`;
    p.style.animationDelay = `${(Math.random() * 0.45).toFixed(2)}s`;
    layer.append(p);
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 3800);
}

// ---------------------------------------------------------------------------------------------
// open()

const pretty = (name) => (name === 'tests' ? '' : String(name).replace(/^test_?/, '').replace(/_+/g, ' ').trim());
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// "ValueError: matmul: … (size 2 is different from 9)" -> "ValueError"; a message that does not start
// with an error type (an assertion's own words) stays whole
const errorType = (m) => /^[A-Za-z_][\w.]*(?=:|$)/.exec(m)?.[0] ?? m;

export async function open({ challenge = {}, regionId = 'local' } = {}) {
  await ensureCss();
  const root = document.getElementById('ui-root') || document.body;
  const id = challenge.id || 'code';
  const key = draftKey(regionId, id);
  const starter = String(challenge.starterCode ?? '');
  const draft = store.get(key);
  const title = challenge.title || 'Python';

  return new Promise((resolve) => {
    let closed = false;
    let busy = false;
    let solved = false;
    let saveTimer = 0;

    const saveNow = () => { clearTimeout(saveTimer); store.set(key, editor.value); };

    // ---- the task
    const prompt = h('article', { class: 'term-prompt', tabindex: '0' }, renderMarkdown(challenge.prompt || ''));
    const first = prompt.firstElementChild;
    if (first?.classList.contains('md-h') && norm(first.textContent) === norm(title)) first.remove();

    // ---- keys: an icon and a word or two; shortcuts and details in the tooltips
    const key_ = (act, ico, words, tip, cls = '') =>
      h('button', { class: `term-key ${cls}`.trim(), type: 'button', title: tip, 'data-act': act }, icon(ico), words);
    const RUN_TIP = 'Run your code · Ctrl+Shift+Enter';
    const RESET_TIP = 'Back to the starter code';
    const runKey = key_('run', 'run', keyText('Run', 'Stop'), RUN_TIP);
    const testKey = key_('test', 'test', keyText('Run tests'), 'Check your code · Ctrl+Enter', 'go');
    const resetKey = key_('reset', 'reset', keyText('Reset code', 'Sure?'), RESET_TIP);
    const closeKey = key_('close', 'close', keyText('Close'), 'Esc · your code is kept', 'term-close');

    // ---- editor + console (a status line while Python loads or runs, then the results)
    const editor = createEditor(draft ?? starter, {
      onChange: () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); },
    });
    const statusText = h('span', { class: 'term-status-txt' });
    const status = h('div', { class: 'term-status', role: 'status' }, h('span', { class: 'term-spin', 'aria-hidden': 'true' }), statusText);
    status.hidden = true;
    const log = h('div', { class: 'term-log', 'aria-live': 'polite' });
    const out = h('div', { class: 'term-out' }, log, status);
    const stage = h('div', { class: 'term-stage' }, editor.el);

    const panel = h('div', { class: 'term etl-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('span', { class: 'term-tag', text: title, title: challenge.paperLink || title }),
      closeKey,
      h('div', { class: 'term-body' },
        prompt,
        h('div', { class: 'term-right' }, stage, h('div', { class: 'term-keys' }, runKey, testKey, resetKey), out)));
    const overlay = h('div', { class: 'term-overlay' }, panel);

    // ---- python state -> status line ("Running…" only once a run takes a moment, so quick runs don't flicker)
    let statusTimer = 0;
    const setStatus = (text) => {
      clearTimeout(statusTimer);
      status.hidden = !text;
      out.classList.toggle('has-status', !!text);
      statusText.textContent = text;
    };
    // Python failing to load says so at once (a blank console would look ready); the next run tries again
    const row = (cls, ...kids) => h('div', { class: `term-row ${cls}` }, ...kids);
    const msg = (text) => h('span', { class: 'term-msg', text });
    const offlineRow = () => row('bad', icon('offline', 'term-ic'), msg("Python didn't load (offline?). Try again."));
    let pyDown = null;
    const unsubscribe = runner.subscribe((state) => {
      panel.dataset.py = state;
      if (state !== 'failed' && pyDown) { pyDown.remove(); pyDown = null; }
      if (state === 'loading') setStatus(runner.loadedOnce ? 'Restarting Python…' : 'Loading Python…');
      else if (state === 'running') {
        setStatus('');
        statusTimer = setTimeout(() => setStatus('Running…'), 300);
      } else {
        setStatus('');
        if (state === 'failed' && !busy && !log.contains(pyDown)) log.append((pyDown = offlineRow()));   // a run in flight says it itself
      }
    });

    function setBusy(on) {
      busy = on;
      panel.classList.toggle('is-busy', on);
      runKey.querySelector('.etl-ico').replaceWith(icon(on ? 'stop' : 'run'));
      showLabel(runKey, on ? 'Stop' : 'Run');
      runKey.title = on ? 'Stop the program' : RUN_TIP;
      testKey.disabled = on;
    }

    // ---- console rendering
    const mark = (text) => h('span', { class: 'term-mark', text });
    const lineBtn = (line) => h('button', {
      class: 'term-lnk', type: 'button', title: `Go to line ${line}`,
      onclick: (e) => { e.stopPropagation(); editor.goTo(line); },
    }, `line ${line}`);

    // Tests: "n / N tests pass", one pip per test (its name and message in the tooltip), what the code
    // printed, then each failing test's own message: ✗ message [k tests] [line 7]. Tests that fail the
    // same way share one row: the same assertion message, or a crash on the same line of the player's
    // code with the same error type (numpy says the same error with other shapes). A crash's line is
    // marked in the editor; with crashes on several lines, click a row or a red pip to pick which.
    function showTests(results, prints) {
      const n = results.length;
      const pass = results.filter((t) => t.passed).length;
      const groups = [];
      const groupOf = results.map((t) => {
        if (t.passed) return null;
        const text = t.message || pretty(t.name) || 'failed';
        const line = t.line || null;
        const key = line ? `${line} ${errorType(text)}` : text;
        let g = groups.find((x) => x.key === key);
        if (!g) groups.push((g = { key, text, line, tests: [] }));
        g.tests.push(t);
        return g;
      });
      const lined = groups.filter((g) => g.line);
      const pick = lined.length > 1;       // only then is there a choice of line to mark
      const pips = h('span', { class: 'term-pips' });
      const select = (g, scroll) => {
        for (const x of groups) x.row.classList.toggle('sel', x === g);
        [...pips.children].forEach((pip, i) => pip.classList.toggle('sel', groupOf[i] === g));
        editor.mark(g.line);
        if (scroll) g.row.scrollIntoView({ block: 'nearest' });
      };
      results.forEach((t, i) => {
        const g = groupOf[i];
        const pip = h('i', { class: t.passed ? 'ok' : `bad${pick && g.line ? ' pick' : ''}`, title: [pretty(t.name), t.passed ? 'passes' : t.message].filter(Boolean).join('\n') });
        if (pick && g?.line) pip.addEventListener('click', () => select(g, true));
        pips.append(pip);
      });
      const summary = n === 1 ? (pass ? 'The test passes' : 'The test fails') : `${pass} / ${n} tests pass`;
      // what the code printed goes right under the summary, where a player debugging with print() looks
      log.append(h('div', { class: `term-sum ${pass === n ? 'ok' : 'bad'}` }, h('b', { text: summary }), pips), ...prints);
      for (const g of groups) {
        const k = g.tests.length;
        const same = g.tests.every((t) => t.message === g.tests[0].message);
        g.row = row(`bad term-fail${pick && g.line ? ' pickable' : ''}`, mark('✗'), msg(g.text),
          k > 1 ? h('span', { class: 'term-count', text: `${k} tests` }) : null, g.line ? lineBtn(g.line) : null);
        // the tests (each with its own message when they differ), then where it crashed
        g.row.title = [...g.tests.map((t) => (same ? pretty(t.name) : [pretty(t.name), t.message].filter(Boolean).join(' — '))), g.tests[0].trace]
          .filter(Boolean).join('\n');
        if (pick && g.line) g.row.addEventListener('click', () => select(g));
        log.append(g.row);
      }
      if (pick) select(lined[0]);
      else if (lined.length) editor.mark(lined[0].line);
    }

    function show(res, mode) {
      log.replaceChildren();
      editor.mark(null);
      if (res.timeout) { log.append(row('warn', icon('timer', 'term-ic'), msg(`Stopped after ${RUN_TIMEOUT_MS / 1000} s. Endless loop?`))); return; }
      if (res.cancelled) { log.append(row('muted', icon('stop', 'term-ic'), msg('Stopped'))); return; }
      if (res.offline) { log.append(offlineRow()); return; }
      const prints = [
        res.stdout ? h('pre', { class: 'term-stdout', text: res.stdout.replace(/\n$/, '') }) : null,
        res.stderr ? h('pre', { class: 'term-stderr', text: res.stderr.replace(/\n$/, '') }) : null,
      ].filter(Boolean);
      if (res.error) {
        const r = row('bad', mark('✗'), msg(res.error), res.errorLine ? lineBtn(res.errorLine) : null);
        if (res.trace) r.title = res.trace;
        log.append(...prints, r);
        if (res.errorLine) editor.mark(res.errorLine);
        return;
      }
      if (mode === 'run') {
        log.append(...prints);
        if (!prints.length) log.append(row('ok', mark('✓'), msg('Ran fine. Nothing printed.')));
        return;
      }
      const results = Array.isArray(res.results) ? res.results : [];
      if (!results.length) { log.append(row('muted', mark('∅'), msg('No tests found')), ...prints); return; }
      showTests(results, prints);
    }

    async function exec(mode) {
      if (closed || solved) return;
      if (busy) { if (mode === 'run') runner.cancel(); return; }
      setBusy(true);
      saveNow();
      log.replaceChildren();
      editor.mark(null);
      let res;
      try {
        // no tests at all (a content slip) never counts as solved: the worker answers [] ("No tests found")
        res = await runner.run(editor.value, mode === 'test' ? (typeof challenge.tests === 'string' ? challenge.tests : '') : undefined);
      } catch (err) {
        console.error(err);
        res = { offline: true };
      }
      setBusy(false);
      if (closed) return;
      show(res, mode);
      const results = res.results || [];
      if (mode === 'test' && !res.error && !res.timeout && !res.cancelled && !res.offline && results.length && results.every((t) => t.passed)) celebrate();
    }

    async function celebrate() {
      solved = true;
      clearTimeout(saveTimer);
      store.del(key);                          // a solved challenge leaves no draft (New Game starts clean)
      panel.classList.add('is-solved');
      editor.ta.readOnly = true;
      disarm();
      for (const b of [runKey, testKey, resetKey]) b.disabled = true;
      stage.append(h('div', { class: 'term-stamp', 'aria-hidden': 'true' }, icon('test'), h('b', { text: 'Solved!' })));
      paperConfetti(overlay);
      await Promise.race([wait(2100), new Promise((r) => overlay.addEventListener('pointerdown', r, { once: true }))]);
      finish(true);
    }

    // ↺ asks first: one press arms it ("Sure?", in the label's own spot, so the key keeps its width), a
    // second press within a few seconds resets
    let resetArmed = 0;
    function reset() {
      if (busy || solved) return;
      if (!resetArmed) {
        resetKey.classList.add('armed');
        showLabel(resetKey, 'Sure?');
        resetKey.title = 'Click again to reset';
        resetArmed = setTimeout(disarm, 3200);
        return;
      }
      disarm();
      editor.replaceAll(starter);
      saveNow();
      log.replaceChildren();
      editor.focusStart();
    }
    function disarm() {
      clearTimeout(resetArmed);
      if (!resetArmed) return;
      resetArmed = 0;
      resetKey.classList.remove('armed');
      showLabel(resetKey, 'Reset code');
      resetKey.title = RESET_TIP;
    }

    function finish(isSolved) {
      if (closed) return;
      closed = true;
      if (!isSolved) saveNow();
      disarm();
      if (runner.busy) runner.cancel();      // never leave a stuck program behind
      unsubscribe();
      clearTimeout(statusTimer);
      runner.release();
      window.removeEventListener('keydown', onKey);
      closeModal(overlay);
      overlay.classList.add('is-closing');
      setTimeout(() => overlay.remove(), 200);
      resolve({ solved: !!isSolved, code: editor.value });
    }

    runKey.addEventListener('click', () => exec('run'));
    testKey.addEventListener('click', () => exec('test'));
    resetKey.addEventListener('click', reset);
    closeKey.addEventListener('click', () => finish(solved));
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay && !solved) e.preventDefault(); });
    // Ctrl/Cmd+Enter tests (with Shift: runs), wherever the focus is
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter' || e.isComposing || topModal() !== overlay) return;
      e.preventDefault();
      if (!e.repeat) exec(e.shiftKey ? 'run' : 'test');
    };
    window.addEventListener('keydown', onKey);

    root.append(overlay);
    openModal(overlay, { onEscape: () => finish(solved) });
    runner.hold();
    runner.ensure();
    requestAnimationFrame(() => { editor.refresh(); editor.focusStart(); });
  });
}

export default { open, preload };
