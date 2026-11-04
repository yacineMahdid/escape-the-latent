// The Wave Loom (Attendale, c1). Each lantern string has a face (SIN/COS) and a
// slowness dial; lantern j on house pos glows with FACE_j(pos / divisor_j).
// Tune the strings so every house gets its own wave, choose how the plates join
// the word-coats, then ring the Bell. Paper: "Attention Is All You Need", §3.5.
import { createBoard, h, injectCss } from './kit.js';

const CSS = `
.wl-layout { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.wl-grid {
  display: grid; grid-template-columns: 104px repeat(var(--wl-cols), 66px); gap: 4px 6px; align-items: center;
  padding: 8px 10px 10px; background: rgba(255, 253, 246, .4); border: 3px solid rgba(43, 34, 51, .25); border-radius: 14px;
}
.wl-colhead { text-align: center; }
.wl-house {
  display: flex; gap: 6px; align-items: baseline; padding: 2px 8px; font-size: 14px;
  background: var(--paper); border: 2px solid var(--ink); border-radius: 8px; box-shadow: 0 2px 0 rgba(43, 34, 51, .2);
}
.wl-house b { font-size: 12px; opacity: .55; }
.wl-cell { position: relative; display: flex; justify-content: center; }
.wl-cell.wl-str::before {
  content: ''; position: absolute; left: 50%; top: -5px; bottom: -5px; border-left: 2px dashed rgba(43, 34, 51, .35);
}
.wl-lantern {
  position: relative; width: 30px; height: 30px; border-radius: 50%; border: 3px solid var(--ink);
  box-shadow: 0 0 10px 1px var(--glow, transparent); transition: background .25s, box-shadow .25s;
}
.wl-face {
  position: relative; width: 56px; padding: 4px 0; font: 700 13px var(--font-ui); color: var(--ink); cursor: pointer;
  background: #cfe8ff; border: 3px solid var(--ink); border-radius: 8px; box-shadow: 0 2px 0 rgba(43, 34, 51, .3);
}
.wl-face.is-sin { background: #ffd0e4; }
.wl-face:active { transform: translateY(1px); }
.wl-dial {
  position: relative; display: flex; align-items: center; background: var(--paper);
  border: 2px solid var(--ink); border-radius: 8px; box-shadow: 0 2px 0 rgba(43, 34, 51, .2);
}
.wl-arrow { border: 0; background: none; cursor: pointer; font-size: 11px; padding: 5px 2px; color: var(--ink); }
.wl-arrow:hover { color: #c2185b; }
.wl-dial-val { min-width: 36px; text-align: center; font: 600 11px var(--font-ui); }
.wl-rowlabel { text-align: right; padding-right: 4px; }
.wl-chip { justify-self: start; font: 700 12px var(--font-code); padding: 2px 6px; border-radius: 6px; background: #2b2233; color: #ffe9a8; white-space: nowrap; }
.wl-join { width: 300px; display: flex; flex-direction: column; gap: 8px; transform: rotate(.8deg); }
.wl-join-q { font-weight: 600; font-size: 16px; }
.wl-join-opt {
  display: flex; gap: 8px; align-items: flex-start; text-align: left; font: 15px var(--font-ui); color: var(--ink);
  background: #fff; border: 2px solid var(--ink); border-radius: 10px; padding: 6px 10px; cursor: pointer;
}
.wl-join-opt:hover { background: #fffaf0; }
.wl-join-opt.on { background: #fff3c4; }
.wl-radio { width: 16px; height: 16px; flex: none; margin-top: 2px; border-radius: 50%; border: 2px solid var(--ink); background: #fff; }
.wl-join-opt.on .wl-radio { background: var(--pink); }
.wl-win .wl-lantern { animation: wl-pulse .9s ease-in-out infinite alternate; }
@keyframes wl-pulse { to { box-shadow: 0 0 18px 6px #ffd35a; } }
@media (max-width: 760px) {
  .wl-grid { grid-template-columns: 70px repeat(var(--wl-cols), 40px); gap: 3px; }
  .wl-lantern { width: 22px; height: 22px; }
  .wl-face { width: 38px; font-size: 10px; }
  .wl-dial-val { min-width: 22px; font-size: 9px; }
  .wl-join { width: 100%; transform: none; }
}
`;

const DEFAULT_STOPS = [{ value: -1, color: '#4b3f9e' }, { value: 0, color: '#fffdf6' }, { value: 1, color: '#ffd35a' }];
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function colorAt(v, stops) {
  const st = stops.slice().sort((a, b) => a.value - b.value);
  if (v <= st[0].value) return st[0].color;
  for (let i = 1; i < st.length; i++) {
    if (v <= st[i].value) {
      const a = st[i - 1]; const b = st[i];
      const t = (v - a.value) / ((b.value - a.value) || 1);
      const ca = rgb(a.color); const cb = rgb(b.color);
      return `rgb(${ca.map((x, k) => Math.round(x + (cb[k] - x) * t)).join(',')})`;
    }
  }
  return st[st.length - 1].color;
}

export default {
  mount(container, spec = {}, api = {}) {
    injectCss('pz-wave-loom', CSS);
    const board = createBoard(container, spec, api, { theme: 'cork' });
    const dModel = spec.dModel ?? 8;
    const base = spec.base ?? 10000;
    const houses = spec.houses ?? Array.from({ length: 8 }, (_, i) => ({ pos: i, word: '' }));
    const cols = spec.lanterns ?? Array.from({ length: dModel }, (_, j) => j);
    const opts = spec.slownessOptions ?? Array.from({ length: dModel + 1 }, (_, m) => {
      const d = base ** (m / dModel); return { m, divisor: d, label: String(+d.toPrecision(4)) };
    });
    const stops = spec.colorScale?.stops ?? DEFAULT_STOPS;
    const sol = spec.solution || {};
    const faces = (spec.initial?.faces ?? cols.map(() => 'cos')).slice();
    const ms = (spec.initial?.m ?? cols.map(() => opts[opts.length - 1].m)).slice();
    let join = spec.initial?.join ?? null;

    const optIndex = (m) => Math.max(0, opts.findIndex((o) => o.m === m));
    const divisor = (k) => { const o = opts[optIndex(ms[k])]; return o.divisor ?? base ** (o.m / dModel); };
    const value = (pos, k) => (faces[k] === 'sin' ? Math.sin : Math.cos)(pos / divisor(k));

    // the lantern plates: one row per house, one column (string) per lantern
    const grid = h('div', { class: 'wl-grid', style: { '--wl-cols': cols.length } });
    grid.append(h('div', { class: 'wl-chip', title: 'lanterns per plate', text: spec.dModelChip || `d_model = ${dModel}` }));
    cols.forEach((j) => grid.append(h('div', { class: 'pz-label wl-colhead', text: String(j), title: `Lantern ${j}` })));
    const cells = houses.map((hs) => {
      grid.append(h('div', { class: 'wl-house' }, [h('b', { text: String(hs.pos) }), h('span', { text: hs.word })]));
      return cols.map(() => {
        const lantern = h('div', { class: 'wl-lantern' });
        grid.append(h('div', { class: 'wl-cell wl-str' }, [lantern]));
        return lantern;
      });
    });

    grid.append(h('div', { class: 'pz-label wl-rowlabel', text: 'face' }));
    const faceBtns = cols.map((j, k) => {
      const b = h('button', { class: 'wl-face', title: 'Flip SIN / COS' });
      b.addEventListener('click', () => { faces[k] = faces[k] === 'sin' ? 'cos' : 'sin'; board.sfx('paper'); refresh(); });
      grid.append(h('div', { class: 'wl-cell wl-str' }, [b]));
      return b;
    });

    grid.append(h('div', { class: 'pz-label wl-rowlabel', text: 'slowness' }));
    const dialVals = cols.map((j, k) => {
      const val = h('span', { class: 'wl-dial-val' });
      const step = (d) => {
        const i = optIndex(ms[k]); const ni = Math.max(0, Math.min(opts.length - 1, i + d));
        if (ni !== i) { ms[k] = opts[ni].m; board.sfx('tick'); refresh(); }
      };
      const left = h('button', { class: 'wl-arrow', title: 'Faster', 'aria-label': `Lantern ${j} faster`, text: '◀' });
      const right = h('button', { class: 'wl-arrow', title: 'Slower', 'aria-label': `Lantern ${j} slower`, text: '▶' });
      left.addEventListener('click', () => step(-1));
      right.addEventListener('click', () => step(1));
      const dial = h('div', { class: 'wl-dial', 'data-col': String(k) }, [left, val, right]);
      dial.addEventListener('wheel', (e) => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
      grid.append(h('div', { class: 'wl-cell' }, [dial]));
      return val;
    });

    // how the plates join each villager's word-coat
    const joinCard = h('div', { class: 'pz-card wl-join' }, [h('div', { class: 'wl-join-q', text: spec.joinQuestion || 'Plates onto word-coats:' })]);
    const tools = spec.joinTools || spec.joinOptions || [{ id: 'add', label: 'Add' }, { id: 'concat', label: 'Concatenate' }];
    const joinBtns = tools.map((o) => {
      const b = h('button', { class: 'wl-join-opt', 'data-join': o.id, title: o.title || '' }, [h('span', { class: 'wl-radio' }), h('span', { text: [o.icon, o.label].filter(Boolean).join(' ') })]);
      b.addEventListener('click', () => { join = o.id; board.sfx('pin'); refresh(); });
      joinCard.append(b);
      return b;
    });

    board.body.append(h('div', { class: 'wl-layout' }, [grid, joinCard]));

    function refresh() {
      houses.forEach((hs, r) => cols.forEach((j, k) => {
        const v = value(hs.pos, k); const c = colorAt(v, stops); const el = cells[r][k];
        el.style.background = c; el.style.setProperty('--glow', c); el.title = v.toFixed(2);
      }));
      faceBtns.forEach((b, k) => { b.textContent = spec.faceLabels?.[faces[k]] || faces[k].toUpperCase(); b.classList.toggle('is-sin', faces[k] === 'sin'); });
      dialVals.forEach((val, k) => { val.textContent = opts[optIndex(ms[k])].label; });
      joinBtns.forEach((b) => b.classList.toggle('on', b.dataset.join === join));
    }
    refresh();

    board.button('🔔 Ring the Bell', () => {
      const wrong = [];
      if (!join) wrong.push('joinMissing');
      else if (sol.join && join !== sol.join) wrong.push('join');
      if (sol.faces && faces.some((f, k) => f !== sol.faces[k])) wrong.push('faces');
      if (sol.m && ms.some((m, k) => m !== sol.m[k])) wrong.push('slowness');
      if (wrong.length) { board.fail(wrong); return; }
      board.sfx('ding');
      grid.classList.add('wl-win');
      board.solve();
    }, { primary: true });

    // test hook: current state (never the solution)
    container.__state = () => ({ faces: faces.slice(), m: ms.slice(), join });
    return { destroy() { board.destroy(); } };
  },
};
