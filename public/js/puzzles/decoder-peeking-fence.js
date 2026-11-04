// The Peeking Fence (Attendale, c2). Five writers at five desks each write one word
// of the reply. Put the right card on each desk, then stamp the attention windows
// (iron fence = -inf, paper screen = 0) so no writer peeks at a word that has not
// been written yet. Live softmax weights show who is looking where.
// Paper: "Attention Is All You Need", §3.2.3 (masking) and Figure 2.
import { createBoard, createDnd, h, injectCss, interp } from './kit.js';

const CSS = `
.pf { display: flex; flex-direction: column; gap: 12px; }
.pf-strip { padding: 8px 10px; background: rgba(255, 253, 246, .4); border: 3px solid rgba(43, 34, 51, .22); border-radius: 14px; }
.pf-strip-title { margin-bottom: 6px; }
.pf-desks { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.pf-desk { width: 112px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.pf-desk-name { font-weight: 700; font-size: 14px; }
.pf-writes { font-size: 12px; padding: 1px 8px; background: #e6f4ff; border: 2px solid var(--ink); border-radius: 999px; white-space: nowrap; }
.pf-slot { width: 100px; height: 42px; display: flex; align-items: center; justify-content: center; background: #b98552; border-color: rgba(43, 34, 51, .55); }
.pf-top { display: flex; gap: 14px; flex-wrap: wrap; align-items: stretch; }
.pf-tray { flex: 1; min-width: 280px; display: flex; gap: 8px; flex-wrap: wrap; align-content: flex-start; min-height: 48px; padding: 6px; border-radius: 12px; background: rgba(43, 34, 51, .08); }
.pf-card { min-width: 84px; padding: 6px 8px; text-align: center; font-weight: 600; font-size: 15px; transform: rotate(-1deg); }
.pf-panels { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
.pf-grid { display: grid; gap: 4px; align-items: center; touch-action: none; user-select: none; }
.pf-colhead { font-size: 11px; font-weight: 600; text-align: center; line-height: 1.1; min-height: 26px; display: flex; align-items: flex-end; justify-content: center; word-break: break-word; }
.pf-rowhead { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.pf-win {
  position: relative; height: 30px; border: 2px solid var(--ink); border-radius: 6px; cursor: crosshair;
  background: var(--w, #3b3350); box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .25);
}
.pf-win.is-fence::after {
  content: ''; position: absolute; inset: 2px; border-radius: 3px;
  background: repeating-linear-gradient(90deg, #2b2233 0 3px, transparent 3px 8px), rgba(90, 80, 100, .45);
}
.pf-win.is-screen::after {
  content: '0'; position: absolute; inset: 3px; border-radius: 3px; display: flex; align-items: center; justify-content: center;
  font: 700 13px var(--font-ui); color: #8a7f96; background: rgba(255, 253, 246, .82);
}
.pf-row-fainted { color: #6b5f78; }
.pf-badges { display: flex; gap: 3px; flex-wrap: nowrap; overflow: hidden; }
.pf-badge { font-size: 11px; font-weight: 700; padding: 0 5px; cursor: help; border-radius: 999px; background: #ffd9de; color: #a01d35; border: 2px solid #a01d35; white-space: nowrap; }
.pf-stamps { display: flex; flex-direction: column; gap: 8px; align-items: stretch; padding-top: 4px; }
.pf-tool { font: 600 15px var(--font-ui); color: var(--ink); padding: 6px 14px; border: 3px solid var(--ink); border-radius: 12px; background: var(--paper); cursor: pointer; box-shadow: 0 3px 0 rgba(43, 34, 51, .25); }
.pf-tool.on { background: var(--gold); transform: translateY(-2px) rotate(-2deg); }
.pf-win-pop { animation: pf-pop .35s ease-out both; }
@keyframes pf-pop { from { transform: scale(.4); } to { transform: scale(1); } }
`;

const SHUTTER = [59, 51, 80];   // weight 0
const BRIGHT = [255, 233, 168]; // weight 1
const glow = (w) => {
  if (!Number.isFinite(w)) return 'rgb(31,26,41)';
  const t = Math.pow(Math.max(0, Math.min(1, w)), 0.6);
  return `rgb(${SHUTTER.map((a, k) => Math.round(a + (BRIGHT[k] - a) * t)).join(',')})`;
};

function softmaxRow(raw, stamps) {
  const s = raw.map((v, j) => (stamps[j] === 'fence' ? -Infinity : stamps[j] === 'screen' ? 0 : v));
  const mx = Math.max(...s);
  if (mx === -Infinity) return { fainted: true, w: s.map(() => NaN) };
  const e = s.map((v) => (v === -Infinity ? 0 : Math.exp(v - mx)));
  const z = e.reduce((a, b) => a + b, 0);
  return { fainted: false, w: e.map((v) => v / z) };
}

export default {
  mount(container, spec = {}, api = {}) {
    injectCss('pz-peeking-fence', CSS);
    const board = createBoard(container, spec, api, { theme: 'cork' });
    const writers = spec.writers || [];
    const n = writers.length || 5;
    const cards = spec.cards || [];
    const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
    const selfScores = spec.panels?.self?.scores || [];
    const crossScores = spec.panels?.cross?.scores || [];
    const village = spec.villageWords || [];
    const sol = spec.solution || {};
    const stampDefs = spec.stamps || [{ id: 'fence', label: 'fence' }, { id: 'screen', label: 'screen' }, { id: 'eraser', label: 'eraser' }];

    const desks = (spec.initial?.desks || Array(n).fill(null)).slice();
    const blank = (cols) => Array.from({ length: n }, () => Array(cols).fill(null));
    const selfStamps = Array.isArray(spec.initial?.selfStamps) ? spec.initial.selfStamps.map((r) => r.slice()) : blank(n);
    const crossStamps = Array.isArray(spec.initial?.crossStamps) ? spec.initial.crossStamps.map((r) => r.slice()) : blank(village.length);
    let tool = stampDefs[0]?.id || 'fence';

    // ---------- desks and cards ----------
    const dnd = createDnd(board.root, { sfx: board.sfx, onDrop: onCardDrop });
    const slots = [];
    const deskRow = h('div', { class: 'pf-desks' });
    writers.forEach((wr, j) => {
      const slot = dnd.target(h('div', { class: 'pz-slot pf-slot', 'data-desk': String(j) }), { desk: j });
      slots.push(slot);
      deskRow.append(h('div', { class: 'pf-desk' }, [
        h('div', { class: 'pf-desk-name', text: `Desk ${wr.desk ?? j + 1}` }),
        h('div', { class: 'pf-writes', text: `writes: ${wr.writes}` }),
        slot,
      ]));
    });
    const tray = dnd.target(h('div', { class: 'pf-tray', title: 'Card tray' }), { desk: null });
    const cardEls = {};
    cards.forEach((c) => { cardEls[c.id] = dnd.item(h('div', { class: 'pz-card pf-card', 'data-card': c.id, text: c.label }), { id: c.id }); });

    function placeCards() {
      slots.forEach((slot, j) => { const id = desks[j]; if (id && cardEls[id]) slot.append(cardEls[id]); });
      cards.forEach((c) => { if (!desks.includes(c.id)) tray.append(cardEls[c.id]); });
    }
    function onCardDrop(card, target) {
      const from = desks.indexOf(card.id);
      if (target.desk == null) { if (from >= 0) desks[from] = null; }
      else {
        const to = target.desk;
        if (from === to) return;
        const other = desks[to];
        desks[to] = card.id;
        if (from >= 0) desks[from] = other ?? null;
      }
      placeCards(); changed();
    }

    // ---------- the two window panels ----------
    const panelSelf = { scores: selfScores, stamps: selfStamps, cols: n, wins: [], rows: [], badges: [], heads: [], names: [] };
    const panelCross = { scores: crossScores, stamps: crossStamps, cols: village.length, wins: [], rows: [], badges: [], heads: [], names: [] };
    function buildPanel(p, colWidth, headTexts, headWidth) {
      // fixed label column: badges must never shift the windows under a paint stroke
      const grid = h('div', { class: 'pf-grid', style: { gridTemplateColumns: `${headWidth}px repeat(${p.cols}, ${colWidth}px)` } });
      grid.append(h('div'));
      for (let j = 0; j < p.cols; j++) { const hd = h('div', { class: 'pf-colhead', text: headTexts ? headTexts[j] : '' }); p.heads.push(hd); grid.append(hd); }
      for (let i = 0; i < n; i++) {
        const badges = h('div', { class: 'pf-badges' });
        const name = h('span', { text: `✎${i + 1}`, title: `Writer at desk ${i + 1}` });
        const rh = h('div', { class: 'pf-rowhead' }, [name, badges]);
        p.badges.push(badges); p.names.push(name);
        grid.append(rh);
        const row = [];
        for (let j = 0; j < p.cols; j++) {
          const w = h('div', { class: 'pf-win', 'data-i': String(i), 'data-j': String(j) });
          w.__panel = p;
          row.push(w); grid.append(w);
        }
        p.wins.push(row); p.rows.push(rh);
      }
      grid.addEventListener('pointerdown', (e) => {
        const win = e.target.closest('.pf-win'); if (!win) return;
        e.preventDefault(); painting = new Set(); last = { x: e.clientX, y: e.clientY }; paint(win);
      });
      return grid;
    }
    let painting = null;
    function paint(win) {
      if (!painting || painting.has(win)) return;
      painting.add(win);
      const p = win.__panel; const i = +win.dataset.i; const j = +win.dataset.j;
      const next = tool === 'eraser' ? null : tool;
      if (p.stamps[i][j] === next) return;
      p.stamps[i][j] = next;
      board.sfx(next ? 'stamp' : 'paper');
      changed();
    }
    // fast strokes: browsers merge pointer moves, so walk the segment between samples
    let last = null;
    const hit = (x, y) => { const el = document.elementFromPoint(x, y)?.closest?.('.pf-win'); if (el && board.root.contains(el)) paint(el); };
    const onMove = (e) => {
      if (!painting) return;
      const samples = e.getCoalescedEvents?.() || [];
      for (const pe of (samples.length ? samples : [e])) {
        const x = pe.clientX; const y = pe.clientY;
        if (last) {
          const steps = Math.max(1, Math.ceil(Math.hypot(x - last.x, y - last.y) / 8));
          for (let k = 1; k <= steps; k++) hit(last.x + ((x - last.x) * k) / steps, last.y + ((y - last.y) * k) / steps);
        } else hit(x, y);
        last = { x, y };
      }
    };
    const onUp = () => { painting = null; last = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    const gridSelf = buildPanel(panelSelf, 50, null, 104);
    const gridCross = buildPanel(panelCross, 40, village, 30);

    // ---------- stamp palette ----------
    const toolBtns = stampDefs.map((st) => {
      const b = h('button', { class: 'pf-tool', 'data-tool': st.id, text: st.label });
      b.addEventListener('click', () => { tool = st.id; board.sfx('pin'); toolBtns.forEach((x) => x.classList.toggle('on', x === b)); });
      return b;
    });
    toolBtns[0]?.classList.add('on');

    board.body.append(h('div', { class: 'pf' }, [
      h('div', { class: 'pf-strip pf-top' }, [deskRow, tray]),
      h('div', { class: 'pf-panels' }, [
        h('div', { class: 'pf-strip' }, [h('div', { class: 'pz-label pf-strip-title', text: spec.panels?.self?.label || 'Reply Row' }), gridSelf]),
        h('div', { class: 'pf-strip' }, [h('div', { class: 'pz-label pf-strip-title', text: spec.panels?.cross?.label || 'Across the bridge' }), gridCross]),
        h('div', { class: 'pf-stamps' }, [h('div', { class: 'pz-label', text: 'Stamps' }), ...toolBtns]),
      ]),
    ]));

    // ---------- live weights ----------
    const weights = { self: [], cross: [] };
    function draw(p, key) {
      weights[key] = [];
      for (let i = 0; i < n; i++) {
        const { fainted, w } = softmaxRow(p.scores[i] || [], p.stamps[i]);
        weights[key].push({ fainted, w });
        p.rows[i].classList.toggle('pf-row-fainted', fainted);
        p.names[i].textContent = `✎${i + 1}${fainted ? ' 😵' : ''}`;
        p.wins[i].forEach((win, j) => {
          win.style.setProperty('--w', glow(w[j]));
          win.classList.toggle('is-fence', p.stamps[i][j] === 'fence');
          win.classList.toggle('is-screen', p.stamps[i][j] === 'screen');
          win.title = fainted ? 'NaN' : `${Math.round(w[j] * 100)}%`;
        });
      }
    }
    function changed() {
      panelSelf.heads.forEach((hd, j) => { hd.textContent = desks[j] ? cardById[desks[j]]?.label || '' : '·'; });
      draw(panelSelf, 'self'); draw(panelCross, 'cross');
      [...panelSelf.badges, ...panelCross.badges].forEach((b) => b.replaceChildren());
    }
    placeCards();
    changed();

    // ---------- the practice bell ----------
    const legal = (i, j) => { const c = cardById[desks[j]]; return !c || c.reveals == null || c.reveals < i + 1; };
    function ring() {
      changed();
      if (desks.some((d) => !d)) { board.fail('emptyDesk'); return; }
      const rowProblems = [];
      for (let i = 0; i < n; i++) {
        const { fainted, w } = weights.self[i];
        const badges = [];
        if (fainted) { badges.push(['fainted', '😵 NaN', { desk: i + 1 }]); rowProblems.push({ key: 'fainted', vars: { desk: i + 1 } }); }
        else {
          let peek = 0; for (let j = 0; j < n; j++) if (!legal(i, j)) peek += w[j];
          if (peek > 1e-12) {
            const pct = peek < 0.005 ? '<1' : String(Math.round(peek * 100));
            badges.push(['peeking', `👀 ${pct}%`, { desk: i + 1, pct }]); rowProblems.push({ key: 'peeking', vars: { desk: i + 1, pct } });
          }
          if (selfStamps[i].some((st, j) => st && legal(i, j))) { badges.push(['squinting', '🤨', { desk: i + 1 }]); rowProblems.push({ key: 'squinting', vars: { desk: i + 1 } }); }
        }
        badges.forEach(([key, label, vars]) => panelSelf.badges[i].append(h('span', { class: 'pf-badge', text: label, title: interp(spec.feedback?.[key] || key, vars) })));
      }
      const general = [];
      if (crossStamps.some((r) => r.some(Boolean))) general.push('bridge');
      if (sol.desks && desks.some((d, j) => d !== sol.desks[j])) general.push('desks');
      if (!rowProblems.length && !general.length) {
        panelSelf.wins.forEach((row) => row.forEach((win) => { if (win.classList.contains('is-fence')) { win.classList.remove('pf-win-pop'); void win.offsetWidth; win.classList.add('pf-win-pop'); } }));
        board.sfx('ding');
        board.solve();
        return;
      }
      board.fail([...general, ...rowProblems].slice(0, 2));
    }
    board.button('🔔 Ring the practice bell', ring, { primary: true });

    container.__state = () => ({ desks: desks.slice(), selfStamps: selfStamps.map((r) => r.slice()), crossStamps: crossStamps.map((r) => r.slice()), tool });
    return {
      destroy() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        dnd.destroy(); board.destroy();
      },
    };
  },
};
