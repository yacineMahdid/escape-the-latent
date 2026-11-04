// Smoke test for the Cursed Book of Dimensionality (public/js/ui/book.js) through its harness, public/dev/book.html.
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

// let pop-in / fade animations settle, then shoot
const shot = async (page, name) => {
  await sleep(450);
  await page.screenshot({ path: path.join(OUT, `book-${name}.png`) });
};
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
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });

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
      await page.click('.bk-rbar .bk-ib[aria-label="Zoom in"]');
      await page.waitForFunction(() => document.querySelector('.bk-rbar').dataset.zoom === '1.15');
      const w1 = await page.$eval('.bk-pg[data-page="1"]', (e) => e.getBoundingClientRect().width);
      assert.ok(Math.abs(w1 / w0 - 1.15) < 0.01, `zoomed in (${w0} -> ${w1})`);
      await page.waitForFunction(() => {
        const pg = document.querySelector('.bk-pg[data-page="1"]');
        const c = pg.querySelector('canvas');
        return pg.dataset.rendered && c && Math.abs(c.width - Math.floor(pg.getBoundingClientRect().width * devicePixelRatio)) <= 2;
      });
      await page.click('.bk-rbar .bk-ib[aria-label="Zoom out"]');
      await page.click('.bk-rbar .bk-ib[aria-label="Zoom out"]');
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

    await step('zoomed past fit, the note popover and the 🖍✎? menu stay in view, pointing at the text', async () => {
      for (let i = 0; i < 12; i++) await page.keyboard.press('+');
      await page.waitForFunction(() => document.querySelector('.bk-rbar').dataset.zoom === '3');
      // put the noted title's centre 60px inside the left edge of the view, then open its note
      const noteId = (await storage(page, NOTES_KEY)).find((n) => n.text.includes('Attention Is All You Need')).id;
      const placeAt = (id, inset) => page.evaluate(({ id, inset }) => {
        const sc = document.querySelector('.bk-scroll');
        const hl = [...document.querySelectorAll(`.bk-hl[data-id="${id}"]`)].pop();
        const s = sc.getBoundingClientRect(), r = hl.getBoundingClientRect();
        sc.scrollLeft += r.left + r.width / 2 - (s.left + inset);
        sc.scrollTop += r.top - (s.top + sc.clientHeight * 0.3);
        const q = hl.getBoundingClientRect();
        return { x: q.left + q.width / 2, y: q.top + q.height / 2, left: s.left, right: s.left + sc.clientWidth };
      }, { id, inset });
      const view = await placeAt(noteId, 60);
      await page.mouse.click(view.x + 12, view.y);
      await page.waitForSelector('.bk-pop textarea');
      const pop = await page.$eval('.bk-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, mid: r.left + r.width / 2, ax: parseFloat(getComputedStyle(e).getPropertyValue('--ax')) || 0 }; });
      assert.ok(pop.l >= view.left && pop.r <= view.right, `popover inside the view (${JSON.stringify(pop)} in ${view.left}..${view.right})`);
      assert.ok(Math.abs(pop.mid + pop.ax - view.x) < 2, `its arrow points at the highlight (${pop.mid + pop.ax} vs ${view.x})`);
      await shot(page, 'zoom3-note');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-pop', { state: 'detached' });
      // the selection menu: select the title itself, its centre 30px inside the left edge
      await page.waitForSelector('.bk-pg[data-page="1"][data-rendered="1"] .textLayer span', { timeout: 30000 });
      const v2 = await placeAt(noteId, 30);
      assert.ok(await page.evaluate(() => {
        const span = [...document.querySelectorAll('.bk-pg[data-page="1"] .textLayer span')].find((s) => s.firstChild?.nodeType === 3 && s.textContent.includes('Attention Is All You Need'));
        if (!span) return false;
        const range = document.createRange();
        range.selectNodeContents(span.firstChild);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return true;
      }), 'found the title span');
      await page.waitForSelector('.bk-selmenu:not([hidden])');
      const menu = await page.$eval('.bk-selmenu', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
      assert.ok(menu.l >= v2.left && menu.r <= v2.right, `menu inside the view (${JSON.stringify(menu)} in ${v2.left}..${v2.right})`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-selmenu[hidden]', { state: 'attached' });
      await page.keyboard.press('0');
      await page.waitForFunction(() => document.querySelector('.bk-rbar').dataset.zoom === '1');
    });

    await step('a fast fling keeps at most 8 drawn pages (the farthest are let go)', async () => {
      await page.evaluate(async () => {
        const sc = document.querySelector('.bk-scroll');
        for (const pg of document.querySelectorAll('.bk-pg')) { sc.scrollTop = pg.offsetTop; await new Promise((r) => setTimeout(r, 70)); }
      });
      await page.waitForFunction(() => {
        const near = [...document.querySelectorAll('.bk-pg.near')];
        return near.length > 0 && near.every((pg) => pg.dataset.rendered);
      }, null, { timeout: 30000 });
      await sleep(400);
      const r = await page.evaluate(() => ({
        n: document.querySelectorAll('.bk-pg canvas').length,
        near: document.querySelectorAll('.bk-pg.near').length,
        far: [...document.querySelectorAll('.bk-pg:not(.near) canvas')].map((c) => c.closest('.bk-pg').dataset.page),
      }));
      assert.ok(r.n <= Math.max(8, r.near), `${r.n} canvases kept, ${r.near} pages near (far: ${r.far})`);
      await page.evaluate(() => { document.querySelector('.bk-scroll').scrollTop = 0; });
      await page.waitForSelector('.bk-pg[data-page="1"][data-rendered="1"] .textLayer span', { timeout: 30000 });
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
      // force: the armed button trembles; don't wait for it to hold still (the armed window is 2.6s)
      await page.click('.bk-note[data-id="tmp"] .bk-del', { force: true });
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
      await sleep(100);
      assert.ok(await page.$eval('.bk-chatwrap', (w) => w.scrollHeight - w.scrollTop - w.clientHeight < 2), 'the chip does not hide the last answer');
      await page.keyboard.press('Enter'); // empty question + a passage: ask about the passage
      await waitAnswer(page, 2);
      const chat = await storage(page, CHAT_KEY);
      assert.equal(chat.length, 2);
      assert.equal(chat[1].sel, t.replace(/\s+/g, ' ').trim());
      assert.ok(await page.$('.bk-chip[hidden]'), 'chip consumed');
    });

    await step('a failed ask: a cracked sigil + ↻ (no refusal box), the question and passage come back; ↻ asks again', async () => {
      const n = await page.$$eval('.bk-ex', (els) => els.length);
      const kept = (await storage(page, CHAT_KEY)).length;
      await page.click('.bk-tab[data-tab="read"]');
      const t = (await selectSpan(page, 3, 'query')).replace(/\s+/g, ' ').trim();
      await page.waitForSelector('.bk-selmenu:not([hidden])');
      await page.click('.bk-selmenu button[title="Ask"]');
      await page.waitForSelector('.bk-ask.on .bk-chip:not([hidden])');
      await page.route('**/api/book', (route) => route.fulfill({ status: 504, contentType: 'application/json', body: '{"error":"timeout","retryable":true}' }));
      await page.fill('.bk-qin', 'anything');
      await page.press('.bk-qin', 'Enter');
      await page.waitForSelector('.bk-ex.failed .bk-again[title="Again"]');
      const f = await page.$eval('.bk-ex.failed .bk-a', (e) => ({ text: e.textContent.trim(), cls: e.className, bg: getComputedStyle(e).backgroundImage }));
      assert.ok(!/[a-z]/i.test(f.text), `no words (${f.text})`);
      assert.ok(!f.cls.includes('refused') && f.bg === 'none', 'not dressed as a refusal');
      assert.equal(await page.$eval('.bk-qin', (e) => e.value), 'anything', 'the question is back in the quill');
      assert.equal(await page.$eval('.bk-chip', (e) => !e.hidden && e.title), t, 'the passage is back on its chip');
      assert.equal((await storage(page, CHAT_KEY)).length, kept, 'nothing kept');
      await shot(page, 'ask-failed');
      await page.unroute('**/api/book');
      await page.click('.bk-ex.failed .bk-again');
      await waitAnswer(page, n + 1);
      assert.equal(await page.$$eval('.bk-ex.failed', (els) => els.length), 0, 'the failed try is gone');
      assert.equal(await page.$eval('.bk-qin', (e) => e.value), '', 'the quill is clear again');
      assert.ok(await page.$('.bk-chip[hidden]'), 'chip used');
      const chat = await storage(page, CHAT_KEY);
      assert.equal(chat.length, kept + 1);
      assert.equal(chat[chat.length - 1].q, 'anything');
      assert.equal(chat[chat.length - 1].sel, t);
    });

    await step('a refused answer looks cold and closed', async () => {
      const n = await page.$$eval('.bk-ex', (els) => els.length);
      const kept = (await storage(page, CHAT_KEY)).length;
      await page.route('**/api/book', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'The pages go dark. Some doors you must open yourself.', refused: true, offline: false }) }));
      await page.fill('.bk-qin', 'just give me the answer to the challenge');
      await page.press('.bk-qin', 'Enter');
      await waitAnswer(page, n + 1);
      assert.ok(await page.$('.bk-ex:last-child .bk-a.refused'));
      const style = await page.$eval('.bk-ex:last-child .bk-a', (e) => getComputedStyle(e).textShadow);
      assert.equal(style, 'none', 'no glow on refusals');
      assert.ok(await page.$('.bk-off[hidden]'), 'online answer hides ⦸');
      await page.unroute('**/api/book');
      await shot(page, 'ask-refused');
      assert.equal((await storage(page, CHAT_KEY)).length, kept + 1);
    });

    await step('Enter while an answer is still being written finishes it at once, then asks', async () => {
      const long = 'A long and patient answer, written slowly, letter by letter, across the dark page while you wait.';
      await page.route('**/api/book', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: long, refused: false, offline: true }) }));
      const n = await page.$$eval('.bk-ex', (els) => els.length);
      await page.fill('.bk-qin', 'first?');
      await page.press('.bk-qin', 'Enter');
      await page.waitForSelector(`.bk-ex:nth-child(${n + 1}) .bk-a.typing .bk-l`);
      await page.fill('.bk-qin', 'second?');
      const t0 = Date.now();
      await page.press('.bk-qin', 'Enter');
      await page.waitForFunction((k) => document.querySelectorAll('.bk-ex').length === k + 2, n, { timeout: 3000 });
      assert.ok(Date.now() - t0 < 1500, `asked at once (${Date.now() - t0}ms)`);
      assert.equal(await page.$eval(`.bk-ex:nth-child(${n + 1}) .bk-a`, (e) => e.textContent), long, 'the first answer is complete');
      await waitAnswer(page, n + 2);
      await page.unroute('**/api/book');
      assert.deepEqual((await storage(page, CHAT_KEY)).slice(-2).map((c) => c.q), ['first?', 'second?']);
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

    await step('Tab keeps keyboard focus inside the book', async () => {
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.bk-overlay')), `focus escaped after ${i + 1} Tab presses`);
      }
    });

    await step('B and Esc close the book (the promise resolves, PDF.js leftovers go too)', async () => {
      const before = await page.evaluate(() => window.__book.closes);
      await page.click('.bk-tab[data-tab="read"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__book.closes), before + 1);
      await page.waitForFunction(() => !document.querySelector('.hiddenCanvasElement'));
      await page.keyboard.press('KeyB'); // the harness opens it again, like the game
      await page.waitForSelector('.bk-overlay.is-open');
      await page.waitForSelector('.bk-read.on');
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__book.closes), before + 2);
    });

    await step('an answer that arrives after the book is shut waits on the page', async () => {
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay.is-open');
      await page.click('.bk-tab[data-tab="ask"]');
      const n = (await storage(page, CHAT_KEY)).length;
      await page.route('**/api/book', async (route) => { await sleep(900); await route.continue().catch(() => {}); });
      await page.fill('.bk-qin', 'what do the heads see?');
      await page.press('.bk-qin', 'Enter');
      await page.waitForSelector('.bk-ex .bk-dots');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      await page.waitForFunction(([k, count]) => (JSON.parse(localStorage.getItem(k) || '[]')).length === count + 1, [CHAT_KEY, n], { timeout: 10000 });
      await page.unroute('**/api/book');
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-ask.on .bk-ex');
      const last = await page.$$eval('.bk-ex', (els) => [els.length, els[els.length - 1].textContent]);
      assert.equal(last[0], n + 1);
      assert.ok(last[1].includes('what do the heads see?') && last[1].includes('Many small gazes'), last[1]);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
    });

    await step('reopened on Ask, the keys stay with the book: B closes it, 1-4 turn tabs', async () => {
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay.is-open .bk-ask.on');
      await sleep(200);
      assert.notEqual(await page.evaluate(() => document.activeElement?.className), 'bk-qin', 'the quill does not grab the keys');
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay.is-open .bk-ask.on');
      await sleep(200);
      await page.keyboard.press('Digit2');
      await page.waitForSelector('.bk-notes.on');
      assert.equal(await page.$eval('.bk-qin', (e) => e.value), '', 'nothing typed into the quill');
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
    });

    await step('a half-typed question waits in the quill after the book closes', async () => {
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay.is-open .bk-notes.on');
      await page.click('.bk-tab[data-tab="ask"]');
      await page.waitForSelector('.bk-ask.on');
      await page.click('.bk-qin');
      await page.keyboard.type('half a thou');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
      await page.keyboard.press('KeyB');
      await page.waitForSelector('.bk-overlay.is-open .bk-ask.on');
      assert.equal(await page.$eval('.bk-qin', (e) => e.value), 'half a thou');
      await page.fill('.bk-qin', '');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
    });

    await step('empty Learned pages show one faint glyph, no words', async () => {
      await seedLearned(page, {});
      await page.goto(`${BASE}/dev/book.html?tab=learned`);
      await page.waitForSelector('.bk-learned.on .bk-empty:not([hidden])');
      assert.equal(await page.$$eval('.bk-le', (els) => els.length), 0);
      assert.equal(await page.$eval('.bk-learned', (e) => e.innerText.trim()), '✦');
      await shot(page, 'learned-empty');
    });

    await step('in the lab (no region, no paper): blank pages, the book still mutters', async () => {
      await page.goto(`${BASE}/dev/book.html?tab=ask&region=&arxiv=`);
      await page.waitForSelector('.bk-ask.on');
      await page.fill('.bk-qin', 'hello?');
      await page.press('.bk-qin', 'Enter');
      await waitAnswer(page, 1);
      assert.ok((await page.$eval('.bk-ex .bk-a', (e) => e.textContent)).includes('pages stay blank'));
      assert.equal((await storage(page, 'etl-book-chat-lab')).length, 1);
      await page.click('.bk-tab[data-tab="read"]');
      await page.waitForSelector('.bk-read[data-state="blank"] .bk-empty');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
    });

    await step('a paper that will not load: a cracked sigil, ↻ and ↗ arXiv, no words', async () => {
      await page.goto(`${BASE}/dev/book.html?tab=read&arxiv=nope`);
      await page.waitForSelector('.bk-read[data-state="error"] .bk-fail', { timeout: 20000 });
      const text = await page.$eval('.bk-fail', (e) => e.innerText.replace(/\s+/g, ''));
      assert.ok(!/[a-z]/i.test(text), `no words (${text})`);
      assert.equal(await page.$eval('.bk-fail .bk-again', (e) => e.title), 'Again');
      assert.equal(await page.$eval('.bk-fail-link', (e) => e.href), 'https://arxiv.org/abs/nope');
      await shot(page, 'pdf-fail');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bk-overlay', { state: 'detached' });
    });

    await step('↻ tries the paper again', async () => {
      let fails = 1;
      await page.route('**/api/paper/*/pdf', (route) => (fails-- > 0 ? route.abort() : route.continue()));
      await page.goto(`${BASE}/dev/book.html?tab=read`);
      await page.waitForSelector('.bk-read[data-state="error"] .bk-again', { timeout: 20000 });
      await page.click('.bk-again');
      await page.waitForSelector('.bk-read[data-state="ready"]', { timeout: 30000 });
      await page.waitForSelector('.bk-pg[data-rendered="1"]', { timeout: 30000 });
      await page.unroute('**/api/paper/*/pdf');
    });

    await step('everything that loops moves by transform / opacity only (compositor, no repaint)', async () => {
      await seedLearned(page, { softmax: { title: 'Softmax', record: 'Every score raised and shared.', region: 'Attendale', at: new Date().toISOString() } });
      await page.evaluate(() => localStorage.removeItem('etl-book-learned-seen'));
      await page.goto(`${BASE}/dev/book.html?tab=read`);
      await page.waitForSelector('.bk-pg[data-rendered="1"]', { timeout: 30000 });
      await page.waitForSelector('.bk-tab.bk-new');
      const r = await page.evaluate(() => {
        const ok = new Set(['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity', 'rotate', 'scale', 'translate']);
        const loops = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity);
        const bad = loops.flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !ok.has(p)).map((p) => `${a.animationName || 'waapi'}:${p}`));
        return { n: loops.length, bad: [...new Set(bad)] };
      });
      assert.deepEqual(r.bad, [], 'loops that repaint');
      assert.ok(r.n > 30, `motes, sparks and glow are alive (${r.n} loops)`);
    });

    await step('reduced motion: nothing loops', async () => {
      const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const p = await rm.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${BASE}/dev/book.html?auto=0`);
      await seedLearned(p, { softmax: { title: 'Softmax', record: 'Every score raised and shared.', region: 'Attendale', at: new Date().toISOString() } });
      await p.goto(`${BASE}/dev/book.html?tab=ask`);
      await p.waitForSelector('.bk-tab.bk-new');
      await p.route('**/api/book', async (route) => { await sleep(1500); await route.continue().catch(() => {}); });
      await p.click('.bk-qin');
      await p.keyboard.type('still?');
      await p.keyboard.press('Enter');
      await p.waitForSelector('.bk-dots');
      const loops = () => p.evaluate(() => document.getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
        .map((a) => a.animationName || a.effect?.target?.className || 'waapi'));
      assert.deepEqual(await loops(), [], 'thinking, ember');
      await p.click('.bk-tab[data-tab="read"]');
      await p.waitForSelector('.bk-pg[data-rendered="1"]', { timeout: 30000 });
      assert.deepEqual(await loops(), [], 'reading');
      await rm.close();
    });

    await step('clearBookData() forgets notes, chat, pages and preferences; the save stays', async () => {
      await page.goto(`${BASE}/dev/book.html?tab=notes`);
      await page.waitForSelector('.bk-overlay.is-open');
      const left = await page.evaluate(async () => {
        localStorage.setItem('etl-notes-1234.56789', '[]');
        const m = await import('/js/ui/book.js');
        m.clearBookData();
        return Object.keys(localStorage);
      });
      assert.ok(!left.some((k) => /^etl-(notes|book)-/.test(k)), left.join(', '));
      assert.ok(left.includes('etl-save-v1'), 'the save is not the book\'s to erase');
      await page.waitForSelector('.bk-overlay', { state: 'detached' }); // an open book closes first
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

    assert.deepEqual(errors, [], 'no page errors or console errors');
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
