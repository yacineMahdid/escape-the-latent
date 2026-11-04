// Solvers for Siftsand's extra pack (content/extra/mamba.json), driven by test/play/extras-ingame.cjs.
// Real inputs only: Space / ↑ and clicks on the race's GULP and SHOUT buttons, clicks on the quiz's answers and the
// ribbon menus, E at the ribbons and the dispatch bell (the player is teleported next to them), and Space held to
// hurry Noodle's delivery run. Nothing calls the kit's force().
//   m1 (Belly vs. Cart): reads the road and Noodle's place on it (host.__mg.state) to time each press: GULP every
//     bead as it reaches his mouth, SHOUT at every bell. Replays from the Again card if a race is lost.
//   q1 (Where Does the Road End?): answers the three questions from the challenge's own answer keys.
//   e1 (Parcel Day): a clear marble on the ribbons before the two empty parcels (R1, R3), then the dispatch bell.
// Every wait is on a condition with a generous timeout: the 3D scene runs at 1-5 fps on a busy machine, and the
// game caps a frame at 0.05 s, so a ~40 s race can take many minutes of wall time.
const LONG = { timeout: 180000 };
const RACE = 60 * 60000; // one race, at the slowest frame rates seen

// ---------------- m1: Belly vs. Cart ----------------
const mg = (p) => p.evaluate(() => {
  const m = document.querySelector('.puzzle-host')?.__mg;
  if (!m) return { status: 'gone' };
  const S = m.state;
  return { status: m.status, outcome: m.outcome, winner: S?.winner || null, right: S?.right, bells: S?.bells, mistakes: S?.mistakes };
});
async function clickCard(p, label) {
  const btn = p.locator('.puzzle-host .mg-card .etl-btn', { hasText: label }).first();
  await btn.waitFor({ state: 'visible', timeout: 180000 });
  await btn.click();
}
// the race's own paper buttons, drawn on its canvas (960 x 540 units)
async function clickButton(p, which) {
  const box = await p.locator('.puzzle-host .mg-canvas').boundingBox();
  const x = which === 'shout' ? 800 : 160, y = 498;
  await p.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height);
}

async function m1(p) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await clickCard(p, attempt === 1 ? 'Start' : 'Again');
    await p.waitForFunction(() => { const m = document.querySelector('.puzzle-host')?.__mg; return !m || m.status === 'play'; }, null, LONG);
    const acts = await p.evaluate(() => (document.querySelector('.puzzle-host')?.__mg?.state?.tiles || [])
      .filter((t) => t.kind === 'bead' || t.kind === 'bell').map((t) => ({ i: t.i, kind: t.kind })));
    let k = 0;
    for (const a of acts) {
      // the grain is about to reach Noodle's mouth (and he is not stalled): press now
      const h = await p.waitForFunction((x) => {
        const m = document.querySelector('.puzzle-host')?.__mg; const S = m?.state;
        if (!m || m.status !== 'play' || !S || S.winner) return 'over';
        if (S.tiles[x.i].done || S.dN > x.i + 0.3) return 'gone';
        return S.stall <= 0 && S.dN >= x.i - 0.16 ? 'go' : false;
      }, a, { timeout: RACE, polling: 'raf' });
      const what = await h.jsonValue();
      if (what === 'over') break;
      if (what === 'gone') continue;
      if (k++ % 4 === 3) await clickButton(p, a.kind === 'bell' ? 'shout' : 'gulp'); // now and then, the mouse
      else await p.keyboard.press(a.kind === 'bell' ? 'ArrowUp' : 'Space');
    }
    // FINISH!, then the win card (it continues by itself) or the Again card
    await p.waitForFunction(() => {
      const m = document.querySelector('.puzzle-host')?.__mg;
      return !m || ['result', 'done', 'retry'].includes(m.status);
    }, null, { timeout: RACE, polling: 500 });
    const s = await mg(p);
    if (s.status === 'retry') { console.log(`  m1: race ${attempt} lost (${s.right}/${s.bells} bells, ${s.mistakes} mistakes); again`); continue; }
    if (s.status === 'result') await clickCard(p, 'Continue').catch(() => { /* the card's own timer won */ });
    await p.waitForFunction(() => !document.querySelector('.puzzle-host'), null, LONG);
    return;
  }
  throw new Error('m1: no win in 4 races');
}

// ---------------- q1: Tumble's questions ----------------
async function q1(p, c) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  for (let answered = 0; answered < c.questions.length;) {
    await p.waitForSelector('.dlg', LONG);
    const box = await p.evaluate(() => {
      const b = document.querySelector('.dlg');
      return b ? { ask: b.classList.contains('dlg-ask'), text: b.querySelector('.dlg-text')?.textContent || '' } : null;
    });
    if (!box) continue;
    if (!box.ask) { await p.keyboard.press('Space'); await p.waitForTimeout(250); continue; } // a 'right' line
    const q = c.questions.find((x) => norm(x.question) === norm(box.text));
    if (!q) throw new Error(`q1: unknown question "${box.text}"`);
    const want = norm(q.options[q.answer]);
    const labels = await p.evaluate(() => [...document.querySelectorAll('.dlg-ask .etl-btn')].map((b) => b.textContent));
    const idx = labels.findIndex((l) => norm(l) === want);
    if (idx < 0) throw new Error(`q1: no option "${want}" in ${JSON.stringify(labels)}`);
    await p.locator('.dlg-ask .etl-btn').nth(idx).click();
    answered++;
    await p.waitForFunction((t) => (document.querySelector('.dlg-ask .dlg-text')?.textContent || '') !== t, box.text, LONG);
  }
}

// ---------------- e1: Parcel Day ----------------
const parcelDay = (p) => p.evaluate(() => { const d = window.__etl.parcelDay; return d ? { placed: d.placed, marbles: d.marbles, running: d.running, runs: d.runs, last: d.last } : null; });
const itPos = (p, id) => p.evaluate((x) => {
  const it = window.__etl.ws.interactables.find((y) => y.id === x);
  if (!it) return null;
  const v = typeof it.pos === 'function' ? it.pos() : it.pos; return [v.x, v.y ?? 0, v.z];
}, id);
// the prompt the walk scene shows now: the nearest enabled interactable in reach
const nearestId = (p) => p.evaluate(() => {
  const ws = window.__etl.ws; const q = ws.player.pos; let best = null, bd = Infinity;
  for (const it of ws.interactables) {
    if (it.enabled === false) continue;
    const v = typeof it.pos === 'function' ? it.pos() : it.pos; const d = Math.hypot(v.x - q.x, v.z - q.z);
    if (d < (it.radius ?? 2) && Math.abs((v.y ?? 0) - q.y) < 1.2 && d < bd) { best = it; bd = d; }
  }
  return best ? (best.id || best.label) : null;
});
// stand where `id` is the nearest prompt and press E until `done` holds (a press during a scene cooldown is dropped)
async function useUntil(p, h, id, offset, done, arg) {
  for (let i = 0; i < 12; i++) {
    const q = await itPos(p, id);
    if (!q) throw new Error(`e1: no '${id}' in the world`);
    await h.place(p, q[0] + offset[0], q[1], q[2] + offset[1]);
    const near = await nearestId(p);
    if (near !== id) throw new Error(`e1: by '${id}' the prompt is '${near}'`);
    await p.keyboard.press('KeyE');
    try { await p.waitForFunction(done, arg, { timeout: 20000 }); return; } catch { /* again */ }
  }
  throw new Error(`e1: pressing E at '${id}' did nothing`);
}
async function putMarble(p, h, id) {
  await useUntil(p, h, id, [0, 0.5], () => !!document.querySelector('.dlg-ask'));
  const labels = await p.evaluate(() => [...document.querySelectorAll('.dlg-ask .etl-btn')].map((b) => b.textContent));
  const idx = labels.findIndex((l) => /clear marble/i.test(l));
  if (idx < 0) throw new Error(`e1: no marble in the menu at ${id}: ${JSON.stringify(labels)}`);
  await p.waitForTimeout(450); // the menu ignores presses in its first 400 ms; a click is fine, but read it first
  await p.locator('.dlg-ask .etl-btn').nth(idx).click();
  await p.waitForFunction((x) => window.__etl.parcelDay?.placed?.[x] === 'marble', id, LONG);
}

async function e1(p, c, h) {
  await p.waitForFunction(() => !!window.__etl.parcelDay, null, LONG);
  // the two empty parcels (Tumble's, Umberto's) would hear the bead before them: a clear marble wipes the belly
  const empty = c.spec.parcels.filter((x) => !x.own).map((x) => x.owner);
  const ribbons = c.spec.ribbons.filter((r) => empty.includes(r.between[1])).map((r) => r.id);
  for (const id of ribbons) await putMarble(p, h, id);
  // ring the dispatch bell, then hold Space: Noodle hurries along the row
  await useUntil(p, h, 'dispatch', [0.5, 0.6], () => !window.__etl.parcelDay || window.__etl.parcelDay.running);
  await p.keyboard.down('Space');
  try {
    await p.waitForFunction(() => !window.__etl.parcelDay?.running, null, { timeout: RACE, polling: 500 });
  } finally { await p.keyboard.up('Space'); }
  const st = await parcelDay(p);
  if (st && st.last.some((r) => !r.ok)) throw new Error(`e1: mix-ups: ${JSON.stringify(st.last)}`);
  // five bells ring, the row packs away, the puzzle is solved and Penny speaks
  await p.waitForFunction(() => !!JSON.parse(localStorage.getItem('etl-save-v1') || '{}').regions?.mamba?.solved?.e1, null, { timeout: 600000 });
  await p.waitForSelector('.dlg', LONG);
}

module.exports = { m1, q1, e1 };
