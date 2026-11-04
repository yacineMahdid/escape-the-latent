// The Vertebra Jig (Mamba desert, c2). Rebuild one vertebra of the Endless Road
// snake: drag bones (Linear, Conv, σ, SSM, ⊗, ⊕, MHA, MLP) into the jig's two lanes,
// the join and the top, and set the expansion E so two vertebrae weigh the same as
// one Transformer layer (MHA + MLP). Paper: Mamba, Figure 3 and §3.4.
import { createBoard, createDnd, h, s, injectCss, withPhrases } from './kit.js';

const CSS = `
.vj { display: flex; gap: 20px; align-items: stretch; flex-wrap: wrap; justify-content: center; }
.vj-jig { position: relative; width: 420px; height: 430px; flex: none; border-radius: 18px; background: rgba(255, 253, 246, .45); border: 3px solid rgba(43, 34, 51, .2); }
.vj-jig svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.vj-slot { position: absolute; width: var(--lane, 96px); height: 40px; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; background: rgba(255, 253, 246, .85); transition: width .25s; }
.vj-tile { display: flex; align-items: center; justify-content: center; min-width: 46px; height: 34px; padding: 0 10px; font: 700 15px var(--font-ui); color: var(--ink); border: 3px solid var(--ink); box-shadow: 0 2px 0 rgba(43, 34, 51, .25); background: #fff; }
.vj-trapezoid { background: #8fd47a; clip-path: polygon(10% 0, 90% 0, 100% 100%, 0 100%); border: 0; box-shadow: none; padding: 0 16px; }
.vj-round { min-width: 36px; width: 36px; height: 36px; padding: 0; border-radius: 50%; background: #ffe39a; }
.vj-box { border-radius: 9px; background: #a9cfff; }
.vj-tray { display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; width: 220px; padding: 10px; border-radius: 14px; background: rgba(43, 34, 51, .08); }
.vj-side { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.vj-scale { width: 250px; height: 170px; }
.vj-e { display: flex; align-items: center; gap: 4px; font: 700 18px var(--font-ui); }
.vj-e button { font: 700 14px var(--font-ui); border: 2px solid var(--ink); background: var(--paper); border-radius: 8px; padding: 3px 9px; cursor: pointer; }
.vj-e span { min-width: 64px; text-align: center; padding: 3px 8px; background: var(--paper); border: 3px solid var(--ink); border-radius: 10px; }
.vj-jig.rattle { animation: vj-rattle .4s; }
@keyframes vj-rattle { 25% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } 75% { transform: rotate(-1deg); } }
.vj-win .vj-slot { animation: vj-click .4s ease-out both; }
@keyframes vj-click { 50% { transform: translate(-50%, -50%) scale(1.12); } }
`;

// slot centres in the jig (px), long lane left, short lane right, join and top in the middle
const POS = {
  long1: [120, 330], long2: [120, 262], long3: [120, 194], long4: [120, 126],
  short1: [300, 296], short2: [300, 194],
  join: [210, 74], top: [210, 26],
};
const PHRASES = { empty: 'a slot is still empty', bones: 'some bones are wrong', tilt: 'the beam is not level' };

export default {
  mount(container, rawSpec = {}, api = {}) {
    injectCss('pz-vertebra-jig', CSS);
    const spec = withPhrases(rawSpec, PHRASES);
    const board = createBoard(container, spec, api, { theme: 'cork' });
    const tiles = spec.tiles || [];
    const tileById = Object.fromEntries(tiles.map((t) => [t.id, t]));
    const slots = spec.slots || Object.keys(POS).map((id) => ({ id }));
    const weights = spec.weights || {};
    const Eopts = spec.expansion?.options || [1, 2, 3, 4];
    let E = spec.expansion?.initial ?? Eopts[0];
    const filled = Object.fromEntries(slots.map((sl) => [sl.id, null]));
    const sol = spec.solution || {};

    const tileEl = (t) => h('div', { class: `vj-tile vj-${t.shape || 'box'}`, title: t.label, text: t.label });

    // ---------- the jig ----------
    const jig = h('div', { class: 'vj-jig' });
    const svg = s('svg', { viewBox: '0 0 420 430' });
    const line = (pts) => s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#7a5a3a', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '2 9' }, svg);
    line([[210, 420], [210, 380], [120, 380], [120, 74], [210, 74]]);
    line([[210, 380], [300, 380], [300, 74], [210, 74]]);
    line([[210, 74], [210, 6]]);
    s('path', { d: 'M200 418 L210 404 L220 418', fill: '#7a5a3a' }, svg);
    s('path', { d: 'M200 12 L210 -2 L220 12', fill: '#7a5a3a' }, svg);
    jig.append(svg);
    const slotEls = {};
    const dnd = createDnd(board.root, {
      sfx: board.sfx,
      onDrop(item, target) {
        if (target.slot) {
          filled[target.slot] = item.tile;
          if (item.from && item.from !== target.slot) filled[item.from] = null;
        } else if (item.from) filled[item.from] = null; // dropped back on the tray
        changed();
      },
    });
    slots.forEach((sl) => {
      const [x, y] = POS[sl.id] || [210, 210];
      const el = dnd.target(h('div', { class: 'pz-slot vj-slot', 'data-slot': sl.id, style: { left: `${x}px`, top: `${y}px` } }), { slot: sl.id });
      slotEls[sl.id] = el;
      jig.append(el);
    });

    // ---------- the tray (unlimited copies) ----------
    const tray = dnd.target(h('div', { class: 'vj-tray', title: 'Bones' }), { slot: null });
    tiles.forEach((t) => { const el = tileEl(t); el.setAttribute('data-tile', t.id); tray.append(dnd.item(el, { tile: t.id, from: null })); });

    // ---------- the balance and E ----------
    const scale = s('svg', { class: 'vj-scale', viewBox: '0 0 250 170' });
    s('path', { d: 'M110 160 L140 160 L125 60 Z', fill: '#b98552', stroke: '#2b2233', 'stroke-width': 3 }, scale);
    const beam = s('g', {}, scale);
    s('line', { x1: 25, y1: 60, x2: 225, y2: 60, stroke: '#2b2233', 'stroke-width': 6, 'stroke-linecap': 'round' }, beam);
    const pan = (x) => {
      const g = s('g', {}, beam);
      s('line', { x1: x, y1: 60, x2: x, y2: 92, stroke: '#2b2233', 'stroke-width': 2 }, g);
      s('path', { d: `M${x - 34} 92 Q${x} 116 ${x + 34} 92 Z`, fill: '#ffe39a', stroke: '#2b2233', 'stroke-width': 3 }, g);
      const t1 = s('text', { x, y: 50, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#2b2233', 'font-family': 'Fredoka, sans-serif' }, g);
      const t2 = s('text', { x, y: 132, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: '#2b2233', 'font-family': 'Fredoka, sans-serif' }, g);
      return { g, t1, t2, x };
    };
    const leftPan = pan(45); const rightPan = pan(205);
    s('circle', { cx: 125, cy: 60, r: 7, fill: '#e8566a', stroke: '#2b2233', 'stroke-width': 3 }, scale);
    leftPan.t1.textContent = `${spec.scale?.left?.count ?? 2} × 🦴`;
    rightPan.t1.textContent = spec.scale?.right?.label || 'MHA+MLP';
    // Kayvee's overflowing letter cart sits in the right pan
    const cart = s('g', { transform: `translate(${rightPan.x - 22} 52)` }, rightPan.g);
    s('rect', { x: 0, y: 14, width: 44, height: 20, rx: 4, fill: '#d9a441', stroke: '#2b2233', 'stroke-width': 2 }, cart);
    [[4, 4], [16, 0], [28, 5]].forEach(([x, y]) => { s('rect', { x, y, width: 14, height: 10, fill: '#fffdf6', stroke: '#2b2233', 'stroke-width': 1.5 }, cart); s('path', { d: `M${x} ${y} L${x + 7} ${y + 6} L${x + 14} ${y}`, fill: 'none', stroke: '#2b2233', 'stroke-width': 1.2 }, cart); });
    s('circle', { cx: 10, cy: 36, r: 4, fill: '#2b2233' }, cart); s('circle', { cx: 34, cy: 36, r: 4, fill: '#2b2233' }, cart);
    if (spec.scale?.right?.look) cart.append(Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'title'), { textContent: spec.scale.right.look }));
    const rightValue = spec.scale?.right?.value ?? 12;
    rightPan.t2.textContent = `${rightValue} D²`;
    const eVal = h('span');
    const eLeft = h('button', { text: '◀', title: 'smaller E' }); const eRight = h('button', { text: '▶', title: 'bigger E' });
    const stepE = (d) => { const i = Eopts.indexOf(E); const ni = Math.max(0, Math.min(Eopts.length - 1, i + d)); if (Eopts[ni] !== E) { E = Eopts[ni]; board.sfx('tick'); changed(); } };
    eLeft.addEventListener('click', () => stepE(-1)); eRight.addEventListener('click', () => stepE(1));
    const eBox = h('div', { class: 'vj-e', title: 'expand' }, [eLeft, eVal, eRight]);

    board.body.append(h('div', { class: 'vj' }, [tray, jig, h('div', { class: 'vj-side' }, [scale, eBox])]));

    const weightOf = (tileId) => { const w = weights[tileId]; return w === 'E' ? E : Number(w) || 0; };
    function changed() {
      // slots
      for (const sl of slots) {
        const el = slotEls[sl.id]; el.replaceChildren();
        const t = filled[sl.id] && tileById[filled[sl.id]];
        if (t) {
          const te = dnd.item(tileEl(t), { tile: t.id, from: sl.id });
          te.setAttribute('data-placed', t.id);
          te.addEventListener('contextmenu', (e) => { e.preventDefault(); filled[sl.id] = null; board.sfx('paper'); changed(); });
          el.append(te);
        }
      }
      jig.style.setProperty('--lane', `${84 + E * 8}px`);
      // balance
      const w = slots.reduce((a, sl) => a + (filled[sl.id] ? weightOf(filled[sl.id]) : 0), 0);
      const left = (spec.scale?.left?.count ?? 2) * w;
      leftPan.t2.textContent = `${left} D²`;
      const tilt = Math.max(-16, Math.min(16, (rightValue - left) * 1.6));
      beam.setAttribute('transform', `rotate(${tilt} 125 60)`);
      [leftPan, rightPan].forEach((p) => p.g.setAttribute('transform', `rotate(${-tilt} ${p.x} 60)`));
      eVal.textContent = `${spec.expansion?.label || 'E'} = ${E}`;
      return { left };
    }

    board.button('🔨 Snap', () => {
      const { left } = changed();
      const wrong = [];
      if (slots.some((sl) => !filled[sl.id])) wrong.push('empty');
      if (slots.some((sl) => filled[sl.id] && sol[sl.id] && filled[sl.id] !== sol[sl.id])) wrong.push('bones');
      if (left !== rightValue) wrong.push('tilt');
      if (wrong.length) {
        jig.classList.remove('rattle'); void jig.offsetWidth; jig.classList.add('rattle');
        board.fail(wrong);
        return;
      }
      board.root.classList.add('vj-win');
      board.sfx('stamp');
      board.solve();
    }, { primary: true });
    changed();

    container.__state = () => ({ filled: { ...filled }, E });
    return { destroy() { dnd.destroy(); board.destroy(); } };
  },
};
