// Who may talk to the server: Host allowlist (DNS rebinding), same-origin API, X-Forwarded-Host.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, request, postJSON, stubClient, textMessage, recordingLogger, tmpDir, assertTerseError } from './helpers.mjs';
import { createAI } from '../ai.js';
import { createPaperStore } from '../papers.js';
import { parseHost } from '../index.js';

const BOOK = { regionId: 'fixture', question: 'What does multi-head attention do?' };

// A server whose Claude client and paper downloads count their calls.
async function countingServer(options = {}) {
  const logger = recordingLogger();
  const client = stubClient(() => textMessage({ answer: 'Many small gazes.', refused: false }));
  const fetches = [];
  const papers = createPaperStore({
    cacheDir: tmpDir(),
    fetch: async (url) => {
      fetches.push(String(url));
      return new Response('%PDF-1.5\n%%EOF\n', { status: 200, headers: { 'content-type': 'application/pdf' } });
    },
    logger,
  });
  const srv = await startTestServer({ ai: createAI({ client, logger }), papers, logger, ...options });
  return { srv, client, fetches, logger };
}

describe('Host allowlist (DNS rebinding)', () => {
  let ctx;
  before(async () => { ctx = await countingServer(); });
  after(() => ctx.srv.close());

  it('refuses a forged Host even when the Origin matches it, before Claude is called', async () => {
    const host = `evil.example:${ctx.srv.port}`;
    const res = await postJSON(ctx.srv.port, '/api/book', BOOK, { host, origin: `http://${host}` });
    assert.equal(res.status, 403);
    assertTerseError(res.json, 'forbidden');
    assert.equal(ctx.client.calls.length, 0);
    const page = await request(ctx.srv.port, { path: '/', headers: { host } });
    assert.equal(page.status, 403, 'static files too');
    assert.doesNotMatch(page.text, /<html|<script/i);
    const pdf = await request(ctx.srv.port, { path: '/api/paper/2106.09685/pdf', headers: { host } });
    assert.equal(pdf.status, 403);
    assert.equal(ctx.fetches.length, 0);
    assert.match(ctx.logger.text(), /refused Host "evil\.example:\d+"/);
  });

  it('refuses malformed Hosts and absolute-form requests for other hosts', async () => {
    for (const host of ['localhost@evil.example', 'evil.example/x', 'local host', '[::1', '[zz::1]:80']) {
      const res = await request(ctx.srv.port, { path: '/api/status', headers: { host } });
      assert.equal(res.status, 403, host);
    }
    const absolute = await request(ctx.srv.port, { path: 'http://evil.example/api/status' });
    assert.equal(absolute.status, 403);
  });

  it('answers this machine\'s names: localhost, *.localhost and IP literals', async () => {
    const port = ctx.srv.port;
    for (const host of [`localhost:${port}`, `LOCALHOST:${port}`, `localhost.:${port}`, `game.localhost:${port}`,
      `127.0.0.1:${port}`, `[::1]:${port}`, `192.168.1.20:${port}`, '10.0.0.7']) {
      const res = await request(port, { path: '/api/status', headers: { host } });
      assert.equal(res.status, 200, host);
    }
    const same = await postJSON(port, '/api/book', BOOK, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
    assert.equal(same.status, 200);
  });

  it('answers HOST and ALLOWED_HOSTS names (exact, .domain, *)', async () => {
    const named = await startTestServer({ host: 'mybox.lan', allowedHosts: 'game.example, .party.example' });
    try {
      for (const [host, status] of [['mybox.lan', 200], ['game.example:8080', 200], ['party.example', 200], ['a.b.party.example', 200],
        ['evilparty.example', 403], ['game.example.evil.example', 403], ['other.lan', 403]]) {
        const res = await request(named.port, { path: '/api/status', headers: { host } });
        assert.equal(res.status, status, host);
      }
    } finally {
      await named.close();
    }
    const any = await startTestServer({ allowedHosts: ['*'] });
    try {
      assert.equal((await request(any.port, { path: '/api/status', headers: { host: 'anything.example' } })).status, 200);
    } finally {
      await any.close();
    }
  });

  it('parses Host headers like a browser sends them', () => {
    assert.deepEqual(parseHost('Example.COM:3000'), { hostname: 'example.com', port: '3000' });
    assert.deepEqual(parseHost('[::1]:3000'), { hostname: '[::1]', port: '3000' });
    assert.deepEqual(parseHost('localhost.'), { hostname: 'localhost', port: null });
    for (const bad of [undefined, '', 'a b', 'x@y', 'x/y', '[::g]', 'host:99999999']) assert.equal(parseHost(bad), null, String(bad));
  });
});

describe('X-Forwarded-Host', () => {
  it('is ignored without TRUST_PROXY', async () => {
    const ctx = await countingServer();
    try {
      const res = await postJSON(ctx.srv.port, '/api/book', BOOK, { origin: 'http://evil.example', 'x-forwarded-host': 'evil.example' });
      assert.equal(res.status, 403);
      assert.equal(ctx.client.calls.length, 0);
      const page = await request(ctx.srv.port, { path: '/api/status', headers: { 'x-forwarded-host': 'evil.example' } });
      assert.equal(page.status, 200, 'not trusted, so not checked either');
    } finally {
      await ctx.srv.close();
    }
  });

  it('is the public host behind a trusted proxy, and must be allowed', async () => {
    const ctx = await countingServer({ trustProxy: true, allowedHosts: 'game.example' });
    try {
      const proxied = { 'x-forwarded-host': 'game.example', 'x-forwarded-proto': 'https' };
      const ok = await postJSON(ctx.srv.port, '/api/book', BOOK, { ...proxied, origin: 'https://game.example' });
      assert.equal(ok.status, 200);
      const wrongOrigin = await postJSON(ctx.srv.port, '/api/book', BOOK, { ...proxied, origin: 'https://evil.example' });
      assert.equal(wrongOrigin.status, 403);
      const rebound = await postJSON(ctx.srv.port, '/api/book', BOOK, { 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' });
      assert.equal(rebound.status, 403);
      const chained = await request(ctx.srv.port, { path: '/api/status', headers: { 'x-forwarded-host': 'game.example, evil.example' } });
      assert.equal(chained.status, 403, 'every forwarded host must be allowed');
      assert.equal(ctx.client.calls.length, 1);
    } finally {
      await ctx.srv.close();
    }
  });
});

describe('the API answers this site only (GETs included)', () => {
  let ctx;
  before(async () => { ctx = await countingServer(); });
  after(() => ctx.srv.close());

  it('refuses a cross-site GET of a paper without downloading anything', async () => {
    for (const site of ['cross-site', 'same-site']) {
      for (const what of ['pdf', 'text', 'meta']) {
        const res = await request(ctx.srv.port, { path: `/api/paper/2106.09685/${what}`, headers: { 'sec-fetch-site': site, 'sec-fetch-mode': 'no-cors' } });
        assert.equal(res.status, 403, `${site} ${what}`);
        assertTerseError(res.json, 'forbidden');
      }
    }
    const status = await request(ctx.srv.port, { path: '/api/status', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(status.status, 403);
    assert.equal(ctx.fetches.length, 0);
  });

  it('refuses GETs and POSTs whose Origin is another site, another port or opaque', async () => {
    const port = ctx.srv.port;
    for (const origin of ['https://evil.example', `http://127.0.0.1:${port + 1}`, 'http://127.0.0.1', 'null', 'file://', 'garbage']) {
      const get = await request(port, { path: '/api/paper/1706.03762/meta', headers: { origin } });
      assert.equal(get.status, 403, `GET ${origin}`);
      const post = await postJSON(port, '/api/book', BOOK, { origin });
      assert.equal(post.status, 403, `POST ${origin}`);
    }
    assert.equal(ctx.client.calls.length, 0);
    assert.equal(ctx.fetches.length, 0);
  });

  it('serves its own pages, typed URLs and plain tools', async () => {
    const port = ctx.srv.port;
    for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, {}, { origin: `http://127.0.0.1:${port}` }]) {
      const res = await request(port, { path: '/api/paper/2106.09685/pdf', headers });
      assert.equal(res.status, 200, JSON.stringify(headers));
    }
    assert.equal(ctx.fetches.length, 1, 'downloaded once, then cached');
    const post = await postJSON(port, '/api/book', BOOK, { 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` });
    assert.equal(post.status, 200);
  });

  it('leaves static files alone (a cross-site <img> or <script> of public files is fine)', async () => {
    const res = await request(ctx.srv.port, { path: '/css/game.css', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 200);
  });
});
