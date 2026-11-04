// Solvers for Attendale's extra pack (content/extra/attention.json), driven by test/play/extras-ingame.cjs.
// Real inputs only: mouse moves and clicks on the mini-game's dial and the dialogue buttons, typed numbers,
// E at the word posts and the board (the Speck is teleported next to them). Nothing calls the kit's force().
//   m1 (Who's It?): reads which word 'it' means and where its key flag is on the dial (host.__mg.state), points
//     the mouse at that flag and clicks; the ear swings there and rings. Replays from the Again card if a try is lost.
//   q1 (Lengthwise): answers the three questions from the challenge's own answer keys.
//   e1 (Ear Jobs): rings two word posts like a player would, then tags the four ears at Dabble's board.
// Every wait is on a condition with a generous timeout (the 3D scene may run at 1-5 fps).

const LONG = { timeout: 180000 };

// ---------------- m1: Who's It? ----------------
const mgState = (p) => p.evaluate(() => {
  const m = document.querySelector('.puzzle-host')?.__mg;
  if (!m) return { status: 'gone' };
  const S = m.state;
  if (!S || !S.rd || !S.flags) return { status: m.status };
  return { status: m.status, stage: S.stage, ri: S.ri, stageT: S.stageT, good: S.good, muddles: S.muddles, phi: S.flags[S.rd.means].phi, toWin: S.C?.toWin ?? 6 };
});
// where a dial angle (degrees, 0 = up, clockwise) is on the screen, on the ring between the pins and the outer pills
async function dialPoint(p, deg) {
  const box = await p.locator('.puzzle-host .mg-canvas').boundingBox();
  const r = 172, a = (deg * Math.PI) / 180;
  const x = 320 + r * Math.sin(a), y = 330 - r * Math.cos(a);
  return [box.x + (x / 960) * box.width, box.y + (y / 540) * box.height];
}

async function m1(p) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // the rules card (or the Again card after a lost try): click its primary button
    await p.waitForSelector('.puzzle-host .mg-card .etl-btn.primary', LONG);
    await p.click('.puzzle-host .mg-card .etl-btn.primary');
    await p.waitForFunction(() => { const m = document.querySelector('.puzzle-host')?.__mg; return !m || m.status === 'play'; }, null, LONG);
    for (let guard = 0; guard < 60; guard++) {
      // a fresh round, read for a moment
      await p.waitForFunction(() => {
        const m = document.querySelector('.puzzle-host')?.__mg;
        return !m || m.status !== 'play' || (m.state.stage === 'listen' && m.state.stageT > 0.3);
      }, null, LONG);
      const s = await mgState(p);
      if (s.status !== 'play') break;
      const [x, y] = await dialPoint(p, s.phi);
      await p.mouse.move(x, y, { steps: 4 });
      await p.mouse.down();
      await p.mouse.up();
      // the ear swings to the flag and rings: wait for this round to end
      await p.waitForFunction((ri) => {
        const m = document.querySelector('.puzzle-host')?.__mg;
        return !m || m.status !== 'play' || m.state.ri !== ri || m.state.stage !== 'listen';
      }, s.ri, LONG);
    }
    // FINISH! then the win card (▶ Continue) or the Again card
    await p.waitForFunction(() => {
      const m = document.querySelector('.puzzle-host')?.__mg;
      return !m || m.status === 'result' || m.status === 'done' || m.status === 'retry';
    }, null, LONG);
    const st = await p.evaluate(() => document.querySelector('.puzzle-host')?.__mg?.status || 'gone');
    if (st === 'retry') continue;
    if (st === 'result') await p.click('.puzzle-host .mg-card .etl-btn.primary').catch(() => { /* the card's own timer won */ });
    await p.waitForFunction(() => !document.querySelector('.puzzle-host'), null, LONG);
    return;
  }
  throw new Error('m1: no win in 4 tries');
}

// ---------------- q1: Lengthwise's questions ----------------
async function q1(p, c) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  for (let answered = 0; answered < c.questions.length;) {
    await p.waitForSelector('.dlg', LONG);
    const box = await p.evaluate(() => {
      const b = document.querySelector('.dlg');
      return b ? { ask: b.classList.contains('dlg-ask'), input: !!b.querySelector('.dlg-input'), text: b.querySelector('.dlg-text')?.textContent || '' } : null;
    });
    if (!box) continue;
    if (!box.ask) { await p.keyboard.press('Space'); await p.waitForTimeout(250); continue; } // a 'right' line
    const q = c.questions.find((x) => norm(x.question) === norm(box.text));
    if (!q) throw new Error(`q1: unknown question "${box.text}"`);
    if (box.input) {
      await p.fill('.dlg .dlg-input', String(q.answer));
      await p.keyboard.press('Enter');
    } else {
      await p.locator('.dlg-ask .etl-btn', { hasText: new RegExp(`^${String(q.options[q.answer]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
    }
    answered++;
    await p.waitForFunction((t) => (document.querySelector('.dlg-ask .dlg-text')?.textContent || '') !== t, box.text, LONG);
  }
}

// ---------------- e1: Ear Jobs ----------------
const earJobs = (p) => p.evaluate(() => { const r = window.__etl.ws.scene.getObjectByName('ear-jobs'); return r ? { query: r.userData.query, chosen: [...r.userData.chosen] } : null; });
// interactable finders for h.posOf (sent to the page as source, so they carry their numbers inline)
// eslint-disable-next-line no-new-func
const postAt = (i) => new Function('it', `return it.postIndex === ${Number(i)};`);
const theBoard = (it) => it.boardOf === 'e1';

// stand by an interactable and press E until `done` holds (a press during a scene cooldown is dropped)
async function useUntil(p, h, pick, done, arg) {
  for (let i = 0; i < 12; i++) {
    const q = await h.posOf(p, pick);
    if (!q) throw new Error('e1: interactable not found');
    await h.place(p, q[0] + 0.6, q[1], q[2] + 0.5);
    await p.keyboard.press('KeyE');
    try { await p.waitForFunction(done, arg, { timeout: 15000 }); return; } catch { /* again */ }
  }
  throw new Error('e1: pressing E did nothing');
}

async function e1(p, c, h) {
  await p.waitForFunction(() => !!window.__etl.ws.scene.getObjectByName('ear-jobs'), null, LONG);
  // ring 'gave' and then 'the', reading the strings like a player
  for (const i of [2, 0]) {
    await useUntil(p, h, postAt(i), (k) => window.__etl.ws.scene.getObjectByName('ear-jobs')?.userData.query === k, i);
    await p.waitForTimeout(600);
  }
  // tag the four ears on Dabble's board
  const spec = c.spec;
  const answerFor = (question) => {
    const ear = spec.ears.find((e) => question.includes(`${e.name}'s job`));
    if (!ear) throw new Error(`e1: unknown board question "${question}"`);
    return spec.tags.find((t) => t.id === spec.solution[ear.id]).label;
  };
  await useUntil(p, h, theBoard, () => !!document.querySelector('.dlg-ask'));
  for (let k = 0; k < spec.ears.length; k++) {
    await p.waitForSelector('.dlg-ask', LONG);
    const question = await p.evaluate(() => document.querySelector('.dlg-ask .dlg-text')?.textContent || '');
    const label = answerFor(question);
    await p.locator('.dlg-ask .etl-btn', { hasText: label }).first().click();
    await p.waitForFunction((t) => (document.querySelector('.dlg-ask .dlg-text')?.textContent || '') !== t, question, LONG);
  }
  const st = await earJobs(p); // (gone already if the finale was quick)
  if (st && st.chosen.some((x, k) => x !== spec.solution[spec.ears[k].id])) throw new Error(`e1: tags not set: ${JSON.stringify(st)}`);
  // the finale (tags fly, every ear fires) runs, then the puzzle is solved and Dabble speaks
  await p.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('etl-save-v1') || '{}');
    return !!s.regions?.attention?.solved?.e1;
  }, null, { timeout: 300000 });
  await p.waitForSelector('.dlg', LONG);
}

module.exports = { m1, q1, e1 };
