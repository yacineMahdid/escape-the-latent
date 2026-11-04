// Smoke test for the Umbral Book (public/js/ui/book.js) through its harness, public/dev/book.html.
//
//   node test/ui/book-smoke.cjs
//
// Uses a server on BOOK_TEST_PORT (default 3101) with the fixture region ("fixture", arXiv 1706.03762);
// if none is running it starts one: REGIONS_DIR=server/test/fixtures/regions PORT=3101 node server/index.js
// No API key needed: the book answers in offline mode. Screenshots land in test-output/book-*.png.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.BOOK_TEST_PORT || 3101);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'test-output');
const ARXIV = '1706.03762';
const NOTES_KEY = `etl-notes-${ARXIV}`;
const CHAT_KEY = 'etl-book-chat-fixture';
const PAGE_KEY = `etl-book-page-${ARXIV}`;
const DAY = 864e5;

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

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `book-${name}.png`) });
const storage = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);

function seedLearned(page, learned) {
  return page.evaluate((l) => {
    localStorage.setItem('etl-save-v1', JSON.stringify({ version: 1, character: null, regions: {}, artefacts: [], learned: l }));
  }, learned);
}

// Select the whole text of the first text-layer span on `pageNum` that contains `needle`.
function selectSpan(page, pageNum, needle) {
  return page.evaluate(({ pageNum, needle }) => {
    const layer = document.querySelector(`.bk-pg[data-page="${pageNum}"] .textLayer`);
    const span = layer && [...layer.querySelectorAll('span')].find((s) => s.firstChild?.nodeType === 3 && s.textContent.includes(needle));
    if (!span) return null;
    span.scrollIntoView({ block: 'center' });
    const node = span.firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, node.textContent.length);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return span.textContent;
  }, { pageNum, needle });
}

const waitAnswer = (page, n) => page.waitForFunction((count) => {
  const ex = document.querySelectorAll('.bk-ex');
  const a = ex[count - 1]?.querySelector('.bk-a');
  return ex.length === count && a && !a.classList.contains('typing') && !a.querySelector('.bk-dots') && a.textContent.trim().length > 0;
}, n, { timeout: 15000 });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));

    // fresh storage + three learned concepts in two regions
    await page.goto(`${BASE}/dev/book.html?auto=0`);
    await page.evaluate(() => localStorage.clear());
    const now = Date.now();
    await seedLearned(page, {
      'dot-product': { title: 'Dot Product', record: 'Two arrows multiplied part by part and summed.', region: 'Attendale', at: new Date(now - 3 * DAY).toISOString() },
      softmax: { title: 'Softmax', record: 'Every score raised and shared, so the whole sums to one.', region: 'Attendale', at: new Date(now - 2 * DAY).toISOString() },
      'hidden-state': { title: 'Hidden State', record: 'A pocket of memory carried forward, rewritten each step.', region: 'Mamba desert', at: new Date(now - DAY).toISOString() },
    });

    console.log('read');
    await page.goto(`${BASE}/dev/book.html?tab=read`);

    await step('the PDF opens and page 1 renders on a non-blank canvas', async () => {
      await page.waitForSelector('.bk-read[data-state="ready"]', { timeout: 30000 });
      await page.waitForSelector('.bk-pg[data-page="1"][data-rendered="1"]', { timeout: 30000 });
      const info = await page.evaluate(() => {
        const pg = document.querySelector('.bk-pg[data-page="1"]');
        const c = pg.querySelector('canvas');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 450) ink++;
        return { ink, cw: c.width, css: pg.getBoundingClientRect().width, dpr: devicePixelRatio, pages: document.querySelectorAll('.bk-pg').length, spans: pg.querySelectorAll('.textLayer span').length };
      });
      assert.equal(info.pages, 15, 'all 15 page slots');
      assert.ok(info.ink > 5000, `canvas has ink (${info.ink} dark pixels)`);
      assert.ok(Math.abs(info.cw - Math.floor(info.css * info.dpr)) <= 2, `canvas is sized for devicePixelRatio (${info.cw} vs ${info.css}x${info.dpr})`);
      assert.ok(info.spans > 20, 'text layer is filled');
    });
    await shot(page, 'read');

    await step('pages render lazily (not all at once) and on demand', async () => {
      const rendered = await page.$$eval('.bk-pg[data-rendered]', (els) => els.length);
      assert.ok(rendered < 15, `only nearby pages are rendered (${rendered})`);
      await page.evaluate(() => { const s = document.querySelector('.bk-scroll'); s.scrollTop = s.scrollHeight; });
      await page.waitForSelector('.bk-pg[data-page="15"][data-rendered="1"]', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('.bk-pnum').value === '15');
      await page.evaluate(() => { document.querySelector('.bk-scroll').scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector('.bk-pnum').value === '1');
      await page.waitForSelector('.bk-pg[data-page="1"][data-rendered="1"]');
    });

    await step('zoom − / + resizes and re-renders the pages', async () => {
      const w0 = await page.$eval('.bk-pg[data-page="1"]', (e) => e.getBoundingClientRect().width);
      await page.click('.bk-rbar .bk-ib[title="Zoom in"]');
      await page.waitForFunction(() => document.querySelector('.bk-rbar').dataset.zoom === '1.15');
      const w1 = await page.$eval('.bk-pg[data-page="1"]', (e) => e.getBoundingClientRect().width);
      assert.ok(Math.abs(w1 / w0 - 1.15) < 0.01, `zoomed in (${w0} -> ${w1})`);
      await page.waitForFunction(() => {
        const pg = document.querySelector('.bk-pg[data-page="1"]');
        const c = pg.querySelector('canvas');
        return pg.dataset.rendered && c && Math.abs(c.width - Math.floor(pg.getBoundingClientRect().width * devicePixelRatio)) <= 2;
      });
      await page.click('.bk-rbar .bk-ib[title="Zoom out"]');
      await page.click('.bk-rbar .bk-ib[title="Zoom out"]');
      await page.waitForFunction(() => document.querySelector('.bk-rbar').dataset.zoom === '0.9');
      await page.keyboard.press('0');
      await page.waitForFunction(() => document.querySelector('.bk-rbar').dataset.zoom === '1');
      await page.evaluate(() => { document.querySelector('.bk-scroll').scrollTop = 0; });
      await page.waitForSelector('.bk-pg[data-page="1"][data-rendered="1"] .textLayer span');
    });

    let firstText = '';
    await step('selecting text pops the icon menu; 🖍 highlights it', async () => {
      firstText = await selectSpan(page, 1, 'dominant sequence');
      assert.ok(firstText, 'found the abstract on page 1');
      await page.waitForSelector('.bk-selmenu:not([hidden])', { timeout: 5000 });
      const icons = await page.$$eval('.bk-selmenu button', (bs) => bs.map((b) => [b.textContent.trim(), b.title]));
      assert.deepEqual(icons, [['🖍', 'Highlight'], ['✎', 'Note'], ['?', 'Ask']]);
      await shot(page, 'select');
      await page.click('.bk-selmenu button[title="Highlight"]');
      await page.waitForSelector('.bk-selmenu[hidden]', { state: 'attached' });
      const notes = await storage(page, NOTES_KEY);
      assert.equal(notes.length, 1);
      const [a] = notes;
      assert.equal(a.page, 1);
      assert.ok(a.text.includes('dominant sequence'), 'stores the selected text');
      assert.ok(a.rects.length >= 1 && a.rects.every((r) => [r.x, r.y, r.w, r.h].every((v) => v >= 0 && v <= 1)), 'rects are normalized');
      for (const k of ['id', 'page', 'rects', 'text', 'note', 'color', 'created']) assert.ok(k in a, `annotation has ${k}`);
      assert.ok(await page.$$eval('.bk-pg[data-page="1"] .bk-hl', (els) => els.length) >= 1, 'highlight overlay on the page');
    });

    await step('✎ adds a note in a popover on the page; Esc closes only the popover', async () => {
      assert.ok(await selectSpan(page, 1, 'Attention Is All You Need'), 'found the title');
      await page.waitForSelector('.bk-selmenu:not([hidden])');
      await page.click('.bk-selmenu button[title="Note"]');
      await page.waitForSelector('.bk-pop textarea');
      await page.click('.bk-pop textarea');
      await page.keyboard.type('the heart of it');
      await shot(page, 'note-pop');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-pop', { state: 'detached' });
      assert.ok(await page.$('.bk-overlay'), 'the book is still open');
      const notes = await storage(page, NOTES_KEY);
      assert.equal(notes.length, 2);
      assert.equal(notes.find((n) => n.text.includes('Attention Is All You Need'))?.note, 'the heart of it');
      await page.waitForSelector('.bk-pg[data-page="1"] .bk-mark');
    });

    await step('clicking a highlight reopens its note', async () => {
      const box = await page.$eval('.bk-pg[data-page="1"] .bk-hl', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(box.x, box.y);
      await page.waitForSelector('.bk-pop textarea');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-pop', { state: 'detached' });
    });

    console.log('notes');
    await step('✎ Notes lists every annotation, grouped by page, editable', async () => {
      await page.click('.bk-tab[data-tab="notes"]');
      await page.waitForSelector('.bk-notes.on .bk-note');
      const groups = await page.$$eval('.bk-ng', (els) => els.map((e) => e.dataset.page));
      assert.deepEqual(groups, ['1']);
      const cards = await page.$$eval('.bk-note', (els) => els.map((e) => ({ q: e.querySelector('.bk-nq').textContent, n: e.querySelector('textarea').value })));
      assert.equal(cards.length, 2);
      assert.ok(cards[0].q.includes('Attention Is All You Need'), 'sorted top to bottom');
      assert.equal(cards[0].n, 'the heart of it');
      const ta = (await page.$$('.bk-note textarea'))[1];
      await ta.click();
      await page.keyboard.type('no recurrence?');
      await sleep(500);
      const notes = await storage(page, NOTES_KEY);
      assert.equal(notes.find((n) => n.text.includes('dominant'))?.note, 'no recurrence?');
      await page.evaluate(() => document.activeElement?.blur());
      await shot(page, 'notes');
    });

    await step('clicking a note jumps to it in the paper', async () => {
      await page.click('.bk-note:nth-of-type(1) .bk-nq');
      await page.waitForSelector('.bk-read.on');
      await page.waitForSelector('.bk-hl.flash');
    });

    await step('🗑 erases on the second press', async () => {
      await page.click('.bk-tab[data-tab="notes"]');
      await page.evaluate(() => {
        // a third, throwaway annotation on page 2
        const k = 'etl-notes-1706.03762';
        const list = JSON.parse(localStorage.getItem(k));
        list.push({ id: 'tmp', page: 2, rects: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.01 }], text: 'throwaway', note: '', color: '#ffd36b', created: new Date().toISOString() });
        localStorage.setItem(k, JSON.stringify(list));
      });
      await page.reload();
      await page.click('.bk-tab[data-tab="notes"]');
      await page.waitForSelector('.bk-notes.on .bk-note[data-id="tmp"]');
      await page.click('.bk-note[data-id="tmp"] .bk-del');
      assert.ok(await page.$('.bk-note[data-id="tmp"] .bk-del.armed'), 'armed after one press');
      assert.equal((await storage(page, NOTES_KEY)).length, 3, 'nothing erased yet');
      await page.click('.bk-note[data-id="tmp"] .bk-del');
      await page.waitForSelector('.bk-note[data-id="tmp"]', { state: 'detached' });
      await page.waitForSelector('.bk-ng[data-page="2"]', { state: 'detached' });
      assert.equal((await storage(page, NOTES_KEY)).length, 2);
    });

    await step('notes, highlights and the last page survive a reload', async () => {
      await page.click('.bk-tab[data-tab="read"]');
      await page.waitForSelector('.bk-read[data-state="ready"]');
      await page.fill('.bk-pnum', '3');
      await page.press('.bk-pnum', 'Enter');
      await page.waitForFunction(() => document.querySelector('.bk-pnum').value === '3');
      await sleep(600);
      assert.equal((await storage(page, PAGE_KEY))?.page, 3, 'last page saved');
      await page.reload();
      await page.waitForSelector('.bk-read[data-state="ready"]', { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('.bk-pnum').value === '3');
      assert.equal(await page.$$eval('.bk-pg[data-page="1"] .bk-hl[data-id]', (els) => new Set(els.map((e) => e.dataset.id)).size), 2, 'both highlights painted');
      await page.click('.bk-tab[data-tab="notes"]');
      const notes = await page.$$eval('.bk-note textarea', (els) => els.map((e) => e.value));
      assert.deepEqual(notes, ['the heart of it', 'no recurrence?']);
    });

    console.log('ask');
    await step('? Ask: the book answers (offline) letter by letter, ⦸ shows offline', async () => {
      await page.click('.bk-tab[data-tab="ask"]');
      await page.waitForSelector('.bk-ask.on .bk-empty:not([hidden])');
      await page.fill('.bk-qin', 'what about softmax?');
      await page.press('.bk-qin', 'Enter');
      await page.waitForSelector('.bk-ex .bk-dots, .bk-ex .bk-l', { timeout: 5000 });
      await page.waitForSelector('.bk-ex .bk-a.typing .bk-l', { timeout: 10000 });
      await waitAnswer(page, 1);
      const a = await page.$eval('.bk-ex .bk-a', (e) => e.textContent);
      assert.ok(a.includes('Exponents grow wild'), `offline hint answer (${a})`);
      assert.equal(await page.$eval('.bk-off', (e) => !e.hidden && e.title), 'offline');
      const chat = await storage(page, CHAT_KEY);
      assert.equal(chat.length, 1);
      assert.equal(chat[0].q, 'what about softmax?');
      await shot(page, 'ask');
    });

    await step('? from a selection carries the passage into Ask', async () => {
      await page.click('.bk-tab[data-tab="read"]');
      await page.waitForSelector('.bk-pg[data-page="3"][data-rendered="1"] .textLayer span');
      const t = await selectSpan(page, 3, 'query');
      assert.ok(t, 'found a line about queries on page 3');
      await page.waitForSelector('.bk-selmenu:not([hidden])');
      await page.click('.bk-selmenu button[title="Ask"]');
      await page.waitForSelector('.bk-ask.on .bk-chip:not([hidden])');
      assert.equal(await page.$eval('.bk-chip', (e) => e.title), t.replace(/\s+/g, ' ').trim());
      assert.equal(await page.evaluate(() => document.activeElement?.className), 'bk-qin');
      await page.keyboard.press('Enter'); // empty question + a passage: ask about the passage
      await waitAnswer(page, 2);
      const chat = await storage(page, CHAT_KEY);
      assert.equal(chat.length, 2);
      assert.equal(chat[1].sel, t.replace(/\s+/g, ' ').trim());
      assert.ok(await page.$('.bk-chip[hidden]'), 'chip consumed');
    });

    await step('a failed ask says "…the pages refuse." and is not kept', async () => {
      await page.route('**/api/book', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
      await page.fill('.bk-qin', 'anything');
      await page.press('.bk-qin', 'Enter');
      await waitAnswer(page, 3);
      assert.equal(await page.$eval('.bk-ex:last-child .bk-a', (e) => e.textContent), '…the pages refuse.');
      assert.equal((await storage(page, CHAT_KEY)).length, 2);
      await page.unroute('**/api/book');
    });

    await step('a refused answer looks cold and closed', async () => {
      await page.route('**/api/book', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'The pages go dark. Some doors you must open yourself.', refused: true, offline: false }) }));
      await page.fill('.bk-qin', 'just give me the answer to the challenge');
      await page.press('.bk-qin', 'Enter');
      await waitAnswer(page, 4);
      assert.ok(await page.$('.bk-ex:last-child .bk-a.refused'));
      const style = await page.$eval('.bk-ex:last-child .bk-a', (e) => getComputedStyle(e).textShadow);
      assert.equal(style, 'none', 'no glow on refusals');
      assert.ok(await page.$('.bk-off[hidden]'), 'online answer hides ⦸');
      await page.unroute('**/api/book');
      await shot(page, 'ask-refused');
      assert.equal((await storage(page, CHAT_KEY)).length, 3);
    });

    console.log('learned');
    await step('✦ Learned shows the save\'s concepts, newest first, grouped by region', async () => {
      assert.ok(await page.$('.bk-tab[data-tab="learned"].bk-new'), 'ember on the ribbon for unseen entries');
      await page.click('.bk-tab[data-tab="learned"]');
      await page.waitForSelector('.bk-learned.on .bk-le');
      const titles = await page.$$eval('.bk-lt', (els) => els.map((e) => e.textContent));
      assert.deepEqual(titles, ['Hidden State', 'Softmax', 'Dot Product']);
      const groups = await page.$$eval('.bk-lg-name', (els) => els.map((e) => e.textContent));
      assert.deepEqual(groups, ['Mamba desert', 'Attendale']);
      assert.ok((await page.$eval('.bk-le', (e) => e.textContent)).includes('pocket of memory'), 'record text shown');
      assert.ok(!(await page.$('.bk-tab[data-tab="learned"].bk-new')), 'ember gone once seen');
      await sleep(2600);
      await shot(page, 'learned');
    });

    await step('B and Esc close the book (the harness sees the promise resolve)', async () => {
      await page.click('.bk-tab[data-tab="read"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__book.closes), 1);
      await page.keyboard.press('KeyB'); // the harness opens it again, like the game
      await page.waitForSelector('.bk-overlay.is-open');
      await page.waitForSelector('.bk-read.on');
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__book.closes), 2);
    });

    await step('empty Learned pages show one faint glyph, no words', async () => {
      await seedLearned(page, {});
      await page.goto(`${BASE}/dev/book.html?tab=learned`);
      await page.waitForSelector('.bk-learned.on .bk-empty:not([hidden])');
      assert.equal(await page.$$eval('.bk-le', (els) => els.length), 0);
      assert.equal(await page.$eval('.bk-learned', (e) => e.innerText.trim()), '✦');
      await shot(page, 'learned-empty');
    });

    await step('a paper that will not load: one eerie line + ↗ arXiv', async () => {
      await page.goto(`${BASE}/dev/book.html?tab=read&arxiv=nope`);
      await page.waitForSelector('.bk-read[data-state="error"] .bk-fail', { timeout: 20000 });
      assert.equal(await page.$eval('.bk-fail-line', (e) => e.textContent), 'The ink will not settle.');
      assert.equal(await page.$eval('.bk-fail-link', (e) => e.href), 'https://arxiv.org/abs/nope');
      await shot(page, 'pdf-fail');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
    });

    await step('almost no words: every control is an icon (≤ 2 chars) with a tooltip', async () => {
      await page.goto(`${BASE}/dev/book.html?tab=read`);
      await page.waitForSelector('.bk-read[data-state="ready"]', { timeout: 30000 });
      for (const tab of ['read', 'notes', 'ask', 'learned']) {
        await page.click(`.bk-tab[data-tab="${tab}"]`);
        await sleep(300);
        const bad = await page.$$eval('.bk-overlay button, .bk-overlay a', (els) => els
          .filter((e) => e.offsetParent && !e.closest('.bk-ng-h'))
          .filter((e) => [...e.textContent.trim()].length > 2 || !(e.title || e.getAttribute('aria-label')))
          .map((e) => e.outerHTML.slice(0, 80)));
        assert.deepEqual(bad, [], `controls with words or without tooltip on ${tab}`);
      }
    });

    console.log('900x600');
    await step('fits a 900x600 window', async () => {
      await page.setViewportSize({ width: 900, height: 600 });
      await seedLearned(page, { softmax: { title: 'Softmax', record: 'Every score raised and shared, so the whole sums to one.', region: 'Attendale', at: new Date().toISOString() } });
      for (const tab of ['read', 'notes', 'ask', 'learned']) {
        await page.goto(`${BASE}/dev/book.html?tab=${tab}`);
        await page.waitForSelector(`.bk-${tab}.on`);
        if (tab === 'read') await page.waitForSelector('.bk-pg[data-rendered="1"]', { timeout: 30000 });
        await sleep(700);
        const r = await page.evaluate(() => {
          const box = (s) => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
          return { book: box('.bk'), tabs: box('.bk-tabs'), x: box('.bk-x'), bar: box('.bk-rbar'), sw: document.documentElement.scrollWidth };
        });
        for (const [k, b] of Object.entries(r)) {
          if (!b || typeof b !== 'object') continue;
          assert.ok(b.l >= 0 && b.t >= 0 && b.r <= 900 && b.b <= 600, `${k} inside the window on ${tab}: ${JSON.stringify(b)}`);
        }
        await shot(page, `900-${tab}`);
      }
    });

    await step('crisp at devicePixelRatio 2', async () => {
      const hi = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
      const p2 = await hi.newPage();
      await p2.goto(`${BASE}/dev/book.html?tab=read`);
      await p2.waitForSelector('.bk-pg[data-rendered="1"]', { timeout: 30000 });
      const r = await p2.$eval('.bk-pg[data-rendered="1"]', (pg) => ({ cw: pg.querySelector('canvas').width, css: pg.getBoundingClientRect().width }));
      assert.ok(Math.abs(r.cw - Math.floor(r.css * 2)) <= 2, `2x canvas (${r.cw} for ${r.css} css px)`);
      await hi.close();
    });

    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log(`\n${passed} checks passed. Screenshots: ${path.relative(ROOT, OUT)}/book-*.png`);
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(`\nFAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
  })
  .finally(() => { if (server) server.kill('SIGTERM'); });
