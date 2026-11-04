// Browser check for the server's page and API guards (manual: `node server/test/browser.cjs`).
// Needs Playwright + Chromium. Starts its own offline server (fixture region) on SERVER_TEST_PORT
// (default 3205) and checks, in a real Chromium:
//   1. the game and every dev page load with the Content-Security-Policy and trip no CSP violation;
//   2. an injected <img onerror> (what a model answer could smuggle into innerHTML) does not run;
//   3. DNS rebinding: a page served for evil.example (resolved to 127.0.0.1) cannot use the API;
//   4. another site cannot make the server download papers (cross-site GET / <img> / no-cors fetch).
// Screenshots go to test-output/.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'test-output');
const PORT = Number(process.env.SERVER_TEST_PORT || 3205);
const BASE = `http://localhost:${PORT}`;
const EVIL = `http://evil.example:${PORT}`;

async function startServer(cacheDir) {
  const env = { ...process.env, PORT: String(PORT), REGIONS_DIR: 'server/test/fixtures/regions', PAPERS_CACHE_DIR: cacheDir, ANTHROPIC_API_KEY: '' };
  delete env.ALLOWED_HOSTS;
  delete env.TRUST_PROXY;
  delete env.HOST;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !/running at/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  if (!/running at/.test(log)) throw new Error(`server did not start:\n${log}`);
  return { child, log: () => log };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etl-test-browser-'));
  const server = await startServer(cacheDir);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--host-resolver-rules=MAP evil.example 127.0.0.1',
      // Chromium's own Local Network Access checks would stop the attack pages first; other browsers
      // (and older Chromes) send the requests, so switch them off to test the server's guards.
      '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessForFetch,PrivateNetworkAccessForNavigations,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests',
    ],
  });
  const results = [];
  const step = async (name, fn) => {
    try {
      await fn();
      results.push(`ok   ${name}`);
    } catch (err) {
      results.push(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`);
    }
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Collects CSP violations from the console and from securitypolicyviolation events.
    const watch = async (page) => {
      const violations = [];
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
      await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
      return violations;
    };

    await step('the game loads under its CSP without violations', async () => {
      const page = await context.newPage();
      const violations = await watch(page);
      const res = await page.goto(`${BASE}/`);
      assert.match(res.headers()['content-security-policy'], /script-src 'self' 'wasm-unsafe-eval' 'sha256-/);
      await page.waitForTimeout(2500);
      const fromPage = await page.evaluate(() => window.__csp);
      assert.deepEqual([...violations, ...fromPage], []);
      assert.ok(await page.evaluate(() => document.querySelector('#game canvas, #ui-root *') !== null), 'the title screen rendered');
      await page.screenshot({ path: path.join(OUT, 'server-csp-title.png') });

      // What a model answer could smuggle into innerHTML: the handler must not run.
      await page.evaluate(() => {
        window.__xss = 0;
        document.getElementById('ui-root').insertAdjacentHTML('beforeend', '<img src="x-missing.png" onerror="window.__xss = 1"><a href="javascript:window.__xss=2" id="xl">x</a>');
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.getElementById('xl').click());
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.__xss), 0, 'inline handlers are blocked');
      assert.ok((await page.evaluate(() => window.__csp)).some((v) => /script-src/.test(v)), 'the browser reported the blocked handler');
      await page.close();
    });

    const devPages = fs.readdirSync(path.join(ROOT, 'public', 'dev')).filter((f) => f.endsWith('.html'));
    for (const name of devPages) {
      await step(`/dev/${name} runs its inline scripts under the CSP`, async () => {
        const page = await context.newPage();
        const violations = await watch(page);
        await page.goto(`${BASE}/dev/${name}`);
        await page.waitForTimeout(2000);
        const fromPage = await page.evaluate(() => window.__csp);
        assert.deepEqual([...violations, ...fromPage], []);
        await page.screenshot({ path: path.join(OUT, `server-csp-dev-${name.replace('.html', '')}.png`) });
        await page.close();
      });
    }

    await step('DNS rebinding: a page served as evil.example cannot use the API', async () => {
      const page = await context.newPage();
      // The attacker's page: served by "their" server (here: Playwright), then the name points at us.
      await page.route(`${EVIL}/`, (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><pre id="out"></pre><script>
          (async () => {
            const out = [];
            const status = (p) => p.then((r) => r.status, (e) => 'error ' + e.message);
            out.push('book ' + await status(fetch('/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regionId: 'fixture', question: 'softmax?' }) })));
            out.push('pdf ' + await status(fetch('/api/paper/2106.09685/pdf')));
            out.push('content ' + await status(fetch('/content/regions/fixture.json')));
            document.getElementById('out').textContent = out.join(',');
          })();
        </script>`,
      }));
      await page.goto(`${EVIL}/`);
      await page.waitForFunction(() => document.getElementById('out').textContent.length > 0, null, { timeout: 10000 });
      assert.equal(await page.textContent('#out'), 'book 403,pdf 403,content 403');
      const direct = await page.goto(`${EVIL}/api/status`);
      assert.equal(direct.status(), 403);
      await page.close();
    });

    await step('another site cannot make the server download papers', async () => {
      const page = await context.newPage();
      await page.route('http://127.0.0.1:9/', (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><img src="${BASE}/api/paper/2106.09685/pdf"><script>
          fetch('${BASE}/api/paper/2106.09685/text', { mode: 'no-cors' }).catch(() => {});
          fetch('${BASE}/api/book', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: '{"regionId":"fixture","question":"x"}' }).catch(() => {});
        </script>`,
      }));
      await page.goto('http://127.0.0.1:9/');
      await page.waitForTimeout(1500);
      assert.deepEqual(fs.readdirSync(cacheDir).filter((f) => f.startsWith('2106.09685')), [], 'nothing was downloaded');
      const log = server.log();
      assert.match(log, /GET \/api\/paper\/2106\.09685\/pdf 403/);
      assert.match(log, /GET \/api\/paper\/2106\.09685\/text 403/);
      assert.match(log, /POST \/api\/book 403/);
      await page.close();
    });

    await step('the game itself still reaches the API', async () => {
      const page = await context.newPage();
      await page.goto(`${BASE}/`);
      const out = await page.evaluate(async () => {
        const status = await (await fetch('/api/status')).json();
        const book = await (await fetch('/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regionId: 'fixture', question: 'softmax?' }) })).json();
        const bad = await fetch('/api/grade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        return { status, book, bad: { status: bad.status, body: await bad.json() } };
      });
      assert.equal(out.status.ai, false);
      assert.equal(out.book.offline, true);
      assert.deepEqual(out.bad, { status: 400, body: { error: '✕ which challenge?', code: 'bad_input' } });
      await page.close();
    });
  } finally {
    await browser.close();
    server.child.kill('SIGTERM');
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
