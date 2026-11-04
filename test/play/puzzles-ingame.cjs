// Plays every world puzzle inside its region: walk to the giver, talk, solve,
// listen to the success lines. Non-puzzle steps are pre-marked solved in the save,
// so finishing the puzzles also spawns the artefact. Needs the game server running.
//   BASE=http://localhost:3000 node test/play/puzzles-ingame.cjs [attention clip mamba]
const { chromium } = require('playwright');
const { SOLVERS } = require('../puzzles/solve.cjs');

const BASE = process.env.BASE || 'http://localhost:3000';

async function drain(p, ms = 30000) {
  const t0 = Date.now(); let quiet = 0;
  while (Date.now() - t0 < ms) {
    if (await p.$('.puzzle-host')) return 'puzzle';
    if (await p.$('.dlg-ask')) return 'ask';
    if (await p.$('.dlg') || await p.$('.item-get')) { quiet = 0; await p.keyboard.press('Space'); await p.waitForTimeout(240); }
    else { quiet += 200; if (quiet > 2400) return 'done'; await p.waitForTimeout(200); }
  }
  return 'timeout';
}

async function playRegion(browser, regionId) {
  const region = await (await fetch(`${BASE}/content/regions/${regionId}.json`)).json();
  const puzzles = region.challenges.filter((c) => c.type === 'puzzle');
  const pre = {};
  for (const c of region.challenges) if (c.type !== 'puzzle') pre[c.id] = true;
  for (const f of region.fundamentals || []) pre[f.id] = true;
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (process.env.DEBUG) console.log('  start', regionId);
  await p.goto(`${BASE}/`);
  await p.evaluate(([id, solved]) => localStorage.setItem('etl-save-v1', JSON.stringify({
    version: 1, character: {}, introSeen: true, currentTask: id, artefacts: [], learned: {},
    regions: { [id]: { arrived: true, solved, talked: {} } }, lastScene: `region:${id}`,
  })), [regionId, pre]);
  await p.reload();
  await p.waitForSelector('.title-card .etl-btn', { timeout: 60000 });
  await p.click('.title-card .etl-btn', { force: true });
  if (process.env.DEBUG) console.log('  clicked continue');
  await p.waitForFunction(() => window.__etl?.ws?.interactables?.length > 0, null, { timeout: 30000 });
  await drain(p);
  if (process.env.DEBUG) console.log('  arrived', regionId);
  const results = [];
  for (const c of puzzles) {
    const giver = region.inhabitants.find((x) => x.id === c.giver) || region.stations.find((x) => x.id === c.giver);
    const label = giver?.name || giver?.label;
    const pos = await p.evaluate((lab) => { const it = window.__etl.ws.interactables.find((x) => x.label === lab); if (!it) return null; const q = typeof it.pos === 'function' ? it.pos() : it.pos; return [q.x, q.y ?? 0, q.z]; }, label);
    if (!pos) { results.push(`FAIL ${regionId}/${c.id}: no interactable for ${label}`); continue; }
    await p.evaluate(([x, y, z]) => window.__etl.ws.player.place(x + 1.0, y, z + 0.8), pos);
    await p.waitForTimeout(500);
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(400);
    const got = await drain(p);
    if (process.env.DEBUG) console.log('  talk', regionId, c.id, label, got);
    if (got !== 'puzzle') { results.push(`FAIL ${regionId}/${c.id}: talking to ${label} gave '${got}', not the puzzle`); continue; }
    await p.waitForTimeout(500);
    await SOLVERS[c.puzzle](p, c.spec);
    try { await p.waitForFunction(() => !document.querySelector('.puzzle-host'), null, { timeout: 10000 }); }
    catch { results.push(`FAIL ${regionId}/${c.id}: puzzle did not close`); continue; }
    await drain(p);
    const solved = await p.evaluate(([id, cid]) => !!JSON.parse(localStorage.getItem('etl-save-v1')).regions[id].solved[cid], [regionId, c.id]);
    results.push(`${solved ? 'PASS' : 'FAIL'} ${regionId}/${c.id} ${c.puzzle} (giver ${label})`);
  }
  // every step is solved now, so the artefact lies in the world: walk over and pick it up
  const aName = region.artefact?.name || 'artefact';
  const apos = await p.evaluate((lab) => { const it = window.__etl.ws.interactables.find((x) => x.label === lab); if (!it) return null; const q = typeof it.pos === 'function' ? it.pos() : it.pos; return [q.x, q.y ?? 0, q.z]; }, aName);
  if (apos) {
    await p.evaluate(([x, y, z]) => window.__etl.ws.player.place(x + 0.6, y, z + 0.4), apos);
    await p.waitForTimeout(500);
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(400);
    await drain(p);
  }
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
    for (const line of await playRegion(browser, id)) { console.log(line); if (line.startsWith('FAIL')) failed++; }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
