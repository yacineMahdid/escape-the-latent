// The Pairing Net (CLIP island, c1). Line each caption tag up with its own photo,
// hang the right softmax floats (→ along rows, ↓ down columns), set the Tide Knob
// (the logit scale) where training starts and pin where it may never pass.
// Paper: CLIP, §2.3, Figure 3 and §2.5 (temperature init 0.07, clipped at 100).
import { createBoard, createDnd, h, s, injectCss } from './kit.js';

const CSS = `
.pn { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.pn-left { display: flex; flex-direction: column; gap: 10px; }
.pn-net {
  position: relative; display: grid; grid-template-columns: 74px repeat(4, 74px); grid-template-rows: 56px repeat(4, 66px);
  padding: 8px 40px 40px 8px; background: rgba(255, 253, 246, .35); border: 3px solid rgba(43, 34, 51, .25); border-radius: 16px;
}
.pn-slot { display: flex; align-items: center; justify-content: center; position: relative; }
.pn-slot::after { content: ''; position: absolute; left: 50%; top: 0; height: 8px; border-left: 2px solid #7a5a3a; }
.pn-tag { position: relative; z-index: 1; font-weight: 700; font-size: 14px; padding: 4px 8px; background: #fff7d6; transform: rotate(-2deg); }
.pn-photo { display: flex; align-items: center; justify-content: center; font-size: 34px; background: var(--paper); border: 3px solid var(--ink); border-radius: 10px; margin: 6px 8px 6px 0; box-shadow: 0 3px 0 rgba(43, 34, 51, .2); }
.pn-cell { position: relative; }
.pn-cell svg { width: 100%; height: 100%; display: block; overflow: visible; }
.pn-hook { position: absolute; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; }
.pn-hook-right { right: 4px; top: 64px; bottom: 40px; width: 32px; }
.pn-hook-bottom { left: 82px; right: 40px; bottom: 4px; height: 32px; }
.pn-float {
  width: 44px; height: 44px; border-radius: 50%; border: 3px solid var(--ink); background: #ff8f6b; color: #fff;
  font: 700 20px var(--font-ui); cursor: pointer; box-shadow: 0 3px 0 rgba(43, 34, 51, .3);
}
.pn-float.hung { background: #ff6b4a; box-shadow: 0 0 0 4px rgba(255, 255, 255, .7), 0 3px 0 rgba(43, 34, 51, .3); }
.pn-floatbox { display: flex; gap: 10px; align-items: center; padding: 6px 10px; border-radius: 12px; background: rgba(43, 34, 51, .08); min-height: 58px; }
.pn-right { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pn-dial { width: 210px; height: 210px; touch-action: none; user-select: none; cursor: grab; }
.pn-read { display: flex; align-items: center; gap: 4px; }
.pn-read button { font: 700 14px var(--font-ui); border: 2px solid var(--ink); background: var(--paper); border-radius: 8px; padding: 2px 8px; cursor: pointer; }
.pn-read input { width: 82px; text-align: center; font: 700 16px var(--font-ui); border: 3px solid var(--ink); border-radius: 10px; padding: 3px 4px; background: #fff; }
.pn-cushion { display: flex; align-items: center; gap: 8px; }
.pn-cush { width: 56px; height: 34px; border-radius: 50% 50% 40% 40%; background: #e8566a; border: 3px solid var(--ink); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.pn-pin { font-size: 22px; cursor: grab; touch-action: none; user-select: none; }
.pn-net.jerk { animation: pn-jerk .4s; }
@keyframes pn-jerk { 30% { transform: translateY(6px); } 60% { transform: translateY(-3px); } }
`;

function buildGrid(ranges) {
  const vals = [];
  for (const r of ranges) {
    const n = Math.round((r.to - r.from) / r.step);
    for (let k = 0; k <= n; k++) vals.push(Math.round((r.from + k * r.step) * 100) / 100);
  }
  return [...new Set(vals)].sort((a, b) => a - b);
}
const DEFAULT_RANGES = [{ from: 0.01, to: 0.99, step: 0.01 }, { from: 1, to: 19.9, step: 0.1 }, { from: 20, to: 199, step: 1 }, { from: 200, to: 1000, step: 10 }];
const fmt = (v) => `×${v < 1 ? v.toFixed(2) : v < 20 ? v.toFixed(1) : String(Math.round(v))}`;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function colorAt(p, stops) {
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i].p) {
      const a = stops[i - 1]; const b = stops[i]; const t = (p - a.p) / ((b.p - a.p) || 1);
      const ca = hex(a.color); const cb = hex(b.color);
      return `rgb(${ca.map((x, k) => Math.round(x + (cb[k] - x) * t)).join(',')})`;
    }
  }
  return stops[stops.length - 1].color;
}

export default {
  mount(container, spec = {}, api = {}) {
    injectCss('pz-pairing-net', CSS);
    const board = createBoard(container, spec, api, { theme: 'sea' });
    const photos = spec.photos || [];
    const captions = spec.captions || [];
    const capIndex = Object.fromEntries(captions.map((c, i) => [c.id, i]));
    const cosine = spec.cosine?.values || photos.map(() => captions.map(() => 0));
    const trained = spec.trainedCosine?.values || cosine;
    const stops = spec.beads?.colorStops || [{ p: 0, color: '#1f5f6b' }, { p: 0.5, color: '#3fd0c8' }, { p: 1, color: '#ffd35a' }];
    const grid = buildGrid(spec.valueGrid?.ranges || DEFAULT_RANGES);
    const sol = spec.solution || {};
    const n = photos.length;

    const order = (spec.initialCaptionOrder || captions.map((c) => c.id)).slice();
    const hung = new Set();
    const snap = (v) => {
      let best = 0; let bd = Infinity; const lv = Math.log(Math.max(1e-6, v));
      grid.forEach((g, i) => { const d = Math.abs(Math.log(g) - lv); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    let knob = snap(spec.knob?.initial ?? 1);
    let pin = spec.pin?.initial == null ? null : snap(spec.pin.initial);
    let anim = null; // { m, cos } while an animation runs
    let busy = false;

    // ---------- the net: photos (rows), caption slots (columns), beads ----------
    const net = h('div', { class: 'pn-net' });
    const dnd = createDnd(board.root, {
      sfx: board.sfx,
      onDrop(tag, slot) {
        const a = order.indexOf(tag.id); const b = slot.j;
        if (a === b) return;
        [order[a], order[b]] = [order[b], order[a]];
        placeTags(); changed();
      },
    });
    net.append(h('div'));
    const slots = []; const tags = {};
    for (let j = 0; j < n; j++) { const sl = dnd.target(h('div', { class: 'pn-slot', 'data-slot': String(j) }), { j }); slots.push(sl); net.append(sl); }
    captions.forEach((c) => { tags[c.id] = dnd.item(h('div', { class: 'pz-card pn-tag', 'data-tag': c.id, text: c.word }), { id: c.id }); });
    const cells = [];
    photos.forEach((ph, r) => {
      net.append(h('div', { class: 'pn-photo', title: ph.id, text: ph.icon }));
      const row = [];
      for (let j = 0; j < n; j++) {
        const svg = s('svg', { viewBox: '-33 -33 66 66' });
        s('line', { x1: -33, y1: 0, x2: 33, y2: 0, stroke: '#7a5a3a', 'stroke-width': 2 }, svg);
        s('line', { x1: 0, y1: -33, x2: 0, y2: 33, stroke: '#7a5a3a', 'stroke-width': 2 }, svg);
        const left = s('path', { stroke: '#2b2233', 'stroke-width': 2 }, svg);
        const right = s('path', { stroke: '#2b2233', 'stroke-width': 2 }, svg);
        const whole = s('circle', { cx: 0, cy: 0, stroke: '#2b2233', 'stroke-width': 2 }, svg);
        const title = s('title', {}, svg);
        const cell = h('div', { class: 'pn-cell', 'data-r': String(r), 'data-j': String(j) }, [svg]);
        row.push({ left, right, whole, title });
        net.append(cell);
      }
      cells.push(row);
    });
    const hookRight = h('div', { class: 'pn-hook pn-hook-right' });
    const hookBottom = h('div', { class: 'pn-hook pn-hook-bottom' });
    net.append(hookRight, hookBottom);
    function placeTags() { order.forEach((id, j) => slots[j].append(tags[id])); }

    // ---------- floats ----------
    const floatBox = h('div', { class: 'pn-floatbox', title: 'Floats' });
    const floats = (spec.floats || [{ id: 'rows', icon: '→' }, { id: 'cols', icon: '↓' }]).map((f) => {
      const b = h('button', { class: 'pn-float', 'data-float': f.id, title: f.title || f.id, text: f.icon });
      b.addEventListener('click', () => {
        if (busy) return;
        if (hung.has(f.id)) hung.delete(f.id); else hung.add(f.id);
        board.sfx(hung.has(f.id) ? 'pop' : 'paper');
        placeFloats(); changed();
      });
      return { def: f, el: b };
    });
    function placeFloats() {
      floats.forEach(({ def, el }) => {
        el.classList.toggle('hung', hung.has(def.id));
        if (!hung.has(def.id)) floatBox.append(el);
        else (def.id === 'cols' || def.icon === '↓' ? hookBottom : hookRight).append(el);
      });
    }

    // ---------- the Tide Knob and the pin ----------
    const dial = s('svg', { class: 'pn-dial', viewBox: '-117 -117 234 234' });
    s('circle', { r: 100, fill: '#fffdf6', stroke: '#2b2233', 'stroke-width': 4 }, dial);
    s('circle', { r: 84, fill: '#bfeee9', stroke: '#2b2233', 'stroke-width': 2, 'stroke-dasharray': '4 5' }, dial);
    const angleOf = (v) => -135 + (270 * (Math.log10(v) + 2)) / 5;
    const polar = (deg, rad) => { const a = (deg * Math.PI) / 180; return [Math.sin(a) * rad, -Math.cos(a) * rad]; };
    [0.01, 0.1, 1, 10, 100, 1000].forEach((v) => {
      const [x1, y1] = polar(angleOf(v), 84); const [x2, y2] = polar(angleOf(v), 98);
      s('line', { x1, y1, x2, y2, stroke: '#2b2233', 'stroke-width': 3 }, dial);
      const [tx, ty] = polar(angleOf(v), 68);
      const t = s('text', { x: tx, y: ty + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#2b2233', 'font-family': 'Fredoka, sans-serif' }, dial);
      t.textContent = v < 1 ? String(v) : String(v);
    });
    const needle = s('line', { x1: 0, y1: 0, x2: 0, y2: -78, stroke: '#2b2233', 'stroke-width': 6, 'stroke-linecap': 'round' }, dial);
    s('circle', { r: 12, fill: '#ff8f6b', stroke: '#2b2233', 'stroke-width': 3 }, dial);
    const pinMark = s('g', { class: 'pn-pin-mark', style: 'cursor:grab' }, dial);
    s('line', { x1: 0, y1: -86, x2: 0, y2: -104, stroke: '#2b2233', 'stroke-width': 3 }, pinMark);
    s('circle', { cx: 0, cy: -106, r: 7, fill: '#e8566a', stroke: '#2b2233', 'stroke-width': 2 }, pinMark);

    const readout = (onStep, onSet, label) => {
      const input = h('input', { 'aria-label': label, title: label });
      const left = h('button', { text: '◀', title: 'Step down' }); const right = h('button', { text: '▶', title: 'Step up' });
      left.addEventListener('click', () => onStep(-1)); right.addEventListener('click', () => onStep(1));
      const commit = () => { const v = parseFloat(String(input.value).replace(/[^0-9.]/g, '')); if (Number.isFinite(v) && v > 0) onSet(snap(v)); else refreshReadouts(); };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { commit(); input.blur(); } });
      input.addEventListener('change', commit);
      return { el: h('div', { class: 'pn-read' }, [left, input, right]), input };
    };
    const knobRead = readout((d) => setKnob(knob + d), (i) => setKnob(i), 'Tide Knob');
    const pinRead = readout((d) => { if (pin != null) setPin(pin + d); }, (i) => setPin(i), 'Pin');
    const pinEl = h('span', { class: 'pn-pin', title: 'Drag the pin onto the dial', text: '📌' });
    const cushion = h('div', { class: 'pn-cush', title: 'Pin cushion' }, [pinEl]);
    function setKnob(i) { if (busy) return; const ni = Math.max(0, Math.min(grid.length - 1, i)); if (ni !== knob) { knob = ni; board.sfx('tick'); } changed(); }
    function setPin(i) { if (busy) return; pin = i == null ? null : Math.max(0, Math.min(grid.length - 1, i)); board.sfx('pin'); changed(); }

    const dialValueAt = (e) => {
      const r = dial.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
      let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      deg = Math.max(-135, Math.min(135, deg));
      return { idx: snap(10 ** (((deg + 135) / 270) * 5 - 2)), dist: Math.hypot(dx, dy) / (r.width / 2) };
    };
    let dragging = null; // 'knob' | 'pin'
    dial.addEventListener('wheel', (e) => { e.preventDefault(); setKnob(knob + (e.deltaY > 0 ? -1 : 1)); }, { passive: false });
    dial.addEventListener('pointerdown', (e) => {
      if (busy) return;
      e.preventDefault();
      dragging = e.target.closest?.('.pn-pin-mark') ? 'pin' : 'knob';
      if (dragging === 'knob') setKnob(dialValueAt(e).idx);
    });
    pinEl.addEventListener('pointerdown', (e) => { if (busy) return; e.preventDefault(); dragging = 'pin'; pinEl.style.opacity = '.4'; });
    const onMove = (e) => {
      if (!dragging) return;
      const { idx } = dialValueAt(e);
      if (dragging === 'knob') setKnob(idx);
      else if (overDial(e)) { pin = idx; changed(); }
    };
    const overDial = (e) => { const r = dial.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
    const onUp = (e) => {
      if (dragging === 'pin') {
        pinEl.style.opacity = '';
        if (overDial(e)) setPin(dialValueAt(e).idx);
        else if (pin != null && cushion.contains(document.elementFromPoint(e.clientX, e.clientY))) setPin(null);
      }
      dragging = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cushion.addEventListener('click', () => { if (pin != null && !busy) setPin(null); });

    const right = h('div', { class: 'pn-right' }, [
      h('div', { class: 'pz-label', text: 'Tide Knob' }), dial, knobRead.el,
      h('div', { class: 'pn-cushion' }, [cushion, pinRead.el]),
    ]);
    board.body.append(h('div', { class: 'pn' }, [h('div', { class: 'pn-left' }, [net, floatBox]), right]));

    // ---------- live beads ----------
    function compute(m, cos) {
      const logit = photos.map((_, r) => order.map((cid) => m * cos[r][capIndex[cid]]));
      const rowP = logit.map((row) => { const mx = Math.max(...row); const e = row.map((v) => Math.exp(v - mx)); const z = e.reduce((a, b) => a + b, 0); return e.map((v) => v / z); });
      const colP = logit.map((row) => row.slice());
      for (let j = 0; j < n; j++) {
        const col = logit.map((row) => row[j]); const mx = Math.max(...col);
        const e = col.map((v) => Math.exp(v - mx)); const z = e.reduce((a, b) => a + b, 0);
        e.forEach((v, r) => { colP[r][j] = v / z; });
      }
      return { rowP, colP };
    }
    const half = (rad, side) => `M0,${-rad} A${rad},${rad} 0 0 ${side === 'left' ? 0 : 1} 0,${rad} Z`;
    function drawBeads() {
      const m = anim ? anim.m : grid[knob];
      const cos = anim ? anim.cos : cosine;
      const { rowP, colP } = compute(m, cos);
      const R = 26; const rows = hung.has('rows'); const cols = hung.has('cols');
      cells.forEach((row, r) => row.forEach((c, j) => {
        const raw = cos[r][capIndex[order[j]]];
        c.left.setAttribute('d', ''); c.right.setAttribute('d', ''); c.whole.setAttribute('r', 0);
        if (!rows && !cols) {
          c.whole.setAttribute('r', R * (0.35 + 0.65 * Math.max(0, raw))); c.whole.setAttribute('fill', '#b9b2c6');
          c.title.textContent = '';
        } else if (rows && cols) {
          c.left.setAttribute('d', half(R * (0.35 + 0.65 * rowP[r][j]), 'left')); c.left.setAttribute('fill', colorAt(rowP[r][j], stops));
          c.right.setAttribute('d', half(R * (0.35 + 0.65 * colP[r][j]), 'right')); c.right.setAttribute('fill', colorAt(colP[r][j], stops));
          c.title.textContent = `→ ${rowP[r][j].toFixed(2)} · ↓ ${colP[r][j].toFixed(2)}`;
        } else {
          const p = rows ? rowP[r][j] : colP[r][j];
          c.whole.setAttribute('r', R * (0.35 + 0.65 * p)); c.whole.setAttribute('fill', colorAt(p, stops));
          c.title.textContent = `${rows ? '→' : '↓'} ${p.toFixed(2)}`;
        }
      }));
    }
    function refreshReadouts() {
      const m = anim ? anim.m : grid[knob];
      needle.setAttribute('transform', `rotate(${angleOf(m)})`);
      if (document.activeElement !== knobRead.input) knobRead.input.value = fmt(anim ? m : grid[knob]);
      pinMark.style.display = pin == null ? 'none' : '';
      if (pin != null) pinMark.setAttribute('transform', `rotate(${angleOf(grid[pin])})`);
      pinEl.style.visibility = pin == null ? 'visible' : 'hidden';
      if (document.activeElement !== pinRead.input) pinRead.input.value = pin == null ? '–' : `📌 ${fmt(grid[pin])}`;
    }
    function changed() { drawBeads(); refreshReadouts(); }

    placeTags(); placeFloats(); changed();

    // ---------- 🎣 Haul ----------
    const animate = (ms, step) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now) => { const u = Math.min(1, (now - t0) / ms); step(u); if (u < 1) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    async function haul() {
      if (busy) return;
      const m = grid[knob];
      const wrong = [];
      if (sol.captionOrder && order.some((id, j) => id !== sol.captionOrder[j])) wrong.push('lineup');
      const wantFloats = sol.floats || ['rows', 'cols'];
      if (hung.size !== wantFloats.length || wantFloats.some((f) => !hung.has(f))) wrong.push('floats');
      if (sol.start != null && Math.abs(m - sol.start) > (sol.startTolerance ?? 0.15)) wrong.push('start');
      if (pin == null) wrong.push('pinMissing');
      else if (sol.pin != null && Math.abs(grid[pin] - sol.pin) > (sol.pinTolerance ?? 0)) wrong.push('pinWrong');
      busy = true;
      if (!wrong.length) {
        const start = m; const end = grid[pin];
        await animate(2500, (u) => {
          anim = { m: start * (end / start) ** u, cos: cosine.map((row, r) => row.map((v, c) => (1 - u * u) * v + u * u * trained[r][c])) };
          changed();
        });
        board.sfx('ding');
        board.solve();
        return;
      }
      if (pin == null) {
        // runaway: nothing stops the knob
        const start = m;
        await animate(1200, (u) => { anim = { m: start * (1000 / start) ** u, cos: cosine }; changed(); });
        board.sfx('stamp');
        await new Promise((r) => setTimeout(r, 600));
        anim = null; changed();
      } else {
        net.classList.remove('jerk'); void net.offsetWidth; net.classList.add('jerk');
      }
      busy = false;
      board.fail(wrong);
    }
    board.button('🎣 Haul', haul, { primary: true });

    container.__state = () => ({ order: order.slice(), floats: [...hung], knob: grid[knob], pin: pin == null ? null : grid[pin] });
    return {
      destroy() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        dnd.destroy(); board.destroy();
      },
    };
  },
};
