// Smoke test for the Python terminal (public/js/ui/terminal.js + js/workers/pyodide-worker.js) and the
// explain-it bubble (public/js/ui/explain.js), through their harness, public/dev/terminal.html.
//
//   node test/ui/terminal-smoke.cjs
//
// Uses a server on TERMINAL_TEST_PORT (default 3103) with the fixture region ("fixture": code1 + explain1);
// if none is running it starts one: REGIONS_DIR=server/test/fixtures/regions PORT=3103 node server/index.js
// No API key needed: explanations are graded offline (keywords). Pyodide comes from the jsDelivr CDN, so the
// browser needs the network (HTTPS_PROXY is honoured). One step waits out the real 20 s run timeout.
// Screenshots land in test-output/term-*.png and test-output/explain-*.png.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.TERMINAL_TEST_PORT || 3103);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'test-output');
const DRAFT_KEY = 'etl-code-fixture-code1';

const STARTER_HEAD = 'import numpy as np';
const WRONG_OVERFLOW = 'import numpy as np\n\n\ndef softmax(x):\n    e = np.exp(x)\n    return e / e.sum(axis=1, keepdims=True)\n';
const WRONG_GLOBAL = 'import numpy as np\n\n\ndef softmax(x):\n    e = np.exp(x - x.max())\n    return e / e.sum()\n';
const SYNTAX = 'import numpy as np\n\ndef softmax(x:\n    return x\n';
const LOOP = 'n = 0\nwhile True:\n    n += 1\n';
const RIGHT = 'import numpy as np\n\n\ndef softmax(x):\n    x = np.asarray(x, dtype=float)\n    e = np.exp(x - x.max(axis=1, keepdims=True))\n    return e / e.sum(axis=1, keepdims=True)\n';
const VAGUE = 'Because it makes things better and nicer for the lamps.';
const GOOD = 'They divide the scores by the square root of d_k. With big d_k the dot products get huge, which pushes the softmax into saturation where the gradients are tiny.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;

async function up() {
  try {
    const res = await fetch(`${BASE}/api/status`);
    return res.ok;
  } catch { return false; }
}

async function ensureServer() {
  if (!(await up())) {
    server = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), REGIONS_DIR: 'server/test/fixtures/regions' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    for (let i = 0; i < 80 && !(await up()); i++) await sleep(250);
    if (!(await up())) throw new Error(`server did not start on ${BASE}`);
  }
  const fixture = await fetch(`${BASE}/content/regions/fixture.json`);
  if (!fixture.ok) throw new Error(`the server on ${BASE} has no "fixture" region: start it with REGIONS_DIR=server/test/fixtures/regions`);
}

let passed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    console.log(`  ✗ ${name}`);
    throw err;
  }
}

const shot = async (page, name) => {
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

// ---- terminal helpers
const pyState = (page) => page.evaluate(() => document.querySelector('.term')?.dataset.py ?? null);
const waitPyReady = (page, timeout = 150000) =>
  page.waitForFunction(() => document.querySelector('.term')?.dataset.py === 'ready', null, { timeout });
const editorValue = (page) => page.$eval('.term-ta', (t) => t.value);
const setCode = (page, code) => page.fill('.term-ta', code);
const lastResult = (page) => page.evaluate(() => window.__term.last);
const closes = (page) => page.evaluate(() => window.__term.closes);
const modalOpen = (page) => page.evaluate(async () => (await import('/js/ui/modal.js')).isModalOpen());

async function runAndWait(page, act) {
  await page.click(`.term-key[data-act="${act}"]`);
  await page.waitForFunction(() => !document.querySelector('.term')?.classList.contains('is-busy') && document.querySelector('.term-log')?.childElementCount > 0, null, { timeout: 30000 });
}

async function consoleRows(page) {
  return page.$$eval('.term-log .term-row', (rows) => rows.map((r) => ({
    cls: r.className,
    mark: r.querySelector('.term-mark')?.textContent || '',
    name: r.querySelector('.term-name')?.textContent || '',
    why: r.querySelector('.term-why')?.textContent || '',
    text: r.textContent,
    line: r.querySelector('.term-lnk')?.textContent || '',
  })));
}

async function openTerminal(page) {
  await page.evaluate(() => { window.__term.go('code', 'code1'); });
  await page.waitForSelector('.term-overlay .term');
}

async function openExplain(page) {
  await page.evaluate(() => { window.__term.go('explain', 'explain1'); });
  await page.waitForSelector('.ex-bubble');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ proxy });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('terminal');
    await page.goto(`${BASE}/dev/terminal.html?mode=none`);
    await page.evaluate(() => localStorage.clear());

    await step('opens with the starter code, title tag, icon-only keys', async () => {
      await openTerminal(page);
      assert.ok((await editorValue(page)).startsWith(STARTER_HEAD));
      assert.equal(await page.$eval('.term-tag', (e) => e.textContent), 'Even Out the Glow');
      const keys = await page.$$eval('.term-key', (bs) => bs.map((b) => ({ act: b.dataset.act, text: b.textContent.trim(), tip: b.title })));
      assert.deepEqual(keys.map((k) => k.act).sort(), ['close', 'reset', 'run', 'test']);
      for (const k of keys) {
        assert.equal(k.text, '', `key ${k.act} must be an icon, not words`);
        assert.ok(k.tip, `key ${k.act} needs a tooltip`);
      }
      assert.ok(await page.$eval('.term-prompt', (e) => e.querySelector('ul.md-list li strong') && e.querySelector('.md-code')), 'the prompt markdown is rendered');
      assert.ok(await modalOpen(page), 'the terminal is in the modal stack');
      await shot(page, 'term-open');
    });

    await step('python loads (small spinner while it does)', async () => {
      const state = await pyState(page);
      if (state !== 'ready') assert.equal(await page.$eval('.term-spin', (s) => s.hidden), false, 'spinner while loading');
      await waitPyReady(page);
      assert.equal(await page.$eval('.term-spin', (s) => s.hidden), true);
    });

    await step('starter code fails every test, with the reason and the line', async () => {
      await runAndWait(page, 'test');
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '0/6');
      const rows = await consoleRows(page);
      assert.equal(rows.length, 6);
      assert.ok(rows.every((r) => r.mark === '✗'));
      assert.match(rows[0].why, /NotImplementedError/);
      assert.equal(rows[0].line, '7');
      assert.equal(rows.filter((r) => r.why).length, 1, 'the same reason is said once');
      assert.equal(await page.$eval('.term-ln.bad', (e) => e.textContent), '7', 'the gutter marks the failing line');
      await shot(page, 'term-starter');
    });

    await step('editor: Tab, auto-indent, dedent after return, Shift+Tab, soft backspace, undo', async () => {
      await page.click('.term-ta');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type('def f(x):');
      await page.keyboard.press('Enter');
      assert.equal(await editorValue(page), 'def f(x):\n    ');
      await page.keyboard.type('return x');
      await page.keyboard.press('Enter');
      assert.equal(await editorValue(page), 'def f(x):\n    return x\n');
      await page.keyboard.press('Tab');
      assert.equal(await editorValue(page), 'def f(x):\n    return x\n    ');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await editorValue(page), 'def f(x):\n    return x\n    ');
      await page.keyboard.press('Backspace');
      assert.equal(await editorValue(page), 'def f(x):\n    return x\n', 'backspace removes a whole indent');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Tab');
      assert.equal(await editorValue(page), '    def f(x):\n        return x\n', 'Tab indents a selected block');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await editorValue(page), 'def f(x):\n    return x\n', 'Shift+Tab dedents it');
      await page.keyboard.press('Control+Z');
      assert.equal(await editorValue(page), '    def f(x):\n        return x\n', 'Ctrl+Z undoes our edits');
      const gutter = await page.$$eval('.term-ln', (ls) => ls.length);
      assert.equal(gutter, 3);
    });

    await step('a wrong solution fails with the test message (overflow)', async () => {
      await setCode(page, WRONG_OVERFLOW);
      await runAndWait(page, 'test');
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '5/6');
      const bad = (await consoleRows(page)).filter((r) => r.mark === '✗');
      assert.equal(bad.length, 1);
      assert.equal(bad[0].name, 'large values are stable');
      assert.equal(bad[0].why, 'huge scores must not overflow into nan or inf');
      await shot(page, 'term-wrong');
    });

    await step('another wrong solution (whole-array softmax) fails, Ctrl+Enter runs the tests', async () => {
      await setCode(page, WRONG_GLOBAL);
      await page.focus('.term-ta');
      await page.keyboard.press('Control+Enter');
      await page.waitForSelector('.term-sum', { timeout: 30000 });
      const bad = (await consoleRows(page)).filter((r) => r.mark === '✗').map((r) => r.why);
      assert.ok(bad.includes('every row must sum to 1'), bad.join(' | '));
    });

    await step('a syntax error points at its line', async () => {
      await setCode(page, SYNTAX);
      await runAndWait(page, 'run');
      const rows = await consoleRows(page);
      assert.match(rows[0].text, /SyntaxError/);
      assert.equal(rows[0].line, '3');
      await page.click('.term-lnk');
      const sel = await page.$eval('.term-ta', (t) => t.value.slice(0, t.selectionStart).split('\n').length);
      assert.equal(sel, 3, 'clicking the line badge jumps there');
    });

    await step('▶ runs code and shows stdout + stderr', async () => {
      await setCode(page, 'import sys\nprint("glow", 6 * 7)\nprint("hot", file=sys.stderr)\n');
      await runAndWait(page, 'run');
      assert.equal(await page.$eval('.term-stdout', (e) => e.textContent), 'glow 42');
      assert.equal(await page.$eval('.term-stderr', (e) => e.textContent), 'hot');
      assert.equal(await page.$$eval('.term-sum', (s) => s.length), 0, 'run does not run the tests');
    });

    await step('drafts autosave and come back after a reload', async () => {
      await setCode(page, WRONG_OVERFLOW);
      await sleep(450);
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY), WRONG_OVERFLOW);
      await page.goto(`${BASE}/dev/terminal.html?mode=terminal&challenge=code1`);
      await page.waitForSelector('.term');
      assert.equal(await editorValue(page), WRONG_OVERFLOW);
      await waitPyReady(page);
    });

    await step('■ stops a running program at once and Python comes back', async () => {
      await setCode(page, LOOP);
      await page.click('.term-key[data-act="run"]');
      await page.waitForFunction(() => document.querySelector('.term')?.dataset.py === 'running', null, { timeout: 30000 });
      await sleep(600);
      assert.equal(await page.$eval('.term-key[data-act="test"]', (b) => b.disabled), true, 'no testing while running');
      const t0 = Date.now();
      await page.click('.term-key[data-act="run"]');           // now the stop key
      await page.waitForSelector('.term-row.muted[title="Stopped"]', { timeout: 5000 });
      assert.ok(Date.now() - t0 < 3000);
      await waitPyReady(page);
    });

    await step('an infinite loop hits the 20 s timeout, then the terminal recovers', async () => {
      await setCode(page, LOOP);
      const t0 = Date.now();
      await page.keyboard.press('Control+Shift+Enter');
      await page.waitForFunction(() => document.querySelector('.term')?.dataset.py === 'running', null, { timeout: 30000 });
      await shot(page, 'term-running');
      await page.waitForSelector('.term-row.warn', { timeout: 40000 });
      const took = Date.now() - t0;
      assert.ok(took >= 19000 && took < 32000, `timeout after ${took}ms`);
      assert.match(await page.$eval('.term-row.warn', (r) => r.textContent), /too long/);
      await shot(page, 'term-timeout');
      await waitPyReady(page);
      await setCode(page, 'print(sum(range(10)))\n');
      await runAndWait(page, 'run');
      assert.equal(await page.$eval('.term-stdout', (e) => e.textContent), '45', 'a fresh worker runs code again');
    });

    await step('↺ needs a second click, then restores the starter', async () => {
      await page.click('.term-key[data-act="reset"]');
      assert.ok(!(await editorValue(page)).startsWith(STARTER_HEAD), 'one click does not reset');
      assert.ok(await page.$eval('.term-key[data-act="reset"]', (b) => b.classList.contains('armed')));
      await page.click('.term-key[data-act="reset"]');
      assert.ok((await editorValue(page)).startsWith(STARTER_HEAD));
      assert.match(await editorValue(page), /NotImplementedError/);
    });

    await step('Esc closes with solved: false and removes the terminal', async () => {
      const before = await closes(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before);
      const res = await lastResult(page);
      assert.equal(res.solved, false);
      assert.match(res.code, /NotImplementedError/);
      await page.waitForFunction(() => !document.querySelector('.term-overlay'));
      assert.equal(await modalOpen(page), false);
    });

    await step('the right solution passes: confetti, then resolves { solved: true, code }', async () => {
      await openTerminal(page);
      await waitPyReady(page);
      await setCode(page, RIGHT);
      const before = await closes(page);
      await page.click('.term-key[data-act="test"]');
      await page.waitForSelector('.term-stamp', { timeout: 30000 });
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '6/6');
      assert.ok(await page.$$eval('.term-confetti .cf', (c) => c.length) > 20, 'paper confetti');
      await shot(page, 'term-solved');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before, { timeout: 8000 });
      const res = await lastResult(page);
      assert.deepEqual(res, { solved: true, code: RIGHT });
      await page.waitForFunction(() => !document.querySelector('.term-overlay'));
      assert.equal(await modalOpen(page), false);
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY), RIGHT);
    });

    console.log('explain');

    await step('opens as a speech bubble: name tag, question, icon keys, offline mark', async () => {
      await page.evaluate(() => localStorage.removeItem('etl-explain-fixture-explain1'));
      await openExplain(page);
      assert.equal(await page.$eval('.ex-tag', (e) => e.textContent), 'Elder Moss');
      assert.match(await page.$eval('.ex-q', (e) => e.textContent), /Why do they scale the scores/);
      await page.waitForSelector('.ex-off:not([hidden])', { timeout: 5000 });
      const keys = await page.$$eval('.ex-key:not([hidden])', (bs) => bs.map((b) => ({ act: b.dataset.act, text: b.textContent.trim(), tip: b.title, disabled: b.disabled })));
      assert.deepEqual(keys.map((k) => k.act), ['later', 'send']);
      assert.ok(keys.every((k) => !k.text && k.tip));
      assert.equal(keys[1].disabled, true, 'nothing to send yet');
      assert.equal(await page.$eval('.ex-count', (e) => e.textContent), '0');
      await shot(page, 'explain-open');
    });

    await step('a vague answer fails with feedback; ↺ retry and ✕ later appear', async () => {
      await page.keyboard.type(VAGUE);
      assert.equal(await page.$eval('.ex-count', (e) => e.textContent), String(VAGUE.split(/\s+/).length));
      await page.click('.ex-key[data-act="send"]');
      await page.waitForSelector('.ex-reply[data-mood="fail"]', { timeout: 15000 });
      await sleep(900);
      assert.match(await page.$eval('.ex-reply-text', (e) => e.textContent), /big numbers trouble the softmax/);
      assert.doesNotMatch(await page.$eval('.ex-reply-text', (e) => e.textContent), /key ideas/, 'the offline tally is shown as a meter, not words');
      const keys = await page.$$eval('.ex-key:not([hidden])', (bs) => bs.map((b) => b.dataset.act));
      assert.deepEqual(keys, ['later', 'retry']);
      await shot(page, 'explain-fail');
    });

    await step('✕ later resolves { pass: false } with the feedback; the draft is kept', async () => {
      const before = await closes(page);
      await page.click('.ex-key[data-act="later"]');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before);
      const res = await lastResult(page);
      assert.equal(res.pass, false);
      assert.match(res.feedback, /big numbers/);
      assert.equal(await modalOpen(page), false);
      await openExplain(page);
      assert.equal(await page.$eval('.ex-ta', (t) => t.value), VAGUE, 'the answer is still there');
    });

    await step('network trouble shows "…?" and lets you send again', async () => {
      await page.route('**/api/grade', (route) => route.abort());
      await page.click('.ex-key[data-act="send"]');
      await page.waitForSelector('.ex-reply[data-mood="error"]', { timeout: 15000 });
      assert.equal(await page.$eval('.ex-reply-text', (e) => e.textContent), '…?');
      assert.equal(await page.$eval('.ex-key[data-act="send"]', (b) => b.hidden || b.disabled), false);
      await page.unroute('**/api/grade');
    });

    await step('a good answer passes; ✓ continue resolves { pass: true }', async () => {
      await page.fill('.ex-ta', GOOD);
      await page.keyboard.press('Control+Enter');
      await page.waitForSelector('.ex-reply[data-mood="pass"]', { timeout: 15000 });
      await sleep(900);
      assert.deepEqual(await page.$$eval('.ex-key:not([hidden])', (bs) => bs.map((b) => b.dataset.act)), ['done']);
      await shot(page, 'explain-pass');
      const before = await closes(page);
      await page.click('.ex-key[data-act="done"]');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before);
      const res = await lastResult(page);
      assert.equal(res.pass, true);
      assert.ok(res.feedback.length > 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('etl-explain-fixture-explain1')), null, 'a passed draft is cleared');
      assert.equal(await modalOpen(page), false);
    });

    await step('fundamental-shaped challenge ({ id, type, title, question, rubric, offline }) works too', async () => {
      const done = page.evaluate(async () => {
        const ex = await import('/js/ui/explain.js');
        return ex.open({
          challenge: { id: 'explain1', type: 'explain', title: 'Scaling', question: 'Why `/ sqrt(d_k)`?', rubric: ['r'], offline: [['sqrt']] },
          regionId: 'fixture',
          speaker: { name: 'Pip' },
        });
      });
      await page.waitForSelector('.ex-bubble');
      assert.equal(await page.$eval('.ex-tag', (e) => e.textContent), 'Pip');
      assert.equal(await page.$eval('.ex-q code', (e) => e.textContent), '/ sqrt(d_k)');
      await page.fill('.ex-ta', GOOD);
      await page.click('.ex-key[data-act="send"]');
      await page.waitForSelector('.ex-reply[data-mood="pass"]', { timeout: 15000 });
      await page.keyboard.press('Escape');
      const res = await done;
      assert.equal(res.pass, true, 'Esc after passing still counts as a pass');
    });

    await step('phone-sized screens still fit', async () => {
      await page.setViewportSize({ width: 390, height: 780 });
      await openTerminal(page);
      await sleep(300);
      const fits = await page.$eval('.term', (e) => { const r = e.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
      assert.ok(fits);
      await shot(page, 'term-phone');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.term-overlay'));
      await openExplain(page);
      await shot(page, 'explain-phone');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page errors');
    console.log(`\n${passed} passed`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
})().catch((err) => {
  console.error(err);
  if (server) server.kill();
  process.exit(1);
});
