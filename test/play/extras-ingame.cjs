// Plays every challenge of each world's extra pack (content/extra/<world>.json: a mini-game, an environmental
// puzzle, a quiz) inside the world, in an order the chain allows, then picks up the artefact. The base challenges
// and fundamentals are pre-marked solved in the save. Each world's solvers live in test/play/extras/<world>.cjs.
// Needs the game server running.
//   BASE=http://localhost:3000 node test/play/extras-ingame.cjs [attention clip mamba]
//
// Solver contract (test/play/extras/<world>.cjs):
//   module.exports = { [challengeId]: async (p, c, h) => {} }
//   Called right after the player talked to the giver and the intro lines are done:
//     minigame:    the .puzzle-host overlay is open (the kit is on host.__mg)
//     quiz:        the first question box (.dlg-ask) is open
//     environment: the puzzle has just started in the world (the HUD shows its goal)
//   Play it through real inputs (keys, clicks, walking or teleporting with h.place, E with h.use), resolve when it
//   should be solved. The harness then plays out the remaining lines and checks the save.
//   h = { BASE, region (base + pack), drain(p), place(p, x, y, z), use(p, label | (it) => bool), labelOf(id),
//         posOf(p, label | fn) -> [x, y, z] | null, solved(p, id) -> bool, wait(ms) }
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// press through dialogue lines; stop at a choice/answer box, an overlay, or when it has been quiet a while
async function drain(p, ms = 45000) {
  const t0 = Date.now(); let quiet = 0;
  while (Date.now() - t0 < ms) {
    if (await p.$('.puzzle-host')) return 'overlay';
    if (await p.$('.dlg-ask')) return 'ask';
    if (await p.$('.dlg') || await p.$('.item-get')) { quiet = 0; await p.keyboard.press('Space'); await p.waitForTimeout(260); }
    else { quiet += 200; if (quiet > 2600) return 'done'; await p.waitForTimeout(200); }
  }
  return 'timeout';
}
const finder = (labelOrFn) => (typeof labelOrFn === 'function' ? labelOrFn.toString() : null);
async function posOf(p, target) {
  return p.evaluate(([label, fnSrc]) => {
    // eslint-disable-next-line no-new-func
    const test = fnSrc ? new Function(`return (${fnSrc})`)() : (it) => it.label === label;
    const it = window.__etl.ws.interactables.find((x) => x.enabled !== false && test(x));
    if (!it) return null;
    const q = typeof it.pos === 'function' ? it.pos() : it.pos;
    return [q.x, q.y ?? 0, q.z];
  }, [typeof target === 'string' ? target : null, finder(target)]);
}
async function place(p, x, y, z) {
  await p.evaluate(([a, b, c]) => window.__etl.ws.player.place(a, b, c), [x, y, z]);
  await p.waitForTimeout(450);
}
// the game is ready for a key: no page wipe, no dialogue or run in progress (slow machines lag behind)
const idle = (p) => p.waitForFunction(() => !document.querySelector('.page-wipe') && window.__etl?.ws && !window.__etl.ws.busy, null, { timeout: 120000 }).catch(() => {});
// stand next to an interactable and press E (the nearest one must be this one: stand closer than its neighbours)
async function use(p, target) {
  await idle(p);
  const q = await posOf(p, target);
  if (!q) throw new Error(`nothing to use: ${typeof target === 'string' ? target : 'predicate'}`);
  await place(p, q[0] + 0.6, q[1], q[2] + 0.5);
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(400);
}
const solvedIn = (p, regionId, id) => p.evaluate(([r, c]) => !!JSON.parse(localStorage.getItem('etl-save-v1') || '{}').regions?.[r]?.solved?.[c], [regionId, id]);

async function playWorld(browser, regionId) {
  const base = await (await fetch(`${BASE}/content/regions/${regionId}.json`)).json();
  const pack = await fetch(`${BASE}/content/extra/${regionId}.json`).then((r) => (r.ok ? r.json() : null));
  if (!pack) return [`PASS ${regionId}: no extra pack`];
  const region = { ...base };
  for (const k of ['challenges', 'inhabitants', 'stations']) region[k] = [...(base[k] || []), ...(pack[k] || [])];
  const solvers = require(`./extras/${regionId}.cjs`);
  const extras = pack.challenges || [];
  const pre = {};
  for (const c of base.challenges) pre[c.id] = true;
  for (const f of base.fundamentals || []) pre[f.id] = true;

  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.setDefaultTimeout(150000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.goto(`${BASE}/`);
  await p.evaluate(([id, solved]) => localStorage.setItem('etl-save-v1', JSON.stringify({
    version: 1, character: {}, introSeen: true, currentTask: id, artefacts: [], learned: {},
    regions: { [id]: { arrived: true, solved, talked: {} } }, lastScene: `region:${id}`,
  })), [regionId, pre]);
  await p.reload();
  await p.waitForSelector('.title-card .etl-btn', { timeout: 120000 });
  await p.click('.title-card .etl-btn', { force: true });
  await p.waitForFunction(() => window.__etl?.ws?.interactables?.length > 0, null, { timeout: 180000 });
  await drain(p);

  const labelOf = (id) => region.inhabitants.find((x) => x.id === id)?.name || region.stations.find((x) => x.id === id)?.label || id;
  const h = { BASE, region, drain, place, use, posOf, labelOf, wait, solved: (pp, id) => solvedIn(pp, regionId, id) };
  const results = [];
  const done = new Set();
  for (let round = 0; round < extras.length; round++) {
    const save = await p.evaluate((id) => JSON.parse(localStorage.getItem('etl-save-v1')).regions[id].solved, regionId);
    const c = extras.find((x) => !done.has(x.id) && !save[x.id] && (x.requires || []).every((r) => save[r]));
    if (!c) break;
    done.add(c.id);
    const t0 = Date.now();
    try {
      if (!solvers[c.id]) throw new Error('no solver');
      await use(p, labelOf(c.giver));
      let got = await drain(p);
      const want = c.type === 'minigame' ? 'overlay' : c.type === 'quiz' ? 'ask' : 'done';
      // slow machines: a mini-game appears only once its module has loaded, seconds after the last line
      if (got === 'done' && want !== 'done') {
        got = await p.waitForSelector(want === 'overlay' ? '.puzzle-host' : '.dlg-ask', { timeout: 60000 }).then(() => want).catch(() => got);
      }
      if (got !== want) throw new Error(`talking to ${labelOf(c.giver)} gave '${got}', expected '${want}'`);
      await solvers[c.id](p, c, h);
      await p.waitForFunction(() => !document.querySelector('.puzzle-host'), null, { timeout: 30000 }).catch(() => {});
      await drain(p);
      const ok = await solvedIn(p, regionId, c.id);
      results.push(`${ok ? 'PASS' : 'FAIL'} ${regionId}/${c.id} ${c.type} ${c.minigame || c.environment || ''} (giver ${labelOf(c.giver)}, ${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (e) {
      results.push(`FAIL ${regionId}/${c.id} ${c.type}: ${String(e.message || e).split('\n')[0]}`);
      try { await p.keyboard.press('Escape'); await drain(p, 8000); } catch { /* keep going */ }
    }
  }
  for (const c of extras) if (!done.has(c.id)) results.push(`FAIL ${regionId}/${c.id}: never became ready`);

  // everything is solved now: the artefact lies by the player's feet
  const apos = await posOf(p, (it) => it.icon === '✦');
  if (apos) { await place(p, apos[0] + 0.5, apos[1], apos[2] + 0.4); await p.keyboard.press('KeyE'); await p.waitForTimeout(400); await drain(p); }
  const st = await p.evaluate((id) => JSON.parse(localStorage.getItem('etl-save-v1')).regions[id], regionId);
  results.push(`${st.artefact ? 'PASS' : 'FAIL'} ${regionId}: artefact ${apos ? 'spawned' : 'never spawned'}, ${st.artefact ? 'picked up' : 'not picked up'}`);
  results.push(`${errors.length ? 'FAIL' : 'PASS'} ${regionId}: page errors ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
  await p.close();
  return results;
}

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : ['attention', 'clip', 'mamba'];
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let failed = 0;
  for (const id of which) {
    for (const line of await playWorld(browser, id)) { console.log(line); if (line.startsWith('FAIL')) failed++; }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
