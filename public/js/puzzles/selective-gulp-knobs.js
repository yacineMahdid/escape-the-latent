// Gulp or Let Go (Mamba desert, c1). Three message snakes crawl along roads of
// beads, sand and bells. Each kind of grain has its own knobs: Δ (step), B (let it
// in), C (let it out). The belly is a tiny state space: h = exp(-Δ)·h + (1-exp(-Δ))·B·x,
// voice y = C·h. Tune the knobs so at every bell the snake says the latest bead and
// says nothing anywhere else. Paper: Mamba, §3.5.2 (interpretation of Δ, B, C).
import { createBoard, h, injectCss, withPhrases } from './kit.js';

const CSS = `
.sg { display: flex; flex-direction: column; gap: 14px; }
.sg-roads { display: flex; flex-direction: column; gap: 44px; padding: 10px 12px 40px; background: rgba(255, 253, 246, .35); border: 3px solid rgba(43, 34, 51, .2); border-radius: 14px; overflow-x: auto; }
.sg-road { display: flex; align-items: flex-end; gap: 8px; }
.sg-head { position: relative; flex: none; width: 54px; height: 40px; display: flex; align-items: center; gap: 4px; }
.sg-snake { width: 26px; height: 22px; border-radius: 50% 60% 50% 50%; background: #5bbf5a; border: 3px solid var(--ink); position: relative; }
.sg-snake::after { content: ''; position: absolute; width: 5px; height: 5px; border-radius: 50%; background: var(--ink); right: 4px; top: 4px; }
.sg-belly { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--ink); }
.sg-belly-wrap { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--ink); background: #fffdf6; display: flex; align-items: center; justify-content: center; }
.sg-belly-wrap .sg-belly { width: 20px; height: 20px; border: 0; }
.sg-tiles { position: relative; display: flex; gap: 2px; padding-top: 22px; }
.sg-tile { position: relative; width: 18px; height: 24px; display: flex; align-items: center; justify-content: center; }
.sg-gem { width: 13px; height: 13px; transform: rotate(45deg); border: 2px solid var(--ink); border-radius: 2px; }
.sg-sand { width: 6px; height: 6px; border-radius: 50%; background: #c9a46a; }
.sg-bell { font-size: 14px; line-height: 1; filter: grayscale(1) brightness(.4); }
.sg-ribbon { position: absolute; left: 0; right: 0; bottom: -6px; height: 5px; border-radius: 2px; }
.sg-voice { position: absolute; top: -20px; left: 1px; width: 16px; height: 14px; border-radius: 8px 8px 8px 2px; border: 2px solid var(--ink); }
.sg-ring { position: absolute; top: -24px; left: -3px; width: 24px; height: 22px; border-radius: 50%; border: 3px dotted var(--ring, #888); opacity: .85; }
.sg-ring + .sg-voice, .sg-tile.is-bell .sg-voice { top: -20px; left: 2px; width: 14px; height: 14px; border-radius: 50%; }
.sg-chainbar { grid-column: 2 / span 3; text-align: center; letter-spacing: 6px; font-size: 14px; color: #7a5a3a; height: 16px; line-height: 16px; overflow: hidden; white-space: nowrap; }
.sg-tag { position: absolute; top: 31px; left: 50%; transform: translateX(-50%); z-index: 2; font-size: 10px; font-weight: 700; padding: 0 4px; border-radius: 6px; white-space: nowrap; border: 2px solid var(--ink); background: #fff; }
.sg-tag.ok { background: #c8f2dc; }
.sg-tag.low { top: 47px; z-index: 3; }
.sg-tag.bad { background: #ffd9de; color: #a01d35; border-color: #a01d35; }
.sg-mover { position: absolute; top: -2px; width: 22px; height: 16px; border-radius: 50% 60% 50% 50%; background: #5bbf5a; border: 2px solid var(--ink); transition: left .1s linear; pointer-events: none; }
.sg-panel { display: flex; gap: 14px; align-items: stretch; flex-wrap: wrap; }
.sg-knobs { display: grid; grid-template-columns: auto repeat(3, 150px); gap: 6px 10px; align-items: center; padding: 8px 12px; background: rgba(255, 253, 246, .5); border: 3px solid rgba(43, 34, 51, .2); border-radius: 14px; }
.sg-kind { text-align: center; font-weight: 700; }
.sg-rowlab { font-weight: 700; font-size: 14px; text-align: right; }
.sg-rowlab small { font-weight: 500; opacity: .7; }
.sg-dial { display: flex; align-items: center; justify-content: center; gap: 2px; background: var(--paper); border: 2px solid var(--ink); border-radius: 8px; }
.sg-dial button { border: 0; background: none; cursor: pointer; font-size: 12px; padding: 4px 6px; color: var(--ink); }
.sg-dial span { min-width: 48px; text-align: center; font: 700 14px var(--font-ui); }
.sg-toggle { justify-self: center; width: 64px; padding: 3px 0; font: 700 15px var(--font-ui); border: 2px solid var(--ink); border-radius: 999px; cursor: pointer; background: #e8e1d0; color: var(--ink); }
.sg-toggle.on { background: var(--gold); }
.sg-chain { align-self: center; font: 700 16px var(--font-ui); padding: 8px 14px; border: 3px solid var(--ink); border-radius: 12px; cursor: pointer; background: var(--paper); box-shadow: 0 3px 0 rgba(43, 34, 51, .25); }
.sg-chain.on { background: #cfe8ff; }
.sg-win .sg-snake { animation: sg-wiggle .5s ease-in-out infinite alternate; }
@keyframes sg-wiggle { from { transform: rotate(-12deg); } to { transform: rotate(12deg); } }
`;

const rgb = (v) => `rgb(${v.map((c) => Math.round(255 * Math.max(0, Math.min(1, c)))).join(',')})`;
// a colour vector v is drawn as rgb(v / max(v)) at opacity min(1, max(v)); blank when max(v) = 0
function paint(el, v) {
  const m = Math.max(...v);
  if (!(m > 0)) { el.style.background = 'transparent'; el.style.opacity = '1'; return; }
  el.style.background = rgb(v.map((c) => c / m)); el.style.opacity = String(Math.min(1, m));
}
const maxAbs = (v) => Math.max(...v.map((c) => Math.abs(c)));

export default {
  mount(container, rawSpec = {}, api = {}) {
    injectCss('pz-selective-gulp', CSS);
    const spec = withPhrases(rawSpec, { miss: 'not yet: read the tags on the road', silent: 'silent at a bell', faded: 'a bell says a faded bead', mush: 'a bell says mush', chatty: 'talks off the bells' });
    const board = createBoard(container, spec, api, { theme: 'sand' });
    const A = spec.A ?? -1;
    const tokens = spec.tokens || {};
    const code = spec.roadCode || {};
    const roads = (spec.roads || []).map((r) => [...r].map((ch) => code[ch]).filter(Boolean));
    const kinds = spec.kinds || [{ id: 'bead', icon: '◆', tip: 'beads' }, { id: 'sand', icon: '∴', tip: 'sand' }, { id: 'bell', icon: '🔔', tip: 'bell' }];
    const K = spec.knobs || { delta: { options: [0.001, 0.01, 0.1, 1, 10] }, B: { options: [0, 1] }, C: { options: [0, 1] } };
    const tol = spec.tolerance ?? 0.12;
    const knobs = {};
    kinds.forEach((k) => { knobs[k.id] = { delta: 0.1, B: 1, C: 1, ...(spec.initial?.[k.id] || {}) }; });
    let chained = spec.initial?.chained ?? true;
    let lastChanged = kinds[0]?.id;
    let running = null;

    // ---------- roads ----------
    const roadEls = roads.map((road) => {
      const belly = h('div', { class: 'sg-belly', title: `A = ${A}` });
      let lastBead = null;
      const tiles = road.map((tok) => {
        const t = tokens[tok] || {};
        if (t.kind === 'bead') lastBead = t.color;
        const inner = t.kind === 'bead' ? h('div', { class: 'sg-gem', style: { background: rgb(t.color || [1, 1, 1]) } })
          : t.kind === 'bell' ? h('div', { class: 'sg-bell', text: '🔔' }) : h('div', { class: 'sg-sand' });
        const ribbon = h('div', { class: 'sg-ribbon' });
        const voice = h('div', { class: 'sg-voice' }); voice.style.display = 'none';
        const tag = h('div', { class: 'sg-tag' }); tag.style.display = 'none';
        const ring = t.kind === 'bell' && lastBead ? h('div', { class: 'sg-ring', style: { '--ring': rgb(lastBead) } }) : null;
        const el = h('div', { class: `sg-tile${t.kind === 'bell' ? ' is-bell' : ''}`, title: tok }, [inner, ribbon, ...(ring ? [ring] : []), voice, tag]);
        return { el, ribbon, voice, tag, tok, kind: t.kind };
      });
      const mover = h('div', { class: 'sg-mover' }); mover.style.display = 'none';
      const strip = h('div', { class: 'sg-tiles' }, [...tiles.map((t) => t.el), mover]);
      const el = h('div', { class: 'sg-road' }, [h('div', { class: 'sg-head' }, [h('div', { class: 'sg-snake' }), h('div', { class: 'sg-belly-wrap', title: `A = ${A}` }, [belly])]), strip]);
      return { el, belly, tiles, mover };
    });
    const roadsBox = h('div', { class: 'sg-roads' }, roadEls.map((r) => r.el));

    // ---------- knob panel ----------
    const grid = h('div', { class: 'sg-knobs' });
    const chainBar = h('div', { class: 'sg-chainbar', text: '⛓'.repeat(14) });
    grid.append(h('div'), chainBar, h('div'));
    kinds.forEach((k) => grid.append(h('div', { class: 'sg-kind', title: k.tip || k.id, text: `${k.icon} ${k.tip || k.id}` })));
    const views = { delta: {}, B: {}, C: {} };
    const rowLabel = (key, fallbackTip) => h('div', { class: 'sg-rowlab', title: K[key]?.tip || fallbackTip }, [K[key]?.label || key, ' ', h('small', { text: K[key]?.tip || fallbackTip })]);
    grid.append(rowLabel('delta', 'step'));
    kinds.forEach((k) => {
      const val = h('span');
      const step = (d) => {
        const opts = K.delta.options; const i = opts.indexOf(knobs[k.id].delta);
        const ni = Math.max(0, Math.min(opts.length - 1, (i < 0 ? 0 : i) + d));
        setKnob(k.id, 'delta', opts[ni]);
      };
      const left = h('button', { text: '◀', title: 'smaller' }); const right = h('button', { text: '▶', title: 'bigger' });
      left.addEventListener('click', () => step(-1)); right.addEventListener('click', () => step(1));
      const dial = h('div', { class: 'sg-dial', 'data-kind': k.id, 'data-knob': 'delta' }, [left, val, right]);
      dial.addEventListener('wheel', (e) => { e.preventDefault(); step(e.deltaY > 0 ? -1 : 1); }, { passive: false });
      views.delta[k.id] = val;
      grid.append(dial);
    });
    for (const key of ['B', 'C']) {
      grid.append(rowLabel(key, key === 'B' ? 'in' : 'out'));
      kinds.forEach((k) => {
        const b = h('button', { class: 'sg-toggle', 'data-kind': k.id, 'data-knob': key });
        b.addEventListener('click', () => setKnob(k.id, key, knobs[k.id][key] ? 0 : 1));
        views[key][k.id] = b;
        grid.append(b);
      });
    }
    const chain = h('button', { class: 'sg-chain', title: 'same for all' });
    chain.addEventListener('click', () => {
      if (running) return;
      chained = !chained;
      if (chained) { const src = knobs[lastChanged]; kinds.forEach((k) => { knobs[k.id] = { ...src }; }); }
      else lastChanged = kinds[0]?.id; // re-chaining copies the bead column if nothing changed since
      board.sfx('pin'); changed();
    });
    board.body.append(h('div', { class: 'sg' }, [roadsBox, h('div', { class: 'sg-panel' }, [chain, grid])]));

    function setKnob(kind, key, value) {
      if (running) return;
      lastChanged = kind;
      for (const k of chained ? kinds.map((x) => x.id) : [kind]) knobs[k][key] = value;
      board.sfx(key === 'delta' ? 'tick' : 'pop');
      changed();
    }
    const fmtDelta = (d) => (d >= 1 ? String(d) : String(d));
    function changed() {
      kinds.forEach((k) => {
        views.delta[k.id].textContent = fmtDelta(knobs[k.id].delta);
        for (const key of ['B', 'C']) {
          const on = !!knobs[k.id][key];
          views[key][k.id].classList.toggle('on', on);
          views[key][k.id].textContent = key === 'B' ? (on ? '😮 1' : '😶 0') : (on ? '💬 1' : '🤐 0');
        }
      });
      chain.classList.toggle('on', chained);
      chainBar.style.visibility = chained ? 'visible' : 'hidden';
      chain.textContent = chained ? '⛓ linked' : '⛓ unlinked';
      clearRun();
    }

    // ---------- the run ----------
    function simulate(road) {
      let hh = [0, 0, 0];
      return road.map((tok) => {
        const t = tokens[tok] || {}; const kn = knobs[t.kind] || { delta: 0.1, B: 0, C: 0 };
        const Abar = Math.exp(A * kn.delta);
        const Bbar = ((Math.exp(A * kn.delta) - 1) / A) * kn.B;
        hh = hh.map((v, c) => Abar * v + Bbar * (t.color?.[c] ?? 0));
        return { h: hh.slice(), y: hh.map((v) => kn.C * v) };
      });
    }
    function clearRun() {
      if (running) return;
      roadEls.forEach((r) => {
        paint(r.belly, [0, 0, 0]);
        r.mover.style.display = 'none';
        r.tiles.forEach((t) => { paint(t.ribbon, [0, 0, 0]); t.voice.style.display = 'none'; t.tag.style.display = 'none'; });
      });
      board.root.classList.remove('sg-win');
    }
    function showStep(r, traj, i) {
      const t = r.tiles[i]; const s = traj[i];
      paint(t.ribbon, s.h);
      paint(r.belly, s.h);
      if (Math.max(...s.y) > tol) { t.voice.style.display = ''; paint(t.voice, s.y); }
      r.mover.style.display = ''; r.mover.style.left = `${t.el.offsetLeft - 2}px`;
    }
    const tagText = (k) => { const f = rawSpec.feedback?.[k]; return typeof f === 'string' ? f : f?.badge || (k === 'ok' ? '✓' : k); };
    function judge(trajs) {
      const problems = new Set();
      roadEls.forEach((r, ri) => {
        let lastBead = null; let chattyShown = false; let lastTag = -9; let low = false;
        const place = (t, i) => { low = i - lastTag === 1 ? !low : false; t.tag.classList.toggle('low', low); lastTag = i; };
        r.tiles.forEach((t, i) => {
          const y = trajs[ri][i].y; const tok = tokens[t.tok] || {};
          if (t.kind === 'bead') lastBead = tok.color;
          if (t.kind === 'bell') {
            const target = lastBead || [0, 0, 0];
            const err = Math.max(...y.map((v, c) => Math.abs(v - target[c])));
            let verdict = 'ok';
            if (err > tol) {
              if (maxAbs(y) <= tol) verdict = 'silent';
              else {
                const s = y.reduce((a, v, c) => a + v * target[c], 0) / (target.reduce((a, v) => a + v * v, 0) || 1);
                const res = y.map((v, c) => v - s * target[c]);
                verdict = maxAbs(res) <= tol && s < 1 ? 'faded' : 'mush';
              }
            }
            if (verdict !== 'ok') problems.add(verdict);
            t.tag.style.display = ''; t.tag.className = `sg-tag ${verdict === 'ok' ? 'ok' : 'bad'}`;
            t.tag.textContent = tagText(verdict);
            place(t, i);
          } else if (!chattyShown && maxAbs(y) > tol) {
            chattyShown = true; problems.add('chatty');
            t.tag.style.display = ''; t.tag.className = 'sg-tag bad'; t.tag.textContent = tagText('chatty');
            place(t, i);
          }
        });
      });
      return problems;
    }
    function finish() {
      if (!running) return;
      const { trajs, timer } = running;
      clearInterval(timer);
      roadEls.forEach((r, ri) => { for (let i = 0; i < r.tiles.length; i++) showStep(r, trajs[ri], i); r.mover.style.display = 'none'; });
      running = null;
      const problems = judge(trajs);
      if (!problems.size) { board.root.classList.add('sg-win'); board.sfx('ding'); board.solve(); return; }
      board.fail(rawSpec.feedback?.miss != null ? 'miss' : ['silent', 'faded', 'mush', 'chatty'].filter((k) => problems.has(k)));
    }
    function run() {
      if (running) { finish(); return; }
      clearRun();
      const trajs = roadEls.map((_, ri) => simulate(roads[ri]));
      const longest = Math.max(...roads.map((r) => r.length));
      let i = 0;
      const timer = setInterval(() => {
        roadEls.forEach((r, ri) => { if (i < r.tiles.length) showStep(r, trajs[ri], i); });
        board.sfx('tick');
        i++;
        if (i >= longest) finish();
      }, 120);
      running = { trajs, timer };
    }
    board.button('▶ Run', run, { primary: true });
    changed();

    container.__state = () => ({ chained, knobs: JSON.parse(JSON.stringify(knobs)) });
    return { destroy() { if (running) clearInterval(running.timer); board.destroy(); } };
  },
};
