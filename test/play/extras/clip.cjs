// Solvers for Pairadise's extra pack (content/extra/clip.json), driven by test/play/extras-ingame.cjs.
// Real inputs only: clicks on the mini-game's own buttons, arrow keys on the rafts, E at the island's props
// (the player is teleported next to each one), Space through dialogue, clicks on the quiz's answers.
// Every wait is on a condition with a generous timeout: the 3D scene runs at 1-5 fps on a busy machine,
// and the mini-game's clock caps each frame at 0.05 s, so slow frames slow the game down (one win can take
// several minutes of wall time).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- m1: Raft Rush (hop onto the photo that fits the whole caption) ----------
// Reads host.__mg.state only to know which raft is the true one; moves with ← → like a player. Never force().
async function m1(p) {
  const mg = () => p.evaluate(() => {
    const h = document.querySelector('.puzzle-host'); const m = h?.__mg; const s = m?.state;
    if (!m) return { gone: true };
    return { status: m.status, outcome: m.outcome, stage: s?.stage, round: s?.round, at: s?.at,
      ans: s?.rafts ? s.rafts.findIndex((r) => r.answer) : -1, glued: s?.glued, splashes: s?.splashes };
  });
  const clickCard = async (label) => {
    const btn = p.locator('.puzzle-host .mg-card .etl-btn', { hasText: label });
    await btn.first().waitFor({ state: 'visible', timeout: 120000 });
    await btn.first().click();
  };
  await clickCard('Start');
  let tries = 1;
  const t0 = Date.now();
  while (Date.now() - t0 < 40 * 60000) {
    const s = await mg();
    if (s.gone || s.status === 'done') return;
    if (s.outcome === 'win' && (s.status === 'finish' || s.status === 'result')) {
      if (s.status === 'result') { await clickCard('Continue').catch(() => {}); }
      await p.waitForFunction(() => { const m = document.querySelector('.puzzle-host')?.__mg; return !m || m.status === 'done' || m.status === 'result'; }, null, { timeout: 120000, polling: 200 }).catch(() => {});
      continue;
    }
    if (s.status === 'retry') {
      if (++tries > 4) throw new Error(`lost Raft Rush ${tries - 1} times (last: ${s.glued} glued, ${s.splashes} splashes)`);
      await clickCard('Again');
      continue;
    }
    if (s.status === 'play' && s.stage === 'fuse' && s.ans >= 0 && s.at !== s.ans) {
      const key = s.ans < s.at ? 'ArrowLeft' : 'ArrowRight';
      for (let k = Math.abs(s.ans - s.at); k > 0; k--) await p.keyboard.press(key);
      // the hops register on the next game frame (one per key press, even at a low frame rate)
      await p.waitForFunction(([round, at]) => { const x = document.querySelector('.puzzle-host')?.__mg?.state; return !x || x.round !== round || x.at !== at || x.stage !== 'fuse'; },
        [s.round, s.at], { timeout: 120000, polling: 100 }).catch(() => {});
      continue;
    }
    await wait(120);
  }
  throw new Error('Raft Rush did not finish in 40 minutes');
}

// ---------- e1: The Banana Bet (snap 4 bananas the Snapper gets wrong, 6 shots of film) ----------
// Walkable spots beside each prop, where its '📷 Snap' prompt is the nearest one (checked before pressing E).
const STAND = {
  sketch: [-27.3, 3.4, -10.9], painting: [-2.75, 1.7, -4.25], float: [-5.5, 0, 3.25], sandcastle: [-22.3, -0.95, 8.4],
  teacup: [30.2, 0, 0.6], ladybird: [-20, 0, -1.5], crate: [24.3, -0.95, 8.3], boomerang: [-21.5, 1.7, -4.25],
  moon: [24.5, 0, -9.75], canoe: [6.5, -0.95, 8.25],
};
const nearestId = (p) => p.evaluate(() => {
  const ws = window.__etl.ws; const q = ws.player.pos; let best = null, bd = Infinity;
  for (const it of ws.interactables) {
    if (it.enabled === false) continue;
    const v = typeof it.pos === 'function' ? it.pos() : it.pos; const d = Math.hypot(v.x - q.x, v.z - q.z);
    if (d < (it.radius ?? 2) && Math.abs((v.y ?? 0) - q.y) < 1.2 && d < bd) { best = it; bd = d; }
  }
  return best ? (best.id || best.label) : null;
});
const propState = (p, id) => p.evaluate((pid) => {
  const it = window.__etl.ws.interactables.find((x) => x.id === pid);
  if (!it) return null;
  const v = typeof it.pos === 'function' ? it.pos() : it.pos;
  return { enabled: it.enabled !== false, pos: [v.x, v.y ?? 0, v.z] };
}, id);

async function snap(p, h, id) {
  const st = await propState(p, id);
  if (!st) throw new Error(`no Snap prop '${id}' in the world`);
  const [x, y, z] = st.pos;
  const spots = [STAND[id], [x + 1.1, y, z + 0.7], [x - 1.1, y, z + 0.7], [x, y, z + 1.2], [x + 1.4, y, z], [x - 1.4, y, z]].filter(Boolean);
  let ok = false;
  for (const s of spots) { await h.place(p, ...s); if (await nearestId(p) === id) { ok = true; break; } }
  if (!ok) throw new Error(`could not stand by '${id}' with its prompt nearest`);
  // E until the snap registers (a press right after a dialogue closes is swallowed by the game's cooldown)
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('KeyE');
    const done = await p.waitForFunction((pid) => document.querySelector('.dlg') || window.__etl.ws.interactables.find((x) => x.id === pid)?.enabled === false,
      id, { timeout: 8000, polling: 150 }).then(() => true).catch(() => false);
    if (done) break;
  }
  if ((await propState(p, id))?.enabled !== false && !(await p.$('.dlg'))) throw new Error(`E at '${id}' did nothing`);
  await p.waitForSelector('.dlg', { timeout: 60000 }); // Brine's verdict
  await h.drain(p);
}

async function e1(p, c, h) {
  // the bet starts once Brine's intro is read: on a very slow frame the harness may hand over before it shows,
  // so keep reading (Space) until the props are out
  const t0 = Date.now();
  while (!(await p.evaluate(() => window.__etl.ws.interactables.filter((x) => x.label === 'Snap').length >= 10))) {
    if (Date.now() - t0 > 180000) throw new Error('the Banana Bet never put its props out');
    if (await p.$('.dlg')) await p.keyboard.press('Space');
    await wait(300);
  }
  const need = c.spec.need ?? 4;
  const bananas = c.spec.props.filter((x) => x.counts).map((x) => x.id);
  if (bananas.length < need) throw new Error('not enough bananas in disguise in the spec');
  // four bananas in disguise, one shot each (no film wasted)
  for (const id of bananas.slice(0, need)) await snap(p, h, id);
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('etl-save-v1')).regions.clip?.solved?.e1 === true, null, { timeout: 120000, polling: 250 });
}

// ---------- q1: Scribbit's Three Questions (all right in one go) ----------
async function q1(p, c, h) {
  for (const [i, q] of c.questions.entries()) {
    const t0 = Date.now();
    for (;;) { // play through the previous answer's lines until this question's box is up
      const text = await p.evaluate(() => document.querySelector('.dlg-ask .dlg-text')?.textContent ?? null);
      if (text === q.question) break;
      if (text !== null) throw new Error(`question ${i + 1}: expected "${q.question}", got "${text}"`);
      if (Date.now() - t0 > 120000) throw new Error(`question ${i + 1} never came`);
      if (await p.$('.dlg')) await p.keyboard.press('Space');
      await wait(260);
    }
    const want = q.options[q.answer];
    const idx = await p.evaluate((w) => [...document.querySelectorAll('.dlg-ask .etl-btn')].findIndex((b) => b.textContent === w), want);
    if (idx < 0) throw new Error(`question ${i + 1}: no option "${want}"`);
    await p.click(`.dlg-ask .etl-btn >> nth=${idx}`);
    await p.waitForFunction((qq) => document.querySelector('.dlg-ask .dlg-text')?.textContent !== qq, q.question, { timeout: 60000 });
  }
  await h.drain(p);
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('etl-save-v1')).regions.clip?.solved?.q1 === true, null, { timeout: 120000, polling: 250 });
}

module.exports = { m1, e1, q1 };
