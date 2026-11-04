// Solve-through test for the world puzzles. Needs the game server running.
//   BASE=http://localhost:3000 node test/puzzles/solve.cjs [region/challenge ...]
// For each puzzle: open /dev/puzzle.html, make a wrong attempt (must not solve),
// then solve it through the UI using the spec's solution, and check onSolved fired.
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';

async function drag(p, sel, tgt) {
  const a = await p.locator(sel).first().boundingBox(); const t = await p.locator(tgt).first().boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 8, { steps: 3 });
  await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 }); await p.mouse.up();
}
const state = (p) => p.evaluate(() => document.querySelector('.puzzle-host').__state());
const submit = (p) => p.click('.pz-actions .etl-btn.primary');

const SOLVERS = {
  'positional-wave-loom': async (p, spec) => {
    await submit(p); // wrong: nothing set
    const sol = spec.solution; const opts = spec.slownessOptions.map((o) => o.m); const st0 = await state(p);
    const faces = await p.$$('.wl-face');
    for (let k = 0; k < faces.length; k++) if (st0.faces[k] !== sol.faces[k]) await faces[k].click();
    for (let k = 0; k < sol.m.length; k++) {
      const from = opts.indexOf(st0.m[k]); const to = opts.indexOf(sol.m[k]);
      for (let i = 0; i < Math.abs(to - from); i++) await p.click(`.wl-dial[data-col="${k}"] .wl-arrow:${to < from ? 'first-child' : 'last-child'}`);
    }
    await p.click(`[data-join="${sol.join}"]`);
    await submit(p);
  },
  'decoder-peeking-fence': async (p, spec) => {
    await submit(p); // wrong: empty desks
    for (let j = 0; j < spec.solution.desks.length; j++) await drag(p, `[data-card="${spec.solution.desks[j]}"]`, `[data-desk="${j}"]`);
    const self = p.locator('.pf-grid').first();
    for (let i = 0; i < spec.solution.selfStamps.length; i++) {
      for (let j = 0; j < spec.solution.selfStamps[i].length; j++) {
        if (spec.solution.selfStamps[i][j] === 'fence') await self.locator(`.pf-win[data-i="${i}"][data-j="${j}"]`).click();
      }
    }
    await submit(p);
  },
  'pairing-net': async (p, spec) => {
    await submit(p); // wrong: pin missing (runaway)
    await p.waitForTimeout(2200);
    const want = spec.solution.captionOrder;
    for (let j = 0; j < want.length; j++) { const s = await state(p); if (s.order[j] !== want[j]) await drag(p, `[data-tag="${want[j]}"]`, `[data-slot="${j}"]`); }
    for (const f of spec.solution.floats) await p.click(`[data-float="${f}"]`);
    await p.fill('.pn-read input >> nth=0', String(Math.round(spec.solution.start * 10) / 10)); await p.keyboard.press('Enter');
    await p.fill('.pn-read input >> nth=1', String(spec.solution.pin)); await p.keyboard.press('Enter');
    await submit(p);
    await p.waitForTimeout(2800);
  },
  'selective-gulp-knobs': async (p, spec) => {
    await submit(p); await submit(p); // run and skip to the end: the chained start can't win
    const want = spec.solution?.example || {};
    const st = await state(p);
    if (st.chained) await p.click('.sg-chain');
    const opts = (spec.knobs?.delta?.options) || [0.001, 0.01, 0.1, 1, 10];
    for (const [kind, kn] of Object.entries(want)) {
      if (kind === 'chained') continue;
      const cur = (await state(p)).knobs[kind];
      const from = opts.indexOf(cur.delta); const to = opts.indexOf(kn.delta);
      for (let i = 0; i < Math.abs(to - from); i++) await p.click(`.sg-dial[data-kind="${kind}"] button:${to < from ? 'first-child' : 'last-child'}`);
      for (const key of ['B', 'C']) if (cur[key] !== kn[key]) await p.click(`.sg-toggle[data-kind="${kind}"][data-knob="${key}"]`);
    }
    await submit(p); await submit(p);
  },
  'mamba-vertebra-jig': async (p, spec) => {
    await submit(p); // wrong: empty jig
    const sol = spec.solution;
    for (const sl of spec.slots) await drag(p, `.vj-tray [data-tile="${sol[sl.id]}"]`, `[data-slot="${sl.id}"]`);
    const opts = spec.expansion?.options || [1, 2, 3, 4];
    const cur = (await state(p)).E;
    const from = opts.indexOf(cur); const to = opts.indexOf(sol.E);
    for (let i = 0; i < Math.abs(to - from); i++) await p.click(`.vj-e button:${to < from ? 'first-child' : 'last-child'}`);
    await submit(p);
  },
  'name-racks': async (p, spec) => {
    const plan = spec.winningSettings?.[0] || { dock: 'machine', lagoon: 'bird', boxer: 'pet', pug: 'pet' };
    for (const [rack, tag] of Object.entries(plan)) if (tag) await drag(p, `.nr-tag[data-tag="${tag}"]`, `.nr-slot[data-rack="${rack}"]`);
  },
};

module.exports = { SOLVERS, drag };
if (require.main !== module) return;

(async () => {
  const want = process.argv.slice(2);
  const browser = await chromium.launch();
  let failed = 0;
  for (const region of ['attention', 'clip', 'mamba']) {
    const rg = await (await fetch(`${BASE}/content/regions/${region}.json`)).json();
    for (const c of rg.challenges.filter((x) => x.type === 'puzzle')) {
      const key = `${region}/${c.id}`;
      if (want.length && !want.includes(key)) continue;
      const solve = SOLVERS[c.puzzle];
      if (!solve) { console.log(`SKIP ${key} ${c.puzzle} (no solver yet)`); continue; }
      const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      try {
        await p.goto(`${BASE}/dev/puzzle.html?region=${region}&challenge=${c.id}`);
        await p.waitForFunction(() => window.__puzzle?.ready, null, { timeout: 20000 });
        await solve(p, c.spec);
        await p.waitForFunction(() => window.__puzzle.solved, null, { timeout: 8000 });
        const fails = await p.evaluate(() => window.__puzzle.events.filter((e) => e === 'sfx:buzz').length);
        if (errors.length) throw new Error(errors.join('; '));
        console.log(`PASS ${key} ${c.puzzle}${fails ? '' : ' (no wrong attempt checked)'}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${key} ${c.puzzle}: ${String(e.message || e).split('\n')[0]}`);
      }
      await p.close();
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
