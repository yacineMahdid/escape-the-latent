// Static serving: MIME types, vendor + content routes, caching headers, ranges and path traversal.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { startTestServer, request, tmpDir, ROOT, FIXTURE } from './helpers.mjs';
import { inlineScriptHashes } from '../index.js';

const sha256 = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const directive = (csp, name) => csp.split(/;\s*/).find((d) => d.startsWith(`${name} `)) || '';

// The page contract: what the policy must say, whatever the page.
function assertPolicy(csp) {
  assert.equal(directive(csp, 'default-src'), "default-src 'self'");
  assert.equal(directive(csp, 'object-src'), "object-src 'none'");
  assert.equal(directive(csp, 'base-uri'), "base-uri 'none'");
  assert.equal(directive(csp, 'frame-ancestors'), "frame-ancestors 'self'");
  const script = directive(csp, 'script-src');
  assert.match(script, /^script-src 'self'/);
  assert.doesNotMatch(script, /'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|\*|https?:|data:|blob:/, 'no inline handlers, eval or other hosts');
  assert.match(directive(csp, 'style-src'), /fonts\.googleapis\.com/);
  assert.match(directive(csp, 'font-src'), /fonts\.gstatic\.com/);
  assert.match(directive(csp, 'img-src'), /data: blob:/);
}

const FILES = {
  'index.html': ['<!doctype html><title>fixture home</title>', 'text/html; charset=utf-8'],
  'app.js': ['export const hello = 1;', 'text/javascript; charset=utf-8'],
  'lib/mod.mjs': ['export default 2;', 'text/javascript; charset=utf-8'],
  'css/style.css': ['body { color: #2b2233; }', 'text/css; charset=utf-8'],
  'data.json': ['{"ok":true}', 'application/json; charset=utf-8'],
  'img/pixel.png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
  'img/photo.jpg': [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
  'img/icon.svg': ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
  'wasm/tiny.wasm': [Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), 'application/wasm'],
  'docs/tiny.pdf': ['%PDF-1.4\n%%EOF\n', 'application/pdf'],
  'app.js.map': ['{"version":3,"sources":[]}', 'application/json; charset=utf-8'],
  'favicon.ico': [Buffer.from([0, 0, 1, 0]), 'image/x-icon'],
  'notes.txt': ['plain notes', 'text/plain; charset=utf-8'],
  'readme.md': ['# Readme', 'text/markdown; charset=utf-8'],
  'fonts/paper.woff2': [Buffer.from('wOF2fake'), 'font/woff2'],
  'mystery.xyz': ['???', 'application/octet-stream'],
};

const IMPORT_MAP = '{ "imports": { "three": "/vendor/three/three.module.js" } }';
const INLINE_MODULE = "\nimport * as THREE from 'three';\ndocument.title = 'ok';\n";
const SCRIPTED_PAGE = [
  '<!doctype html><html><head>',
  `<script type="importmap">${IMPORT_MAP}</script>`,
  '<script type="module" src="/app.js"></script>',
  '</head><body>',
  `<SCRIPT type="module">${INLINE_MODULE}</SCRIPT >`,
  '</body></html>',
].join('\n');

describe('static files from public/', () => {
  let srv;
  let pub;
  let outside;

  before(async () => {
    const base = tmpDir();
    pub = path.join(base, 'public');
    for (const [rel, [content]] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(pub, rel)), { recursive: true });
      fs.writeFileSync(path.join(pub, rel), content);
    }
    fs.writeFileSync(path.join(pub, '.env'), 'SECRET=dotfile');
    fs.mkdirSync(path.join(pub, '.git'));
    fs.writeFileSync(path.join(pub, '.git', 'config'), 'SECRET=gitconfig');
    outside = path.join(base, 'outside-secret.txt');
    fs.writeFileSync(outside, 'SECRET=outside');
    try { fs.symlinkSync(outside, path.join(pub, 'sneaky-link.txt')); } catch { /* symlinks unsupported */ }
    srv = await startTestServer({ publicDir: pub });
  });
  after(() => srv.close());

  it('sends a Content-Security-Policy with every HTML page, hashing its own inline scripts', async () => {
    fs.writeFileSync(path.join(pub, 'scripted.html'), SCRIPTED_PAGE);
    const res = await request(srv.port, { path: '/scripted.html' });
    assert.equal(res.status, 200);
    const csp = res.headers['content-security-policy'];
    assertPolicy(csp);
    const script = directive(csp, 'script-src');
    assert.ok(script.includes(sha256(IMPORT_MAP)), 'the import map runs');
    assert.ok(script.includes(sha256(INLINE_MODULE)), 'the inline module runs');
    assert.equal(script.match(/'sha256-/g).length, 2, 'scripts with src= are not hashed');
    const plain = await request(srv.port, { path: '/' });
    assertPolicy(plain.headers['content-security-policy']);
    assert.doesNotMatch(plain.headers['content-security-policy'], /sha256/);
  });

  it('re-hashes a page when it changes, and hashes CRLF scripts the way browsers read them', async () => {
    const file = path.join(pub, 'changing.html');
    fs.writeFileSync(file, '<script>let a = 1;\r\nlet b = 2;</script>');
    const first = await request(srv.port, { path: '/changing.html' });
    assert.ok(first.headers['content-security-policy'].includes(sha256('let a = 1;\nlet b = 2;')));
    fs.writeFileSync(file, '<script>window.changed = true;</script><!-- and longer now -->');
    const second = await request(srv.port, { path: '/changing.html' });
    assert.ok(second.headers['content-security-policy'].includes(sha256('window.changed = true;')));
    assert.equal(inlineScriptHashes('<script src="/x.js"></script><p>no inline code</p>').length, 0);
  });

  it('sends no CSP with scripts (workers keep their own policy)', async () => {
    const res = await request(srv.port, { path: '/app.js' });
    assert.equal(res.headers['content-security-policy'], undefined);
  });

  it('serves / as index.html', async () => {
    const res = await request(srv.port, { path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(res.text, /fixture home/);
  });

  for (const [rel, [content, type]] of Object.entries(FILES)) {
    it(`serves /${rel} as ${type}`, async () => {
      const res = await request(srv.port, { path: `/${rel}` });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], type);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(res.body, Buffer.from(content));
      assert.equal(Number(res.headers['content-length']), res.body.length);
    });
  }

  it('decodes percent-encoded names', async () => {
    fs.writeFileSync(path.join(pub, 'hello world.txt'), 'spaced');
    const res = await request(srv.port, { path: '/hello%20world.txt' });
    assert.equal(res.status, 200);
    assert.equal(res.text, 'spaced');
  });

  it('ignores query strings', async () => {
    const res = await request(srv.port, { path: '/app.js?v=123#frag' });
    assert.equal(res.status, 200);
    assert.equal(res.text, 'export const hello = 1;');
  });

  it('answers HEAD with headers only', async () => {
    const res = await request(srv.port, { method: 'HEAD', path: '/css/style.css' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(Number(res.headers['content-length']), FILES['css/style.css'][0].length);
    assert.equal(res.body.length, 0);
  });

  it('revalidates with ETag / If-None-Match (304)', async () => {
    const first = await request(srv.port, { path: '/app.js' });
    assert.ok(first.headers.etag);
    assert.equal(first.headers['cache-control'], 'no-cache');
    const again = await request(srv.port, { path: '/app.js', headers: { 'if-none-match': first.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
  });

  it('serves byte ranges (206) and rejects unsatisfiable ones (416)', async () => {
    const full = FILES['readme.md'][0];
    const part = await request(srv.port, { path: '/readme.md', headers: { range: 'bytes=2-4' } });
    assert.equal(part.status, 206);
    assert.equal(part.text, full.slice(2, 5));
    assert.equal(part.headers['content-range'], `bytes 2-4/${full.length}`);
    const suffix = await request(srv.port, { path: '/readme.md', headers: { range: 'bytes=-3' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.text, full.slice(-3));
    const bad = await request(srv.port, { path: '/readme.md', headers: { range: 'bytes=999-' } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers['content-range'], `bytes */${full.length}`);
  });

  it('404s for missing files and directories without an index', async () => {
    for (const p of ['/nope.js', '/css/', '/img', '/css/missing.css']) {
      const res = await request(srv.port, { path: p });
      assert.equal(res.status, 404, p);
    }
  });

  it('never serves dotfiles or dot directories', async () => {
    for (const p of ['/.env', '/.git/config', '/%2eenv', '/css/../.env']) {
      const res = await request(srv.port, { path: p });
      assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
      assert.doesNotMatch(res.text, /SECRET/);
    }
  });

  it('does not follow symlinks out of the served folder', async (t) => {
    if (!fs.existsSync(path.join(pub, 'sneaky-link.txt'))) return t.skip('symlinks not supported here');
    const res = await request(srv.port, { path: '/sneaky-link.txt' });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /SECRET/);
    return undefined;
  });

  it('only allows GET and HEAD', async () => {
    const res = await request(srv.port, { method: 'POST', path: '/app.js', body: 'x' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET, HEAD');
  });

  it('blocks path traversal in every disguise', async () => {
    const attempts = [
      '/../outside-secret.txt',
      '/../../package.json',
      '/%2e%2e/outside-secret.txt',
      '/%2E%2E/%2E%2E/package.json',
      '/..%2foutside-secret.txt',
      '/..%2f..%2fpackage.json',
      '/%2e%2e%2f%2e%2e%2fpackage.json',
      '/css/..%2f..%2foutside-secret.txt',
      '/..%5coutside-secret.txt',
      '/..\\outside-secret.txt',
      '/vendor/three/../../../package.json',
      '/vendor/three/..%2f..%2f..%2fpackage.json',
      '/vendor/pdfjs/..%2f..%2fthree%2fpackage.json',
      '/vendor/pdfjs-web/%2e%2e/%2e%2e/%2e%2e/server/ai.js',
      '/content/..%2fpackage.json',
      '/content/regions/..%2f..%2fserver%2fai.js',
      '/%00/etc/passwd',
      '/app.js%00.png',
      '/%E0%A4%A',
      '//etc/passwd',
      '/./app.js',
    ];
    for (const p of attempts) {
      const res = await request(srv.port, { path: p });
      assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
      assert.doesNotMatch(res.text, /SECRET|escape-the-latent|anthropic-ai/, p);
    }
  });
});

describe('the real public/ folder', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  it('lets the real pages run their own inline scripts (import map included)', async () => {
    for (const page of ['index.html', ...fs.readdirSync(path.join(ROOT, 'public', 'dev')).filter((f) => f.endsWith('.html')).map((f) => `dev/${f}`)]) {
      const res = await request(srv.port, { path: page === 'index.html' ? '/' : `/${page}` });
      assert.equal(res.status, 200, page);
      const csp = res.headers['content-security-policy'];
      assertPolicy(csp);
      for (const hash of inlineScriptHashes(fs.readFileSync(path.join(ROOT, 'public', page), 'utf8'))) {
        assert.ok(directive(csp, 'script-src').includes(hash), `${page}: ${hash}`);
      }
    }
    const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(index)[1];
    const res = await request(srv.port, { path: '/' });
    assert.ok(res.headers['content-security-policy'].includes(sha256(map)));
  });

  it('serves the shared front-end modules', async () => {
    const css = await request(srv.port, { path: '/css/game.css' });
    assert.equal(css.status, 200);
    assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
    assert.match(css.text, /--paper:/);
    const js = await request(srv.port, { path: '/js/api.js' });
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  });

  it('never serves server code or reference solutions', async () => {
    for (const p of ['/server/ai.js', '/server/solutions/', '/package.json', '/node_modules/three/package.json', '/docs/ARCHITECTURE.md']) {
      const res = await request(srv.port, { path: p });
      assert.equal(res.status, 404, p);
    }
  });
});

describe('vendor routes', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  const cases = [
    ['/vendor/three/three.module.js', 'node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8'],
    ['/vendor/pdfjs/pdf.mjs', 'node_modules/pdfjs-dist/build/pdf.mjs', 'text/javascript; charset=utf-8'],
    ['/vendor/pdfjs/pdf.worker.mjs', 'node_modules/pdfjs-dist/build/pdf.worker.mjs', 'text/javascript; charset=utf-8'],
    ['/vendor/pdfjs/pdf.mjs.map', 'node_modules/pdfjs-dist/build/pdf.mjs.map', 'application/json; charset=utf-8'],
    ['/vendor/pdfjs-web/pdf_viewer.css', 'node_modules/pdfjs-dist/web/pdf_viewer.css', 'text/css; charset=utf-8'],
    ['/vendor/pdfjs-web/pdf_viewer.mjs', 'node_modules/pdfjs-dist/web/pdf_viewer.mjs', 'text/javascript; charset=utf-8'],
    ['/vendor/pdfjs-cmaps/78-EUC-H.bcmap', 'node_modules/pdfjs-dist/cmaps/78-EUC-H.bcmap', 'application/octet-stream'],
    ['/vendor/pdfjs-cmaps/UniJIS-UTF16-H.bcmap', 'node_modules/pdfjs-dist/cmaps/UniJIS-UTF16-H.bcmap', 'application/octet-stream'],
    ['/vendor/pdfjs-fonts/FoxitSerif.pfb', 'node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb', 'application/octet-stream'],
    ['/vendor/pdfjs-fonts/LiberationSans-Regular.ttf', 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', 'font/ttf'],
  ];
  for (const [url, file, type] of cases) {
    it(`${url} -> ${file}`, async () => {
      const res = await request(srv.port, { path: url });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], type);
      assert.deepEqual(res.body, fs.readFileSync(path.join(ROOT, file)));
    });
  }

  it('serves pdf.js viewer images with their types', async () => {
    const svg = fs.readdirSync(path.join(ROOT, 'node_modules/pdfjs-dist/web/images')).find((f) => f.endsWith('.svg'));
    const res = await request(srv.port, { path: `/vendor/pdfjs-web/images/${svg}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/svg+xml');
  });

  it('404s for missing vendor files and bare vendor folders', async () => {
    for (const p of ['/vendor/three/nope.js', '/vendor/three/', '/vendor/pdfjs/', '/vendor/', '/vendor/three']) {
      const res = await request(srv.port, { path: p });
      assert.equal(res.status, 404, p);
    }
  });

  it('only exposes the build folders', async () => {
    for (const p of ['/vendor/three/../package.json', '/vendor/three/..%2fpackage.json', '/vendor/pdfjs/..%2fpackage.json', '/vendor/pdfjs/..%2flegacy%2fbuild%2fpdf.mjs',
      '/vendor/pdfjs-cmaps/..%2fpackage.json', '/vendor/pdfjs-fonts/..%2f..%2fthree%2fpackage.json', '/vendor/pdfjs-cmaps/', '/vendor/pdfjs-fonts/']) {
      const res = await request(srv.port, { path: p });
      assert.equal(res.status, 404, p);
    }
  });
});

describe('content route', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  it('serves region JSON from the regions folder the server reads', async () => {
    const res = await request(srv.port, { path: '/content/regions/fixture.json' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(res.json, FIXTURE);
  });

  it('404s for unknown regions', async () => {
    const res = await request(srv.port, { path: '/content/regions/nowhere.json' });
    assert.equal(res.status, 404);
  });
});
