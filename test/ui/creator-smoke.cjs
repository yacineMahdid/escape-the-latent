// Smoke test for the character creator (public/js/ui/creator.js) and the human models (public/js/engine/humans.js).
//
//   node test/ui/creator-smoke.cjs
//
// Uses a server on CREATOR_TEST_PORT (default 3102); if none is running it starts one: PORT=3102 node server/index.js
// No API key needed: the real server answers /api/avatar with 503 offline; the photo path is exercised with mocked
// /api/status and /api/avatar routes. Needs WebGL (SwiftShader). Screenshots land in test-output/creator-*.png.
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

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/503|Service Unavailable|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

const MOCK_PARAMS = {
  skin: '#c68a62', hairStyle: 'braids', hairColor: '#1f1a1f', eyeColor: '#3f8a5a', glasses: 'square', facialHair: 'none',
  freckles: true, topStyle: 'hoodie', topColor: '#ff9a4a', bottomColor: '#3a3a5a', shoeColor: '#fffdf6', accessory: 'headband',
};

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

// size of a JPEG data URL, measured in the page
const imageSize = (page, dataUrl) => page.evaluate((u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = u; }), dataUrl);

// how much of the preview canvas is covered by the model (drawn into a 2D canvas in the page)
const previewCoverage = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
  const src = document.querySelector('.cr-canvas');
  const c = document.createElement('canvas'); c.width = 120; c.height = 140;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let solid = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 200) solid++;
  resolve(solid / (c.width * c.height));
})));

async function cardVars(page) {
  return page.$eval('.cr-card', (el) => ['--sk', '--hc', '--ec', '--tc', '--bc', '--fc'].map((k) => el.style.getPropertyValue(k)).join(' '));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureServer();
  const browser = await chromium.launch({ args: [...GL_ARGS, ...CAM_ARGS] });
  console.log(`creator smoke on ${BASE}`);
  try {
    // ------------------------------------------------------------------ humans.js
    await step('humans.js: params normalise, every style builds at ~1.9u with feet at 0, Grumm ~9.5u above the desk', async () => {
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
        // Grumm
        const g = H.buildScientist();
        g.updateMatrixWorld(true);
        box.setFromObject(g);
        out.grumm = { min: +box.min.y.toFixed(2), max: +box.max.y.toFixed(2) };
        for (const e of ['grumpy', 'neutral', 'surprised', 'talking']) {
          g.userData.setExpression(e);
          for (let i = 0; i < 30; i++) g.userData.animate(1 / 60, { talking: e === 'talking' });
          if (g.userData.expression() !== e) bad(`expression ${e}`);
        }
        g.updateMatrixWorld(true);
        const above = (o) => new THREE.Box3().setFromObject(o).min.y;
        out.grummAbove = { head: +above(g.userData.parts.head).toFixed(2), mug: +above(g.userData.parts.mug).toFixed(2), hand: +above(g.userData.parts.left.hand).toFixed(2) };
        return out;
      });
      assert.deepEqual(r.problems, []);
      assert.ok(r.grumm.min > -0.05 && r.grumm.min < 0.05, `Grumm feet at ${r.grumm.min}`);
      assert.ok(r.grumm.max > 9 && r.grumm.max < 10.2, `Grumm height ${r.grumm.max}`);
      assert.ok(r.grummAbove.head > 6.2 && r.grummAbove.mug > 5.85 && r.grummAbove.hand > 5.85, `Grumm above the desk: ${JSON.stringify(r.grummAbove)}`);
      assert.deepEqual(errors, []);
      console.log(`    hair heights ${JSON.stringify(r.heights)}; Grumm ${r.grumm.min}..${r.grumm.max}, above desk ${JSON.stringify(r.grummAbove)}; max meshes ${r.meshes}`);
      await page.close();
    });

    await step('gallery: 12 characters + Grumm in every expression + lab framing (screenshots)', async () => {
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
    await step('creator offline: no photo zone, almost no text, randomize + every kind of control, confirm returns params', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = watch(page);
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      await sleep(1200);
      assert.equal(await page.$eval('.cr-card', (el) => el.classList.contains('no-photo')), true, 'offline server: the photo path must not be offered');
      assert.equal(await page.isVisible('.cr-photo'), false);
      assert.equal(await page.isVisible('.cr-offline'), true);
      assert.match(await page.getAttribute('.cr-offline', 'title'), /Claude/);
      // minimal text: no words on the surface (icons only; the name field has a one-word placeholder)
      const text = await page.$eval('.cr-card', (el) => el.innerText);
      assert.equal(/[A-Za-z]{2,}/.test(text), false, `words on the creator surface: ${JSON.stringify(text)}`);
      assert.equal(await page.getAttribute('.cr-name', 'placeholder'), 'name');
      const titled = await page.$$eval('.cr-card button', (bs) => bs.filter((b) => b.offsetParent && !b.title && !b.getAttribute('aria-label')).length);
      assert.equal(titled, 0, 'every visible button has a tooltip');
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
      // clothes tab, with a custom colour from the colour picker
      await page.click('.cr-tab[data-tab="clothes"]');
      await page.click('.cr-chip[data-field="topStyle"][data-value="sweater"]');
      await page.$eval('.cr-any[data-field="topColor"] input', (i) => { i.value = '#123456'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await page.$eval('.cr-any[data-field="topColor"]', (el) => el.classList.contains('on')), true);
      await page.click('.cr-sw[data-field="bottomColor"][data-value="#fffdf6"]');
      await page.click('.cr-sw[data-field="shoeColor"][data-value="#e8566a"]');
      // extras tab
      await page.click('.cr-tab[data-tab="extras"]');
      await page.click('.cr-chip[data-field="glasses"][data-value="round"]');
      await page.click('.cr-chip[data-field="accessory"][data-value="beanie"]');
      assert.equal(await page.$eval('.cr-chip[data-field="accessory"][data-value="beanie"]', (el) => el.getAttribute('aria-pressed')), 'true');
      // drag the turntable a bit, type a name
      const box = await page.$eval('.cr-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y, { steps: 6 }); await page.mouse.up();
      await page.fill('.cr-name', '  Pip  ');
      await sleep(1600);
      await page.screenshot({ path: path.join(OUT, 'creator-manual.png') });
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      const res = await page.evaluate(() => window.__creator.result);
      assert.deepEqual(res, {
        skin: '#8a5636', hairStyle: 'afro', hairColor: '#ff8fc0', eyeColor: '#3a6fb0', glasses: 'round', facialHair: 'mustache', freckles: true,
        topStyle: 'sweater', topColor: '#123456', bottomColor: '#fffdf6', shoeColor: '#e8566a', accessory: 'beanie', name: 'Pip',
      });
      assert.equal(await page.$('.cr-overlay'), null, 'creator removed its DOM');
      assert.equal(await page.evaluate(async () => (await import('/js/ui/modal.js')).isModalOpen()), false, 'modal closed');
      // reopening starts from the last result; Enter in the name field confirms
      await page.click('#open');
      await page.waitForSelector('.cr-card:not(.checking)');
      assert.equal(await page.inputValue('.cr-name'), 'Pip');
      await page.fill('.cr-name', '');
      await page.press('.cr-name', 'Enter');
      await page.waitForFunction(() => window.__creator.closes === 2);
      const res2 = await page.evaluate(() => window.__creator.result);
      assert.equal('name' in res2, false, 'an empty name is not returned');
      assert.equal(res2.hairStyle, 'afro');
      assert.deepEqual(errors, []);
      await page.close();
    });

    // ------------------------------------------------------------------ creator, photo path (mocked AI)
    await step('creator with Claude (mocked): photo is downscaled to a <=768px JPEG, spinner, poof to the new look', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = watch(page);
      const sent = [];
      let release;
      const gate = new Promise((r) => { release = r; });
      await page.route('**/api/status', (r) => r.fulfill({ json: { ai: true, model: 'mock' } }));
      await page.route('**/api/avatar', async (r) => {
        sent.push(JSON.parse(r.request().postData() || '{}'));
        await gate;
        r.fulfill({ json: { params: MOCK_PARAMS } });
      });
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      assert.equal(await page.isVisible('.cr-photo'), true, 'photo zone offered when the AI is on');
      assert.match(await page.getAttribute('.cr-photo', 'title'), /never saved/);
      await sleep(700);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-idle.png') });
      await page.setInputFiles('.cr-file', { name: 'me.png', mimeType: 'image/png', buffer: await makePhoto(page) });
      await page.waitForSelector('.cr-photo[data-state="busy"] .cr-spin', { state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.cr-photo-img')?.complete);
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-busy.png') });
      assert.equal(sent.length, 1);
      assert.match(sent[0].image, /^data:image\/jpeg;base64,/);
      const size = await imageSize(page, sent[0].image);
      assert.equal(Math.max(size.w, size.h), 768, `downscaled to 768 (got ${size.w}x${size.h})`);
      assert.equal(Math.abs(size.w / size.h - 4 / 3) < 0.01, true, 'aspect kept');
      release();
      await page.waitForSelector('.cr-photo[data-state="done"]');
      await sleep(250);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-poof.png') });
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-done.png') });
      await page.fill('.cr-name', 'Mo');
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      assert.deepEqual(await page.evaluate(() => window.__creator.result), { ...MOCK_PARAMS, name: 'Mo' });
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await step('creator with Claude (mocked): drop a photo; a failure shows ⦸ with a tooltip and manual editing goes on', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = watch(page);
      let calls = 0;
      await page.route('**/api/status', (r) => r.fulfill({ json: { ai: true, model: 'mock' } }));
      await page.route('**/api/avatar', (r) => { calls++; r.fulfill({ status: 422, json: { error: 'The mirror clouds over and shows nothing. Try another photo, or shape yourself by hand.' } }); });
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      const b64 = (await makePhoto(page, 900, 1400, 'image/jpeg')).toString('base64');
      await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'drop.jpg', { type: 'image/jpeg' }));
        const zone = document.querySelector('.cr-photo');
        zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, b64);
      await page.waitForSelector('.cr-photo[data-state="error"] .cr-badge', { state: 'visible' });
      assert.equal(calls, 1);
      assert.equal(await page.textContent('.cr-badge'), '⦸');
      assert.match(await page.getAttribute('.cr-badge', 'title'), /mirror/);
      // a non-image is refused locally
      await page.setInputFiles('.cr-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await page.waitForFunction(() => document.querySelector('.cr-badge')?.title === 'Not a photo');
      assert.equal(calls, 1);
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, 'creator-photo-error.png') });
      await page.click('.cr-tab[data-tab="hair"]');
      await page.click('.cr-chip[data-field="hairStyle"][data-value="bun"]');
      await page.click('.cr-ok');
      await page.waitForFunction(() => window.__creator.closes === 1);
      assert.equal((await page.evaluate(() => window.__creator.result)).hairStyle, 'bun');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await step('creator with Claude (mocked): webcam snap (fake camera) sends a <=768px JPEG; real server offline -> ⦸', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.grantPermissions(['camera'], { origin: BASE });
      const page = await ctx.newPage();
      const errors = watch(page);
      const sent = [];
      await page.route('**/api/status', (r) => r.fulfill({ json: { ai: true, model: 'mock' } }));
      // the real (key-less) server answers the avatar call: 503 offline
      page.on('request', (req) => { if (req.url().endsWith('/api/avatar')) sent.push(JSON.parse(req.postData() || '{}')); });
      await page.goto(`${BASE}/dev/creator.html`);
      await page.waitForSelector('.cr-card:not(.checking)');
      await page.click('.cr-cam');
      await page.waitForFunction(() => document.querySelector('.cr-video')?.videoWidth > 0, null, { timeout: 15000 });
      await sleep(500);
      await page.screenshot({ path: path.join(OUT, 'creator-webcam.png') });
      await page.click('.cr-snap');
      await page.waitForSelector('.cr-photo[data-state="error"]');
      assert.equal(sent.length, 1);
      const size = await imageSize(page, sent[0].image);
      assert.ok(Math.max(size.w, size.h) <= 768, `webcam frame downscaled (${size.w}x${size.h})`);
      assert.match(await page.getAttribute('.cr-badge', 'title'), /Claude|key|mirror/i);
      assert.equal(await page.$eval('.cr-video', (v) => v.srcObject), null, 'camera stopped');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    // ------------------------------------------------------------------ the real game: title -> creator -> lab
    await step('game: Start opens the creator, ✓ takes the new character into the lab with Grumm', async () => {
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
