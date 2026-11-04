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
//
// Text rule (docs/ARCHITECTURE.md, "Concise text"): every key says what it does in a word or two (icon
// optional, shortcuts in tooltips), results read as a summary ("4 / 6 tests pass") plus each failing
// test's own message, and every state says what is going on in one short line (Loading Python…,
// Thinking…, ✗ Not yet, ✓ Passed!); nothing else.
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
const EXPLAIN_KEY = 'etl-explain-fixture-explain1';

const STARTER_HEAD = 'import numpy as np';
const WRONG_OVERFLOW = 'import numpy as np\n\n\ndef softmax(x):\n    e = np.exp(x)\n    return e / e.sum(axis=1, keepdims=True)\n';
const WRONG_GLOBAL = 'import numpy as np\n\n\ndef softmax(x):\n    e = np.exp(x - x.max())\n    return e / e.sum()\n';
const SYNTAX = 'import numpy as np\n\ndef softmax(x:\n    return x\n';
const LOOP = 'n = 0\nwhile True:\n    n += 1\n';
const RIGHT = 'import numpy as np\n\n\ndef softmax(x):\n    x = np.asarray(x, dtype=float)\n    e = np.exp(x - x.max(axis=1, keepdims=True))\n    return e / e.sum(axis=1, keepdims=True)\n';
// a shape bug: the row sums use the wrong length, so every non-square input crashes on line 7, each test
// with its own shapes in numpy's message
const SHAPE = 'import numpy as np\n\n\ndef softmax(x):\n    x = np.asarray(x, dtype=float)\n    e = np.exp(x - x.max(axis=1, keepdims=True))\n    sums = e @ np.ones(x.shape[0])\n    return e / sums[:, None]\n';
// crashes on two lines: one-row inputs on line 7, the four-row input on line 9
const TWO_CRASHES = 'import numpy as np\n\n\ndef softmax(x):\n    x = np.asarray(x, dtype=float)\n    if len(x) == 1:\n        return x.glow\n    if len(x) == 4:\n        return x.hum\n    e = np.exp(x - x.max(axis=1, keepdims=True))\n    return e / e.sum(axis=1, keepdims=True)\n';
// prints while the tests run (and overflows, so one test fails)
const PRINTS = 'import numpy as np\n\n\ndef softmax(x):\n    print("rows", len(x))\n    e = np.exp(x)\n    return e / e.sum(axis=1, keepdims=True)\n';
// a run that vandalises the shared interpreter; the next run must not notice
const VANDAL = 'import builtins, math, sys, warnings\nimport numpy as np\nnp.exp = lambda x: x * 0\nnp.seterr(all="raise")\nbuiltins.len = lambda x: 0\nmath.sqrt = None\nsys.setrecursionlimit(60)\nwarnings.simplefilter("error")\nnp.extra = 1\n';
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
const draft = (page, key = DRAFT_KEY) => page.evaluate((k) => localStorage.getItem(k), key);

async function runAndWait(page, act, timeout = 30000) {
  await page.click(`.term-key[data-act="${act}"]`);
  await page.waitForFunction(() => !document.querySelector('.term')?.classList.contains('is-busy') && document.querySelector('.term-log')?.childElementCount > 0, null, { timeout });
}

async function consoleRows(page) {
  return page.$$eval('.term-log .term-row', (rows) => rows.map((r) => ({
    cls: r.className,
    mark: r.querySelector('.term-mark')?.textContent || '',
    msg: r.querySelector('.term-msg')?.textContent || '',
    text: r.textContent,
    tip: r.title,
    line: r.querySelector('.term-lnk')?.textContent || '',
    count: r.querySelector('.term-count')?.textContent || '',
  })));
}

const pips = (page) => page.$$eval('.term-pips i', (is) => is.map((i) => ({ ok: i.classList.contains('ok'), sel: i.classList.contains('sel'), tip: i.title })));
const words = (s) => (String(s).match(/\S+/g) || []).length;
// what a key says on screen (innerText skips the hidden twin label, e.g. "Stop" behind "Run")
const keyWords = (page, act) => page.$eval(`.term-key[data-act="${act}"]`, (b) => b.innerText.trim().replace(/\s+/g, ' '));
const statusLine = (page) => page.$eval('.term-status', (s) => (s.hidden ? '' : s.innerText.trim()));

// a closed UI fades out for ~200 ms before its DOM goes; never mistake it for the next one
const gone = (page) => page.waitForFunction(() => !document.querySelector('.term-overlay, .ex-overlay'));

async function openTerminal(page) {
  await gone(page);
  await page.evaluate(() => { window.__term.go('code', 'code1'); });
  await page.waitForSelector('.term-overlay .term');
}

async function openExplain(page) {
  await gone(page);
  await page.evaluate(() => { window.__term.go('explain', 'explain1'); });
  await page.waitForSelector('.ex-bubble');
}

const exKeys = (page) => page.$$eval('.ex-key:not([hidden])', (bs) => bs.map((b) => b.dataset.act));
const exKeyWords = (page) => page.$$eval('.ex-key:not([hidden])', (bs) => bs.map((b) => [b.dataset.act, b.innerText.trim()]));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ proxy, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    console.log('terminal');
    await page.goto(`${BASE}/dev/terminal.html?mode=none`);
    await page.evaluate(() => localStorage.clear());

    await step('opens with the starter code, title tag, and keys that say what they do', async () => {
      await openTerminal(page);
      assert.ok((await editorValue(page)).startsWith(STARTER_HEAD));
      assert.equal(await page.$eval('.term-tag', (e) => e.textContent), 'Even Out the Glow');
      const keys = await page.$$eval('.term-key', (bs) => bs.map((b) => ({
        act: b.dataset.act, text: b.innerText.trim().replace(/\s+/g, ' '), tip: b.title, icon: !!b.querySelector('.etl-ico svg'),
      })));
      assert.deepEqual(Object.fromEntries(keys.map((k) => [k.act, k.text])), { close: 'Close', run: 'Run', test: 'Run tests', reset: 'Reset code' });
      for (const k of keys) {
        assert.ok(words(k.text) >= 1 && words(k.text) <= 3, `key ${k.act} says what it does in 1-3 words: ${JSON.stringify(k.text)}`);
        assert.ok(k.icon, `key ${k.act} keeps its icon beside the word`);
        assert.ok(k.tip, `key ${k.act} has a tooltip`);
      }
      assert.match(keys.find((k) => k.act === 'test').tip, /Ctrl\+Enter/, 'shortcuts live in the tooltips');
      assert.ok(await page.$eval('.term-prompt', (e) => e.querySelector('ul.md-list li strong') && e.querySelector('.md-code')), 'the prompt markdown is rendered');
      assert.ok(await page.$eval('.term-prompt', (e) => e.querySelector('.md-code.md-nowrap')), 'short code chips do not wrap');
      assert.ok(await modalOpen(page), 'the terminal is in the modal stack');
      await shot(page, 'term-open');
    });

    await step('python loads, with a status line ("Loading Python…") until it is ready', async () => {
      const state = await pyState(page);
      if (state !== 'ready') assert.equal(await statusLine(page), 'Loading Python…');
      await waitPyReady(page);
      assert.equal(await statusLine(page), '', 'the status line goes once Python is ready');
    });

    await step('starter code: "0 / 6 tests pass"; six tests failing the same way are said once, with their line', async () => {
      await runAndWait(page, 'test');
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '0 / 6 tests pass');
      const ps = await pips(page);
      assert.equal(ps.length, 6);
      assert.ok(ps.every((p) => !p.ok));
      assert.match(ps[0].tip, /^keeps shape and rows sum to one\nNotImplementedError/, 'a pip tooltip has the test name and why it failed');
      const rows = await consoleRows(page);
      assert.equal(rows.length, 1, 'the same failure is not repeated six times');
      assert.equal(rows[0].mark, '✗');
      assert.match(rows[0].msg, /NotImplementedError/);
      assert.equal(rows[0].count, '6 tests');
      assert.equal(rows[0].line, 'line 7');
      const tip = rows[0].tip.split('\n');
      assert.deepEqual(tip.slice(0, 2), ['keeps shape and rows sum to one', 'known values'], 'the test names are in the tooltip');
      assert.equal(tip.at(-1), 'line 7: raise NotImplementedError', 'and the trace');
      assert.equal(await page.$eval('.term-ln.bad', (e) => e.textContent), '7', 'the gutter marks the failing line');
      assert.doesNotMatch(rows[0].cls, /\b(pickable|sel)\b/, 'one line to mark: nothing to pick');
      const text = await page.$eval('.term-log', (e) => e.innerText);
      assert.ok(words(text) <= 12, `the console stays short: ${JSON.stringify(text)}`);
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
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '5 / 6 tests pass');
      assert.deepEqual((await pips(page)).map((p) => p.ok), [true, true, true, true, false, true]);
      const rows = await consoleRows(page);
      assert.equal(rows.length, 1, 'passing tests get no rows');
      assert.equal(rows[0].msg, 'huge scores must not overflow into nan or inf');
      assert.equal(rows[0].count, '', 'one test: no count');
      assert.equal(rows[0].tip, 'large values are stable');
      await shot(page, 'term-wrong');
    });

    await step('another wrong solution: Ctrl+Enter tests; each failing test says its own message; with no line to mark, the rows are plain', async () => {
      await setCode(page, WRONG_GLOBAL);
      await page.focus('.term-ta');
      await page.keyboard.press('Control+Enter');
      await page.waitForSelector('.term-sum', { timeout: 30000 });
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '4 / 6 tests pass');
      const rows = await consoleRows(page);
      assert.deepEqual(rows.map((r) => r.msg), ['every row must sum to 1', 'row 0 must be the softmax of row 0 alone'], 'every failure, in test order');
      assert.ok(rows.every((r) => !/\b(pickable|sel)\b/.test(r.cls)), 'assertion failures have no line: nothing looks pickable or picked');
      assert.equal(await page.$$eval('.term-pips i.pick, .term-pips i.sel', (is) => is.length), 0, 'and no pip is');
      await page.click('.term-pips i.bad >> nth=1');
      assert.ok((await consoleRows(page)).every((r) => !/\bsel\b/.test(r.cls)), 'a red pip picks nothing');
      assert.equal(await page.$('.term-ln.bad'), null, 'no line is marked');
      await shot(page, 'term-wrong-two');
    });

    await step('a shape bug crashing every test on one line (numpy names other shapes each time) is one row: the first message, "4 tests", the line', async () => {
      await setCode(page, SHAPE);
      await runAndWait(page, 'test');
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '2 / 6 tests pass');
      const rows = await consoleRows(page);
      assert.equal(rows.length, 1, `one row, not one per shape: ${JSON.stringify(rows.map((r) => r.msg))}`);
      assert.match(rows[0].msg, /^ValueError: matmul: .*\(size 2 is different from 3\)$/, 'the first failing test\'s own message');
      assert.equal(rows[0].count, '4 tests');
      assert.equal(rows[0].line, 'line 7');
      assert.equal(await page.$eval('.term-ln.bad', (e) => e.textContent), '7');
      const tip = rows[0].tip.split('\n');
      assert.equal(tip.length, 5, 'each test with its own message, then the trace');
      assert.match(tip[0], /^keeps shape and rows sum to one — ValueError: matmul: .*\(size 2 is different from 3\)$/);
      assert.match(tip[1], /^known values — ValueError: matmul: .*\(size 1 is different from 2\)$/);
      assert.equal(tip.at(-1), 'line 7: sums = e @ np.ones(x.shape[0])');
      const msgs = (await pips(page)).filter((p) => !p.ok).map((p) => p.tip.split('\n')[1]);
      assert.equal(new Set(msgs).size, 4, 'each pip keeps its own test\'s message');
      await shot(page, 'term-shape-crash');
    });

    await step('crashes on two lines: two rows, the first one\'s line marked; a row or a red pip picks the other', async () => {
      await setCode(page, TWO_CRASHES);
      await runAndWait(page, 'test');
      let rows = await consoleRows(page);
      assert.deepEqual(rows.map((r) => [r.line, r.count]), [['line 7', '2 tests'], ['line 9', '']]);
      assert.ok(rows.every((r) => /\bpickable\b/.test(r.cls)), 'a choice of lines: the rows can be picked');
      assert.deepEqual(rows.map((r) => /\bsel\b/.test(r.cls)), [true, false], 'the first one is picked');
      assert.equal(await page.$eval('.term-ln.bad', (e) => e.textContent), '7');
      await page.click('.term-log .term-fail >> nth=1');
      rows = await consoleRows(page);
      assert.deepEqual(rows.map((r) => /\bsel\b/.test(r.cls)), [false, true], 'clicking a row picks it');
      assert.equal(await page.$eval('.term-ln.bad', (e) => e.textContent), '9', 'and marks its line');
      assert.deepEqual((await pips(page)).map((p) => p.sel), [false, false, false, true, false, false]);
      await page.click('.term-pips i.pick >> nth=0');
      assert.deepEqual((await pips(page)).map((p) => p.sel), [false, true, false, false, true, false], 'so does a red pip');
      assert.equal(await page.$eval('.term-ln.bad', (e) => e.textContent), '7');
      await shot(page, 'term-two-crashes');
    });

    await step('print() output from a test run sits right under the summary, before the failures', async () => {
      await setCode(page, PRINTS);
      await runAndWait(page, 'test');
      const order = await page.$$eval('.term-log > *', (els) => els.map((e) => e.className.split(' ')[0]));
      assert.equal(order[0], 'term-sum');
      assert.equal(order[1], 'term-stdout', `the prints come next: ${JSON.stringify(order)}`);
      assert.ok(order.lastIndexOf('term-stdout') < order.indexOf('term-row') && order.indexOf('term-row') > 0, `then the failures: ${JSON.stringify(order)}`);
      assert.match(await page.$eval('.term-stdout', (e) => e.textContent), /^rows 2\nrows 1\nrows 2\nrows 4\n/, 'what each test printed, in order');
    });

    await step('a syntax error points at its line', async () => {
      await setCode(page, SYNTAX);
      await runAndWait(page, 'run');
      const rows = await consoleRows(page);
      assert.match(rows[0].text, /SyntaxError/);
      assert.equal(rows[0].line, 'line 3');
      await page.click('.term-lnk');
      const sel = await page.$eval('.term-ta', (t) => t.value.slice(0, t.selectionStart).split('\n').length);
      assert.equal(sel, 3, 'clicking the line badge jumps there');
    });

    await step('runaway recursion: one row, the repeated frame said once (×N) in the tooltip', async () => {
      await setCode(page, 'def f(n):\n    return f(n + 1)\n\nf(0)\n');
      await runAndWait(page, 'run');
      const rows = await consoleRows(page);
      assert.equal(rows.length, 1);
      assert.match(rows[0].msg, /RecursionError/);
      assert.match(rows[0].tip, /^line 4: f\(0\)\nline 2: return f\(n \+ 1\)  ×\d+$/);
    });

    await step('▶ Run runs code and shows stdout + stderr; a quiet run says so', async () => {
      await setCode(page, 'import sys\nprint("glow", 6 * 7)\nprint("hot", file=sys.stderr)\n');
      await runAndWait(page, 'run');
      assert.equal(await page.$eval('.term-stdout', (e) => e.textContent), 'glow 42');
      assert.equal(await page.$eval('.term-stderr', (e) => e.textContent), 'hot');
      assert.equal(await page.$$eval('.term-sum', (s) => s.length), 0, 'run does not run the tests');
      await setCode(page, 'x = 6 * 7\n');
      await runAndWait(page, 'run');
      assert.deepEqual((await consoleRows(page)).map((r) => r.msg), ['Ran fine. Nothing printed.']);
    });

    await step('drafts autosave and come back after a reload', async () => {
      await setCode(page, WRONG_OVERFLOW);
      await sleep(450);
      assert.equal(await draft(page), WRONG_OVERFLOW);
      await page.goto(`${BASE}/dev/terminal.html?mode=terminal&challenge=code1`);
      await page.waitForSelector('.term');
      assert.equal(await editorValue(page), WRONG_OVERFLOW);
      await waitPyReady(page);
    });

    await step('■ Stop stops a running program at once and Python comes back', async () => {
      await setCode(page, LOOP);
      const width = await page.$eval('.term-key[data-act="run"]', (b) => b.offsetWidth);
      await page.click('.term-key[data-act="run"]');
      await page.waitForFunction(() => document.querySelector('.term')?.dataset.py === 'running', null, { timeout: 30000 });
      await sleep(600);
      assert.equal(await keyWords(page, 'run'), 'Stop', 'the run key becomes Stop');
      assert.equal(await page.$eval('.term-key[data-act="run"]', (b) => b.offsetWidth), width, 'without changing size');
      assert.equal(await statusLine(page), 'Running…');
      assert.equal(await page.$eval('.term-key[data-act="test"]', (b) => b.disabled), true, 'no testing while running');
      const t0 = Date.now();
      await page.click('.term-key[data-act="run"]');           // now the stop key
      await page.waitForFunction(() => document.querySelector('.term-log .term-row.muted')?.innerText.trim() === 'Stopped', null, { timeout: 5000 });
      assert.ok(Date.now() - t0 < 3000);
      assert.equal(await keyWords(page, 'run'), 'Run');
      if (await pyState(page) === 'loading') assert.equal(await statusLine(page), 'Restarting Python…', 'a fresh Python is a restart, not a first load');
      await waitPyReady(page);
      assert.equal(await statusLine(page), '');
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
      assert.equal(await page.$eval('.term-row.warn', (r) => r.textContent), 'Stopped after 20 s. Endless loop?');
      await shot(page, 'term-timeout');
      await waitPyReady(page);
      await setCode(page, 'print(sum(range(10)))\n');
      await runAndWait(page, 'run');
      assert.equal(await page.$eval('.term-stdout', (e) => e.textContent), '45', 'a fresh worker runs code again');
    });

    await step('↺ Reset code asks "Sure?" in its own spot (the key keeps its width), then restores the starter', async () => {
      const key = '.term-key[data-act="reset"]';
      const width = await page.$eval(key, (b) => b.offsetWidth);
      await page.click(key);
      assert.ok(!(await editorValue(page)).startsWith(STARTER_HEAD), 'one press does not reset');
      assert.ok(await page.$eval(key, (b) => b.classList.contains('armed')));
      assert.equal(await keyWords(page, 'reset'), 'Sure?');
      assert.equal(await page.$eval(key, (b) => b.offsetWidth), width, 'the armed key is no wider');
      assert.equal(await page.$eval(key, (b) => b.title), 'Click again to reset', 'the details are in the tooltip');
      await page.click(key);
      assert.ok((await editorValue(page)).startsWith(STARTER_HEAD));
      assert.match(await editorValue(page), /NotImplementedError/);
      assert.equal(await keyWords(page, 'reset'), 'Reset code');
      assert.equal(await page.$eval(key, (b) => b.title), 'Back to the starter code');
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

    await step('one run cannot change the next (monkeypatched numpy, builtins, recursion limit...)', async () => {
      await openTerminal(page);
      await waitPyReady(page);
      await setCode(page, VANDAL);
      await runAndWait(page, 'run');
      await setCode(page, 'import math, sys\nimport numpy as np\nprint(hasattr(np, "extra"), np.geterr()["over"], math.sqrt(4), len([1, 2]), sys.getrecursionlimit() > 100)\n');
      await runAndWait(page, 'run');
      assert.equal(await page.$eval('.term-stdout', (e) => e.textContent), 'False warn 2.0 2 True');
    });

    await step('the right solution passes: confetti, { solved: true, code }, and the draft is gone', async () => {
      await setCode(page, RIGHT);
      await sleep(450);
      assert.equal(await draft(page), RIGHT, 'a draft while working on it');
      const before = await closes(page);
      await page.click('.term-key[data-act="test"]');
      await page.waitForSelector('.term-stamp', { timeout: 30000 });
      assert.equal(await page.$eval('.term-sum b', (b) => b.textContent), '6 / 6 tests pass');
      assert.equal((await consoleRows(page)).length, 0, 'a full pass is just the summary and pips');
      assert.equal(await page.$eval('.term-stamp', (e) => e.textContent), 'Solved!');
      assert.ok(await page.$$eval('.term-confetti .cf', (c) => c.length) > 20, 'paper confetti');
      await shot(page, 'term-solved');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before, { timeout: 8000 });
      const res = await lastResult(page);
      assert.deepEqual(res, { solved: true, code: RIGHT });
      await page.waitForFunction(() => !document.querySelector('.term-overlay'));
      assert.equal(await modalOpen(page), false);
      assert.equal(await draft(page), null, 'a solved challenge leaves no draft behind');
    });

    await step('New Game (resetSave) then reopening shows the starter, not the old solution', async () => {
      await page.evaluate(async () => (await import('/js/game/save.js')).resetSave());
      await openTerminal(page);
      const code = await editorValue(page);
      assert.ok(code.startsWith(STARTER_HEAD) && /NotImplementedError/.test(code), code);
      await page.keyboard.press('Escape');
      await gone(page);
      await page.evaluate((k) => localStorage.removeItem(k), DRAFT_KEY);
    });

    await step('a challenge without tests never counts as solved ("No tests found")', async () => {
      for (const tests of ['', undefined, 'import numpy as np\n']) {
        const done = page.evaluate(async (tests) => {
          const t = await import('/js/ui/terminal.js');
          return t.open({ challenge: { id: 'no-tests', title: 'No tests', prompt: 'x', starterCode: 'print(1)\n', tests }, regionId: 'fixture' });
        }, tests);
        done.catch(() => {});
        await page.waitForSelector('.term');
        await waitPyReady(page);
        await runAndWait(page, 'test');
        assert.deepEqual((await consoleRows(page)).map((r) => r.msg), ['No tests found'], `tests=${JSON.stringify(tests)}`);
        assert.equal(await page.$('.term-stamp'), null);
        await page.keyboard.press('Escape');
        assert.equal((await done).solved, false);
        await gone(page);
      }
      await page.evaluate(() => localStorage.removeItem('etl-code-fixture-no-tests'));
    });

    console.log('explain');

    await step('opens as a speech bubble: name tag in the speaker colour, question, a placeholder that says what to do, Later / Send', async () => {
      await page.evaluate((k) => localStorage.removeItem(k), EXPLAIN_KEY);
      await openExplain(page);
      assert.equal(await page.$eval('.ex-tag', (e) => e.textContent), 'Elder Moss');
      assert.equal(await page.$eval('.ex-tag', (e) => getComputedStyle(e).backgroundColor), 'rgb(138, 90, 158)', 'the elder\'s shirt colour');
      const question = await page.$eval('.ex-q', (e) => e.innerText.trim());
      assert.match(question, /Why do they scale the scores/);
      assert.equal(await page.$eval('.ex-ta', (t) => t.placeholder), 'Explain it in your own words…');
      const keys = await page.$$eval('.ex-key:not([hidden])', (bs) => bs.map((b) => ({ act: b.dataset.act, text: b.innerText.trim(), tip: b.title, disabled: b.disabled })));
      assert.deepEqual(keys.map((k) => [k.act, k.text]), [['later', 'Later'], ['send', 'Send']]);
      assert.ok(keys.every((k) => k.tip), 'tooltips hold the shortcuts');
      assert.equal(keys[1].disabled, true, 'nothing to send yet');
      assert.equal(await page.$('.ex-count, .ex-pen, .ex-off, .ex-meta'), null, 'no word count, pen or offline mark');
      const text = await page.$eval('.ex-bubble', (b) => b.innerText.replace(/\s+/g, ' ').trim());
      assert.equal(text, `Elder Moss ${question.replace(/\s+/g, ' ')} Later Send`, 'name tag, question and the two keys are the only words');
      await shot(page, 'explain-open');
    });

    await step('a vague answer fails ("✗ Not yet" + the feedback): the reply stays up, focus stays in the answer, Send sends again', async () => {
      await page.keyboard.type(VAGUE);
      await page.click('.ex-key[data-act="send"]');
      await page.waitForSelector('.ex-reply[data-mood="fail"]', { timeout: 15000 });
      await sleep(900);
      assert.equal(await page.$eval('.ex-verdict', (e) => e.textContent), '✗ Not yet', 'a clear verdict first');
      assert.match(await page.$eval('.ex-reply-text', (e) => e.textContent), /big numbers trouble the softmax/, 'then the villager\'s own feedback');
      assert.deepEqual(await exKeys(page), ['later', 'send']);
      assert.equal(await page.$eval('.ex-key[data-act="send"]', (b) => b.disabled), false);
      assert.equal(await page.evaluate(() => document.activeElement?.className), 'ex-ta', 'keep typing right away');
      await page.keyboard.type(' More words.');
      assert.equal(await page.$eval('.ex-reply', (r) => r.hidden), false, 'the hint stays while you rewrite');
      await shot(page, 'explain-fail');
    });

    await step('Later resolves { pass: false } with the feedback; the draft is kept', async () => {
      const before = await closes(page);
      await page.click('.ex-key[data-act="later"]');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before);
      const res = await lastResult(page);
      assert.equal(res.pass, false);
      assert.match(res.feedback, /big numbers/);
      assert.equal(await modalOpen(page), false);
      await openExplain(page);
      assert.equal(await page.$eval('.ex-ta', (t) => t.value), `${VAGUE} More words.`, 'the answer is still there');
    });

    await step('"Thinking…" while it is graded; grading trouble says so in one line (with the server\'s word); you can send again', async () => {
      let release;
      const held = new Promise((r) => { release = r; });
      await page.route('**/api/grade', async (route) => {
        await held;
        await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: '… busy' }) });
      });
      await page.click('.ex-key[data-act="send"]');
      await page.waitForSelector('.ex-dots:not([hidden])', { timeout: 5000 });
      assert.equal(await page.$eval('.ex-dots', (e) => e.innerText.trim()), 'Thinking…');
      assert.equal(await page.$eval('.ex-key[data-act="send"]', (b) => b.disabled), true, 'no second send while thinking');
      await shot(page, 'explain-thinking');
      release();
      await page.waitForSelector('.ex-reply[data-mood="error"]', { timeout: 15000 });
      await sleep(900);
      assert.equal(await page.$eval('.ex-reply-text', (e) => e.textContent), "Couldn't check it (busy). Send again.");
      assert.equal(await page.$eval('.ex-dots', (e) => e.hidden), true);
      await page.unroute('**/api/grade');
      await page.route('**/api/grade', (route) => route.abort());
      await page.click('.ex-key[data-act="send"]');
      await page.waitForFunction(() => document.querySelector('.ex-reply-text')?.textContent === "Couldn't check it. Send again.", null, { timeout: 15000 });
      assert.equal(await page.$eval('.ex-key[data-act="send"]', (b) => b.hidden || b.disabled), false);
      await page.unroute('**/api/grade');
    });

    await step('a good answer passes ("✓ Passed!"); ✓ Continue resolves { pass: true }', async () => {
      await page.fill('.ex-ta', GOOD);
      await page.keyboard.press('Control+Enter');
      await page.waitForSelector('.ex-reply[data-mood="pass"]', { timeout: 15000 });
      await sleep(900);
      assert.equal(await page.$eval('.ex-verdict', (e) => e.textContent), '✓ Passed!');
      assert.deepEqual(await exKeyWords(page), [['done', 'Continue']]);
      await shot(page, 'explain-pass');
      const before = await closes(page);
      await page.click('.ex-key[data-act="done"]');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before);
      const res = await lastResult(page);
      assert.equal(res.pass, true);
      assert.ok(res.feedback.length > 0);
      assert.equal(await draft(page, EXPLAIN_KEY), null, 'a passed draft is cleared');
      assert.equal(await modalOpen(page), false);
    });

    await step('backing out before any reply resolves { pass: false, feedback: "" }', async () => {
      await openExplain(page);
      const before = await closes(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction((n) => window.__term.closes === n + 1, before);
      assert.deepEqual(await lastResult(page), { pass: false, feedback: '' });
      await page.evaluate((k) => localStorage.removeItem(k), EXPLAIN_KEY);
    });

    await step('fundamental-shaped challenge ({ id, type, title, question, rubric, offline }) works too', async () => {
      await gone(page);
      const done = page.evaluate(async () => {
        const ex = await import('/js/ui/explain.js');
        return ex.open({
          challenge: { id: 'explain1', type: 'explain', title: 'Scaling', question: 'Why `/ sqrt(d_k)`?', rubric: ['r'], offline: [['sqrt']] },
          regionId: 'fixture',
          speaker: { name: 'Pip' },
        });
      });
      done.catch(() => {});                 // if a check below fails, report that, not the closed page
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

    await step('phones to small laptops (portrait and landscape): the keys keep one row inside the panel, armed too; the explain question is whole', async () => {
      for (const [w, h] of [[320, 568], [360, 740], [390, 780], [412, 915], [844, 390], [861, 700], [900, 600]]) {
        await page.setViewportSize({ width: w, height: h });
        await openTerminal(page);
        await sleep(300);
        const measure = () => page.$eval('.term', (e) => {
          const r = e.getBoundingClientRect();
          const inner = r.right - parseFloat(getComputedStyle(e).borderRightWidth);
          const keys = [...document.querySelectorAll('.term-keys .term-key')];
          const boxes = keys.map((k) => k.getBoundingClientRect());
          const right = (s) => document.querySelector(s).getBoundingClientRect().right;
          return {
            fits: r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
            editor: document.querySelector('.term-editor').getBoundingClientRect().height,
            oneRow: new Set(boxes.map((k) => Math.round(k.top))).size === 1,
            // keys, editor and console all end inside the panel's border
            inside: [...boxes.map((k) => k.right), right('.term-editor'), right('.term-out')].every((x) => x <= inner + 0.5),
            words: keys.map((k) => k.innerText.trim()),
            resetWidth: keys[2].offsetWidth,
          };
        });
        const m = await measure();
        assert.ok(m.fits, `${w}x${h}: the terminal fits`);
        assert.ok(m.editor >= 150, `${w}x${h}: the editor is ${m.editor}px tall`);
        assert.ok(m.oneRow && m.inside, `${w}x${h}: the keys sit on one row inside the panel ${JSON.stringify(m)}`);
        assert.deepEqual(m.words, ['Run', 'Run tests', 'Reset code'], `${w}x${h}: the keys keep their words`);
        // armed (one press on Reset code): same key, same width, nothing pushed out
        await page.click('.term-key[data-act="reset"]');
        await page.waitForFunction(() => document.querySelector('.term-key[data-act="reset"]').getAnimations().length === 0);   // the wiggle is over
        const a = await measure();
        assert.deepEqual(a.words, ['Run', 'Run tests', 'Sure?'], `${w}x${h}: armed`);
        assert.equal(a.resetWidth, m.resetWidth, `${w}x${h}: the armed key keeps its width`);
        assert.ok(a.oneRow && a.inside, `${w}x${h}: armed, the keys, editor and console stay inside the panel ${JSON.stringify(a)}`);
        await shot(page, `term-phone-${w}x${h}`);
        await page.keyboard.press('Escape');
        await gone(page);
        await openExplain(page);
        await page.fill('.ex-ta', VAGUE);
        await page.click('.ex-key[data-act="send"]');
        await page.waitForSelector('.ex-reply[data-mood="fail"]', { timeout: 15000 });
        await sleep(900);
        const e = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const q = document.querySelector('.ex-q');
          return {
            card: r('.ex-card').height, keys: r('.ex-keys').bottom, bubble: r('.ex-bubble').bottom,
            question: [q.clientHeight, q.scrollHeight],
            below: r('.ex-reply-text').top >= r('.ex-verdict').bottom - 1, text: r('.ex-reply-text').width, reply: r('.ex-reply').width,
          };
        });
        assert.ok(e.card >= 100 && e.keys <= h && e.bubble <= h, `${w}x${h}: the answer card and keys fit ${JSON.stringify(e)}`);
        assert.ok(e.question[1] <= e.question[0] + 1, `${w}x${h}: the question is never cut ${JSON.stringify(e.question)}`);
        // phones: the verdict (and meter) on the first line, the villager's words full width below it
        if (w <= 700) assert.ok(e.below && e.text >= e.reply - 40, `${w}x${h}: the reply's words take the full width ${JSON.stringify(e)}`);
        await shot(page, `explain-phone-${w}x${h}`);
        await page.keyboard.press('Escape');
        await gone(page);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate((k) => localStorage.removeItem(k), EXPLAIN_KEY);
    });

    console.log('python offline');

    await step('Pyodide unreachable: fails fast and says so at once, ▶ says it again, and recovers once it is back', async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const cdn = /cdn\.jsdelivr\.net/;
      await context.route(cdn, (route) => route.abort());
      const p2 = await context.newPage();
      p2.on('pageerror', (e) => errors.push(e.message));
      try {
        await p2.goto(`${BASE}/dev/terminal.html?mode=terminal&challenge=code1`);
        await p2.waitForSelector('.term');
        await p2.waitForFunction(() => document.querySelector('.term')?.dataset.py === 'failed', null, { timeout: 30000 });
        // before the player does anything: a blank console would look ready
        assert.deepEqual((await consoleRows(p2)).map((r) => r.text), ["Python didn't load (offline?). Try again."], 'the console says so right away');
        assert.equal(await statusLine(p2), '', 'no status line left behind');
        await setCode(p2, 'print(6 * 7)\n');
        await runAndWait(p2, 'run');
        assert.deepEqual((await consoleRows(p2)).map((r) => r.text), ["Python didn't load (offline?). Try again."], 'Run tries again and says it once');
        await shot(p2, 'term-offline');
        await context.unroute(cdn);
        await runAndWait(p2, 'run', 150000);          // Python loads from scratch in this context
        assert.equal(await p2.$eval('.term-stdout', (e) => e.textContent), '42', 'Python loads on the next try');
      } finally {
        await context.close();
      }
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
