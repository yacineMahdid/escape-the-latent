// Smoke test for the character creator (public/js/ui/creator.js) and the human models (public/js/engine/humans.js).
//
//   node test/ui/creator-smoke.cjs                  (CREATOR_ONLY=webcam runs only the steps whose name has "webcam")
//
// Uses a server on CREATOR_TEST_PORT (default 3102); if none is running it starts one: PORT=3102 node server/index.js
// No API key needed: every /api/status and /api/avatar answer that matters is mocked (so a server that has a key
// is never asked to look at a photo). Needs WebGL (SwiftShader). Screenshots land in test-output/creator-*.png.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.CREATOR_TEST_PORT || 3102);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'test-output');
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const CAM_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;

async function up() {
  try { return (await fetch(`${BASE}/api/status`)).ok; } catch { return false; }
}
async function ensureServer() {
  if (await up()) return;
  server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(250);
  if (!(await up())) throw new Error(`server did not start on ${BASE}`);
}

let passed = 0;
const ONLY = process.env.CREATOR_ONLY || ''; // run only the steps whose name contains this
async function step(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
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

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/50[23]|Service Unavailable|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

const MOCK_PARAMS = {
  skin: '#c68a62', hairStyle: 'braids', hairColor: '#1f1a1f', eyeColor: '#3f8a5a', glasses: 'square', facialHair: 'none',
  freckles: true, topStyle: 'hoodie', topColor: '#ff9a4a', bottomColor: '#3a3a5a', shoeColor: '#fffdf6', accessory: 'headband',
};
const TALL = { hairStyle: 'afro', accessory: 'beanie', hairColor: '#1f1a1f', skin: '#8a5636', topStyle: 'sweater', topColor: '#ffd35a' };
const aiOn = (page) => page.route('**/api/status', (r) => r.fulfill({ json: { ai: true, model: 'mock' } }));

// a big test photo made in the page (so no binary fixtures are needed)
async function makePhoto(page, w = 1600, hgt = 1200, type = 'image/png') {
  const b64 = await page.evaluate(async ({ w, hgt, type }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, hgt); grad.addColorStop(0, '#ffb3cf'); grad.addColorStop(1, '#8fd3ff');
    g.fillStyle = grad; g.fillRect(0, 0, w, hgt);
    g.fillStyle = '#e8b796'; g.beginPath(); g.arc(w / 2, hgt / 2, hgt / 3, 0, 7); g.fill();
    g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(w / 2, hgt / 2 - hgt / 6, hgt / 3, Math.PI, 0); g.fill();
    return c.toDataURL(type).split(',')[1];
  }, { w, hgt, type });
  return Buffer.from(b64, 'base64');
}

// drop a file on an element (synthetic drag events); returns whether dragover / drop were cancelled
async function dropOn(page, selector, b64, { name = 'drop.jpg', type = 'image/jpeg', at = null } = {}) {
  return page.evaluate(async ({ selector, b64, name, type, at }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type }));
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    const [x, y] = at || [r.x + r.width / 2, r.y + r.height / 2];
    const fire = (kind) => { const ev = new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }); el.dispatchEvent(ev); return ev.defaultPrevented; };
    return { enter: fire('dragenter'), over: fire('dragover'), drop: fire('drop') };
  }, { selector, b64, name, type, at });
}

// size of a JPEG data URL, measured in the page
const imageSize = (page, dataUrl) => page.evaluate((u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = u; }), dataUrl);

// how much of the preview canvas (or of its top rows) is covered by the model (drawn into a 2D canvas in the page)
const previewCoverage = (page, rows = 1) => page.evaluate((rows) => new Promise((resolve) => requestAnimationFrame(() => {
  const src = document.querySelector('.cr-canvas');
  const c = document.createElement('canvas'); c.width = 120; c.height = 140;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  const hgt = Math.max(1, Math.round(c.height * rows));
  const d = g.getImageData(0, 0, c.width, hgt).data;
  let solid = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 200) solid++;
  resolve(solid / (c.width * hgt));
})), rows);

async function cardVars(page) {
  return page.$eval('.cr-card', (el) => ['--sk', '--hc', '--ec', '--tc', '--bc', '--fc'].map((k) => el.style.getPropertyValue(k)).join(' '));
}
const rect = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const badgeTip = (page) => page.getAttribute('.cr-badge', 'title');

// records every camera stream the page opens; window.__gumDelay (ms) holds getUserMedia back
const CAM_SPY = () => {
  window.__streams = [];
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const real = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await real(c);
    window.__streams.push(s);
    if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay));
    return s;
  };
};
const liveTracks = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const browser = await chromium.launch({ args: [...GL_ARGS, ...CAM_ARGS] });
  console.log(`creator smoke on ${BASE}`);
  try {
    // ------------------------------------------------------------------ humans.js
    await step('humans.js: params normalise, every style builds at ~1.9u with feet at 0; old scientist model sane', async () => {
      const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
      const errors = watch(page);
      await page.goto(`${BASE}/dev/creator.html?auto=0`);
      const r = await page.evaluate(async () => {
        const THREE = await import('three');
        const H = await import('/js/engine/humans.js');
        const out = { problems: [] };
        const bad = (m) => out.problems.push(m);
        // normalisation
        const d = H.normalizeCharacter({});
        if (JSON.stringify(d) !== JSON.stringify(H.DEFAULT_CHARACTER)) bad('defaults differ');
        const n = H.normalizeCharacter({ skin: 'ABC', hairStyle: ' AFRO ', glasses: 'monocle', freckles: 'true', topColor: 42, name: '  Pip  ', accessory: 'bow' });
        if (n.skin !== '#aabbcc' || n.hairStyle !== 'afro' || n.glasses !== 'none' || n.freckles !== true || n.topColor !== H.DEFAULT_CHARACTER.topColor || n.name !== 'Pip' || n.accessory !== 'bow') bad(`normalize: ${JSON.stringify(n)}`);
        if ('name' in H.normalizeCharacter({ name: '   ' })) bad('blank name kept');
        for (const junk of [null, undefined, 7, 'x', [1, 2]]) if (JSON.stringify(H.normalizeCharacter(junk)) !== JSON.stringify(H.DEFAULT_CHARACTER)) bad(`junk ${junk}`);
        // every hair style / top / accessory / extras combination family
        const box = new THREE.Box3();
        out.heights = {};
        const combos = [];
        for (const hairStyle of H.HAIR_STYLES) combos.push({ hairStyle, accessory: 'none' });
        H.TOP_STYLES.forEach((topStyle, i) => combos.push({ topStyle, accessory: H.ACCESSORIES[i + 1], glasses: H.GLASSES[i % 3], facialHair: H.FACIAL_HAIR[i % 4], freckles: i % 2 === 0 }));
        for (const hairStyle of H.HAIR_STYLES) for (const accessory of ['cap', 'beanie']) combos.push({ hairStyle, accessory });
        for (let i = 0; i < 20; i++) combos.push(H.randomCharacter());
        for (const c of combos) {
          const m = H.buildHuman(c);
          m.updateMatrixWorld(true);
          box.setFromObject(m);
          const key = JSON.stringify(c);
          if (!(Math.abs(box.min.y) < 0.03)) bad(`feet not at 0: ${key} ${box.min.y}`);
          const maxH = c.hairStyle === 'afro' ? 2.5 : 2.35; // the afro is big on purpose
          if (!(box.max.y > 1.8 && box.max.y < maxH)) bad(`height ${box.max.y.toFixed(2)}: ${key}`);
          if (c.accessory === 'none' && !c.topStyle) out.heights[c.hairStyle] = +box.max.y.toFixed(2);
          let meshes = 0, noShadow = 0, nan = 0;
          m.traverse((o) => { if (o.isMesh) { meshes++; if (!o.castShadow) noShadow++; const p = o.geometry.attributes.position.array; for (let i = 0; i < p.length; i += 97) if (!Number.isFinite(p[i])) nan++; } });
          if (noShadow || nan) bad(`shadow/NaN: ${key}`);
          if (!m.userData.handlesFacing || typeof m.userData.animate !== 'function') bad(`api: ${key}`);
          // facing: walking right turns toward +x (~0.9), idle left ~ -0.25
          for (let i = 0; i < 60; i++) m.userData.animate(1 / 60, { moving: true, speed: 1, facing: 1 });
          const yawWalk = m.userData.parts.pivot.rotation.y;
          for (let i = 0; i < 90; i++) m.userData.animate(1 / 60, { moving: false, speed: 0, facing: -1 });
          const yawIdle = m.userData.parts.pivot.rotation.y;
          if (!(yawWalk > 0.8 && yawWalk < 0.95) || !(yawIdle < -0.2 && yawIdle > -0.3)) bad(`facing ${yawWalk.toFixed(2)} ${yawIdle.toFixed(2)}`);
          out.meshes = Math.max(out.meshes || 0, meshes);
          H.disposeModel(m);
        }
        // the old scientist model (dev pages only; the game uses engine/scientist.js)
        const g = H.buildScientist();
        g.updateMatrixWorld(true);
        box.setFromObject(g);
        out.sci = { min: +box.min.y.toFixed(2), max: +box.max.y.toFixed(2) };
        for (const e of ['grumpy', 'neutral', 'surprised', 'talking']) {
          g.userData.setExpression(e);
          for (let i = 0; i < 30; i++) g.userData.animate(1 / 60, { talking: e === 'talking' });
          if (g.userData.expression() !== e) bad(`expression ${e}`);
        }
        g.updateMatrixWorld(true);
        const above = (o) => new THREE.Box3().setFromObject(o).min.y;
        out.sciAbove = { head: +above(g.userData.parts.head).toFixed(2), mug: +above(g.userData.parts.mug).toFixed(2), hand: +above(g.userData.parts.left.hand).toFixed(2) };
        return out;
      });
      assert.deepEqual(r.problems, []);
      assert.ok(r.sci.min > -0.05 && r.sci.min < 0.05, `scientist feet at ${r.sci.min}`);
      assert.ok(r.sci.max > 9 && r.sci.max < 10.2, `scientist height ${r.sci.max} (~5x the Speck)`);
      // the lab (docs/ARCHITECTURE.md): floor y=-9.5, desk top y=0, the scientist x2.42 on the floor -> desk top 3.93 in his units
      const DESK_TOP = 9.5 / 2.42;
      assert.ok(r.sciAbove.head > DESK_TOP + 2 && r.sciAbove.mug > DESK_TOP && r.sciAbove.hand > DESK_TOP, `above the desk top (${DESK_TOP.toFixed(2)}): ${JSON.stringify(r.sciAbove)}`);
      assert.deepEqual(errors, []);
      console.log(`    hair heights ${JSON.stringify(r.heights)}; scientist ${r.sci.min}..${r.sci.max}, above desk ${JSON.stringify(r.sciAbove)}; max meshes ${r.meshes}`);
      await page.close();
    });

    await step('gallery: 12 characters + the old scientist in every expression (screenshots)', async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const errors = watch(page);
      await page.goto(`${BASE}/dev/humans.html?spin=0&still=1`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
      await sleep(600);
      await page.screenshot({ path: path.join(OUT, 'creator-gallery.png'), timeout: 120000 });
      await page.goto(`${BASE}/dev/humans.html?spin=0&still=1&face=1&angle=0.2`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
      await sleep(600);
      await page.screenshot({ path: path.join(OUT, 'creator-gallery-faces.png'), timeout: 120000 });
      assert.deepEqual(errors, []);
      await page.close();
    });

    // ------------------------------------------------------------------ creator, manual (real offline server)
    await step('creator offline: no photo zone, no words, randomize + every kind of control, ✓ / Enter return params', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = watch(page);
      await page.route('**/api/status', (r) => r.fulfill({ json: { ai: false, model: 'mock' } })); // even if the server has a key
      const initial = encodeURIComponent(JSON.stringify({ name: 'Pip' }));
      await page.goto(`${BASE}/dev/creator.html?initial=${initial}`);
      await page.waitForSelector('.cr-card:not(.checking)');
      await sleep(1200);
      assert.equal(await page.$eval('.cr-card', (el) => el.classList.contains('no-photo')), true, 'offline server: the photo path must not be offered');
      assert.equal(await page.isVisible('.cr-photo'), false);
      assert.ok((await rect(page, '.cr-stage')).w > 650, 'the stage takes the photo column');
      // minimal text: no words on the surface, no name field, no offline chip; every tooltip is a word or a few
      const text = await page.$eval('.cr-card', (el) => el.innerText);
      assert.equal(/[A-Za-z]{2,}/.test(text), false, `words on the creator surface: ${JSON.stringify(text)}`);
      assert.equal(await page.$('.cr-card input[type="text"], .cr-name, .cr-offline'), null, 'no name field / offline chip');
      const tips = await page.$$eval('.cr-card [title]', (els) => els.map((e) => e.title));
      const wordy = tips.filter((t) => (t.match(/[A-Za-z]+/g) || []).length > 4);
      assert.deepEqual(wordy, [], 'tooltips of 4 words at most');
      const untitled = await page.$$eval('.cr-card button', (bs) => bs.filter((b) => b.offsetParent && !b.title && !b.getAttribute('aria-label')).length);
      assert.equal(untitled, 0, 'every visible button has a tooltip');
      assert.ok((await previewCoverage(page)) > 0.03, 'the 3D preview draws the character');

      const before = await cardVars(page);
      await page.click('.cr-dice');
      await sleep(400);
      assert.notEqual(await cardVars(page), before, 'randomize changes the look');

      // face tab
      await page.click('.cr-tab[data-tab="face"]');
      await page.click('.cr-sw[data-field="skin"][data-value="#8a5636"]');
      await page.click('.cr-sw[data-field="eyeColor"][data-value="#3a6fb0"]');
      await page.click('.cr-chip[data-field="facialHair"][data-value="mustache"]');
      await page.click('.cr-chip[data-field="freckles"][data-value="true"]');
      // hair tab
      await page.click('.cr-tab[data-tab="hair"]');
      await page.click('.cr-chip[data-field="hairStyle"][data-value="afro"]');
      await page.click('.cr-sw[data-field="hairColor"][data-value="#ff8fc0"]');
      // clothes tab, with a custom colour from the colour picker (reachable with the keyboard)
      await page.click('.cr-tab[data-tab="clothes"]');
      await page.click('.cr-chip[data-field="topStyle"][data-value="sweater"]');
      assert.notEqual(await page.getAttribute('.cr-any[data-field="topColor"] input', 'tabindex'), '-1', 'colour picker is focusable');
      await page.$eval('.cr-any[data-field="topColor"] input', (i) => { i.value = '#123456'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await page.$eval('.cr-any[data-field="topColor"]', (el) => el.classList.contains('on')), true);
      await page.click('.cr-sw[data-field="bottomColor"][data-value="#fffdf6"]');
      await page.click('.cr-sw[data-field="shoeColor"][data-value="#e8566a"]');
      // extras tab; Enter on a focused chip picks the chip, it does not confirm
      await page.click('.cr-tab[data-tab="extras"]');
      await page.click('.cr-chip[data-field="glasses"][data-value="round"]');
      await page.focus('.cr-chip[data-field="accessory"][data-value="beanie"]');
      await page.keyboard.press('Enter');
      await sleep(200);
      assert.equal(await page.$eval('.cr-chip[data-field="accessory"][data-value="beanie"]', (el) => el.getAttribute('aria-pressed')), 'true');
      assert.equal(await page.evaluate(() => window.__creator.closes), 0, 'Enter on a chip does not confirm');
      // drag the turntable a bit
      const box = await page.$eval('.cr-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y, { steps: 6 }); await page.mouse.up();
      await sleep(1600);
      await page.screenshot({ path: path.join(OUT, 'creator-manual.png') });
      // the tall afro + beanie fits the preview, even mid-hop (sampled through a hop)
      await page.mouse.click(box.x, box.y);
      let topRows = 0;
      for (let i = 0; i < 12; i++) topRows = Math.max(topRows, await previewCoverage(page, 0.02));
      assert.equal(topRows, 0, 'nothing reaches the top edge of the preview');
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      const res = await page.evaluate(() => window.__creator.result);
      assert.deepEqual(res, {
        skin: '#8a5636', hairStyle: 'afro', hairColor: '#ff8fc0', eyeColor: '#3a6fb0', glasses: 'round', facialHair: 'mustache', freckles: true,
        topStyle: 'sweater', topColor: '#123456', bottomColor: '#fffdf6', shoeColor: '#e8566a', accessory: 'beanie', name: 'Pip',
      }, 'all choices, and the name it was given');
      assert.equal(await page.$('.cr-overlay'), null, 'creator removed its DOM');
      assert.equal(await page.evaluate(async () => (await import('/js/ui/modal.js')).isModalOpen()), false, 'modal closed');
      // reopening starts from the last result; Enter (focus on the card, not on a control) confirms
      await page.click('#open');
      await page.waitForSelector('.cr-card:not(.checking)');
      await sleep(600);
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cr-card')), true, 'the card takes the focus');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__creator.closes === 2);
      const res2 = await page.evaluate(() => window.__creator.result);
      assert.equal(res2.hairStyle, 'afro');
      assert.equal(res2.name, 'Pip');
      assert.deepEqual(errors, []);
      await page.close();
    });

    // ------------------------------------------------------------------ creator, photo path (mocked AI)
    await step('creator with Claude (mocked): photo downscaled to a <=768px JPEG; edits made while it waits are kept', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = watch(page);
      const sent = [];
      let release;
      const gate = new Promise((r) => { release = r; });
      await aiOn(page);
      await page.route('**/api/avatar', async (r) => {
        sent.push(JSON.parse(r.request().postData() || '{}'));
        await gate;
        r.fulfill({ json: { params: MOCK_PARAMS } });
      });
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      assert.equal(await page.isVisible('.cr-photo'), true, 'photo zone offered when the AI is on');
      assert.match(await page.getAttribute('.cr-frame', 'title'), /never saved/);
      assert.equal(await page.getAttribute('.cr-frame', 'role'), 'button');
      assert.equal(await page.$('.cr-photo[role="button"], [role="button"] button'), null, 'no buttons inside a button');
      await sleep(700);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-idle.png') });
      await page.setInputFiles('.cr-file', { name: 'me.png', mimeType: 'image/png', buffer: await makePhoto(page) });
      await page.waitForSelector('.cr-photo[data-state="busy"] .cr-spin', { state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.cr-photo-img')?.complete);
      // while Claude looks: 🎲 and ✓ wait; the swatches stay live and win over the answer
      assert.equal(await page.isDisabled('.cr-ok'), true, '✓ waits for the photo');
      assert.equal(await page.isDisabled('.cr-dice'), true, '🎲 waits for the photo');
      await page.click('.cr-tab[data-tab="clothes"]');
      await page.click('.cr-chip[data-field="topStyle"][data-value="dress"]');
      await page.click('.cr-sw[data-field="shoeColor"][data-value="#e8566a"]');
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-busy.png') });
      assert.equal(sent.length, 1);
      assert.match(sent[0].image, /^data:image\/jpeg;base64,/);
      const size = await imageSize(page, sent[0].image);
      assert.equal(Math.max(size.w, size.h), 768, `downscaled to 768 (got ${size.w}x${size.h})`);
      assert.equal(Math.abs(size.w / size.h - 4 / 3) < 0.01, true, 'aspect kept');
      release();
      await page.waitForSelector('.cr-photo[data-state="done"]');
      assert.equal(await page.isDisabled('.cr-ok'), false);
      await sleep(250);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-poof.png') });
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-done.png') });
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      assert.deepEqual(await page.evaluate(() => window.__creator.result), { ...MOCK_PARAMS, topStyle: 'dress', shoeColor: '#e8566a' });
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await step('creator with Claude (mocked): drops anywhere, every failure shows ⦸ + a word and keeps the look', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = watch(page);
      const answers = [
        { status: 422, json: { error: '✕ clouded', code: 'refused' } },
        { status: 503, json: { error: '… busy', code: 'busy', retryable: true } },
        { status: 200, json: { nope: 1 } },
        { status: 200, body: 'not json', contentType: 'text/plain' },
      ];
      let calls = 0, hold = null;
      await aiOn(page);
      await page.route('**/api/avatar', async (r) => {
        const a = answers[calls++] || { status: 200, json: { params: MOCK_PARAMS } };
        if (hold) await hold;
        r.fulfill(a);
      });
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      const b64 = (await makePhoto(page, 900, 1400, 'image/jpeg')).toString('base64');
      const look = await cardVars(page);
      // 422 refused: the server's word
      assert.deepEqual(await dropOn(page, '.cr-photo', b64), { enter: true, over: true, drop: true });
      await page.waitForSelector('.cr-photo[data-state="error"] .cr-badge', { state: 'visible' });
      assert.equal(await page.textContent('.cr-badge'), '⦸');
      assert.equal(await badgeTip(page), '✕ clouded');
      // a non-image is refused locally
      await page.setInputFiles('.cr-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await page.waitForFunction(() => document.querySelector('.cr-badge')?.title === '✕ not a photo');
      assert.equal(calls, 1);
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-error.png') });
      // a drop on the backdrop, outside the card, is taken too (the browser must never open the file)
      const card = await rect(page, '.cr-card');
      assert.deepEqual(await dropOn(page, '.cr-overlay', b64, { at: [card.x / 2, card.y + 40] }), { enter: true, over: true, drop: true });
      // 503 busy: the server's word, and the photo stays on offer
      await page.waitForFunction(() => document.querySelector('.cr-badge')?.title === '… busy');
      assert.equal(await page.$eval('.cr-card', (el) => el.classList.contains('no-photo')), false, 'busy is not offline');
      // 200 without params, then a 200 that is not JSON: ⦸, and the look does not change
      await page.setInputFiles('.cr-file', { name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
      await page.waitForFunction(() => document.querySelector('.cr-badge')?.title === '✕ cloudy');
      await page.setInputFiles('.cr-file', { name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
      for (let i = 0; i < 100 && calls < 4; i++) await sleep(100);
      assert.equal(calls, 4);
      await page.waitForFunction(() => document.querySelector('.cr-photo')?.dataset.state === 'error');
      assert.equal(await badgeTip(page), '✕ cloudy');
      assert.equal(await cardVars(page), look, 'a bad answer keeps the current look');
      // cancel while Claude looks: a click on the frame, or Esc
      let free;
      hold = new Promise((r) => { free = r; });
      await page.setInputFiles('.cr-file', { name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
      await page.waitForSelector('.cr-photo[data-state="busy"]');
      assert.equal(await page.getAttribute('.cr-frame', 'title'), 'Cancel');
      await page.click('.cr-frame');
      await page.waitForSelector('.cr-photo[data-state="idle"]');
      assert.equal(await page.isDisabled('.cr-ok'), false);
      await page.setInputFiles('.cr-file', { name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
      await page.waitForSelector('.cr-photo[data-state="busy"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.cr-photo[data-state="idle"]');
      free();
      await sleep(500);
      assert.equal(await page.getAttribute('.cr-photo', 'data-state'), 'idle', 'a cancelled answer is ignored');
      assert.equal(await cardVars(page), look);
      await page.click('.cr-tab[data-tab="hair"]');
      await page.click('.cr-chip[data-field="hairStyle"][data-value="bun"]');
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      assert.equal((await page.evaluate(() => window.__creator.result)).hairStyle, 'bun');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await step('creator with Claude (mocked): webcam (fake camera) never leaks a stream; offline folds the photo away', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.grantPermissions(['camera'], { origin: BASE });
      await ctx.addInitScript(CAM_SPY);
      const page = await ctx.newPage();
      const errors = watch(page);
      const sent = [];
      const answers = [
        { status: 503, json: { error: '… busy', code: 'busy', retryable: true } },
        { status: 503, json: { error: '✕ asleep', code: 'offline', offline: true } },
      ];
      await aiOn(page);
      await page.route('**/api/avatar', (r) => { sent.push(JSON.parse(r.request().postData() || '{}')); r.fulfill(answers[sent.length - 1]); });
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      // a double click opens one camera
      await page.dblclick('.cr-cam');
      await page.waitForFunction(() => document.querySelector('.cr-video')?.videoWidth > 0, null, { timeout: 15000 });
      await sleep(500);
      assert.equal(await page.evaluate(() => window.__streams.length), 1, 'one stream for a double click');
      await page.screenshot({ path: path.join(OUT, 'creator-webcam.png') });
      // snap: a <=768px frame goes out, the camera stops; 503 busy keeps the photo on offer
      await page.click('.cr-snap');
      await page.waitForSelector('.cr-photo[data-state="error"]');
      assert.equal(sent.length, 1);
      const size = await imageSize(page, sent[0].image);
      assert.ok(Math.max(size.w, size.h) <= 768, `webcam frame downscaled (${size.w}x${size.h})`);
      assert.equal(await badgeTip(page), '… busy');
      assert.equal(await liveTracks(page), 0, 'camera stopped after the snap');
      // camera on again, then a dropped photo: the camera stops and the photo shows
      await page.click('.cr-cam');
      await page.waitForFunction(() => document.querySelector('.cr-video')?.videoWidth > 0, null, { timeout: 15000 });
      const b64 = (await makePhoto(page, 800, 1000, 'image/jpeg')).toString('base64');
      await dropOn(page, '.cr-stage', b64);
      await page.waitForSelector('.cr-photo[data-state="error"]');
      assert.equal(await liveTracks(page), 0, 'a dropped photo stops the camera');
      assert.equal(await page.$eval('.cr-photo', (el) => el.classList.contains('cam')), false);
      // 503 offline (no key, or a key turned away): ⦸ "offline", then the polaroid folds away
      assert.equal(await badgeTip(page), '✕ offline');
      await page.waitForSelector('.cr-card.no-photo', { timeout: 5000 });
      await page.waitForSelector('.cr-photo', { state: 'hidden', timeout: 5000 });
      await page.waitForFunction(() => document.querySelector('.cr-stage').getBoundingClientRect().width > 650, null, { timeout: 5000 });
      assert.equal(sent.length, 2);
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      assert.equal(await liveTracks(page), 0, 'no live camera after ✓');
      // a camera that is still opening when ✓ is pressed is stopped when it arrives
      await page.unroute('**/api/status');
      await aiOn(page);
      await page.click('#open');
      await page.waitForSelector('.cr-card:not(.checking):not(.no-photo)');
      await page.evaluate(() => { window.__gumDelay = 900; });
      await page.click('.cr-cam');
      await sleep(150);
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 2);
      await page.waitForFunction(() => window.__streams.length === 3, null, { timeout: 10000 });
      await sleep(1200);
      assert.equal(await liveTracks(page), 0, 'the late camera was stopped');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    // ------------------------------------------------------------------ layouts
    await step('layouts: tablet, phone landscape, slow /api/status (no jumps, round buttons, stage in view)', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const page = await ctx.newPage();
      const errors = watch(page);
      await aiOn(page);
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      await sleep(900);
      for (const sel of ['.cr-dice', '.cr-ok']) {
        const b = await rect(page, sel);
        assert.ok(Math.abs(b.w - b.h) < 1, `${sel} is round at 1024x768 (${b.w}x${b.h})`);
      }
      assert.ok((await rect(page, '.cr-stage')).w >= 340, 'the stage keeps >= 340px next to the polaroid');
      await page.screenshot({ path: path.join(OUT, 'creator-tablet.png') });
      // phone in landscape: one row, the character in the first screen
      await page.setViewportSize({ width: 844, height: 390 });
      await sleep(900);
      const st = await rect(page, '.cr-stage');
      assert.ok(st.y >= 0 && st.y + st.h <= 390 && st.h > 280, `stage in view: ${JSON.stringify(st)}`);
      assert.ok((await rect(page, '.cr-photo')).x < st.x, 'polaroid beside the stage');
      assert.ok((await previewCoverage(page)) > 0.03, 'the character is drawn');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 844, 'no sideways scroll');
      await page.screenshot({ path: path.join(OUT, 'creator-phone-land.png') });
      await ctx.close();
      // a slow /api/status: the stage keeps its width when the polaroid shows up
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page2 = await ctx2.newPage();
      errors.push(...watch(page2));
      await page2.route('**/api/status', async (r) => { await sleep(2500); r.fulfill({ json: { ai: true, model: 'mock' } }); });
      await page2.goto(`${BASE}/dev/creator.html`);
      await page2.waitForSelector('.cr-card.checking');
      await sleep(700);
      const w0 = (await rect(page2, '.cr-stage')).w;
      await page2.waitForSelector('.cr-card:not(.checking)', { timeout: 8000 });
      await sleep(600);
      const w1 = (await rect(page2, '.cr-stage')).w;
      assert.ok(Math.abs(w0 - w1) < 1, `stage width ${w0} -> ${w1}`);
      assert.equal(await page2.isVisible('.cr-photo'), true);
      await ctx2.close();
      // no answer at all: after 5 s the photo column folds away; a late "AI on" brings it back
      const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page3 = await ctx3.newPage();
      errors.push(...watch(page3));
      let answer;
      const late = new Promise((r) => { answer = r; });
      await page3.route('**/api/status', async (r) => { await late; r.fulfill({ json: { ai: true, model: 'mock' } }); });
      await page3.goto(`${BASE}/dev/creator.html`);
      await page3.waitForSelector('.cr-card.checking');
      await page3.waitForSelector('.cr-card.no-photo', { timeout: 9000 });
      await page3.waitForFunction(() => document.querySelector('.cr-stage').getBoundingClientRect().width > 650, null, { timeout: 5000 });
      answer();
      await page3.waitForSelector('.cr-card:not(.no-photo):not(.checking)', { timeout: 5000 });
      await page3.waitForSelector('.cr-photo', { state: 'visible' });
      await page3.waitForFunction(() => Math.abs(document.querySelector('.cr-stage').getBoundingClientRect().width - 422) < 30, null, { timeout: 5000 });
      assert.deepEqual(errors, []);
      await ctx3.close();
    });

    // ------------------------------------------------------------------ the real game: title -> creator -> lab
    await step('game: Start opens the creator, ✓ takes the new character into the lab', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = watch(page);
      await page.goto(`${BASE}/`);
      await page.waitForSelector('.title-btns .etl-btn');
      // the title screen belongs to core and may be animated: click through the DOM
      await page.$eval('.title-btns .etl-btn', (b) => b.click());
      await page.waitForSelector('.cr-card:not(.checking)', { timeout: 20000 });
      await page.click('.cr-dice');
      await page.click('.cr-tab[data-tab="hair"]');
      await page.click('.cr-chip[data-field="hairStyle"][data-value="ponytail"]');
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, 'creator-in-game.png') });
      await page.click('.cr-ok');
      await page.waitForFunction(() => !document.querySelector('.cr-overlay'));
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('etl-save-v1') || '{}').character);
      assert.equal(saved?.hairStyle, 'ponytail');
      await page.waitForSelector('.dlg', { timeout: 30000 });
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, 'creator-lab.png') });
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    console.log(`creator smoke: ${passed} passed`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
})().catch((err) => {
  console.error(err);
  if (server) server.kill();
  process.exit(1);
});
