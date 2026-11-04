// API routes without an API key: status, offline book, offline grading, avatar 503, body parsing.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startTestServer, request, postJSON, stubClient, textMessage, recordingLogger, tmpDir, eventually, assertTerseError, FIXTURE, PNG_DATA_URL } from './helpers.mjs';
import { createAI } from '../ai.js';
import { createPaperStore } from '../papers.js';

const hints = FIXTURE.book.offlineHints;
const explain = FIXTURE.challenges.find((c) => c.id === 'explain1');

describe('GET /api/status', () => {
  it('reports ai: false and the model without a key', async () => {
    const srv = await startTestServer();
    try {
      const res = await request(srv.port, { path: '/api/status' });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.deepEqual(res.json, { ai: false, model: 'claude-opus-5-5' });
    } finally {
      await srv.close();
    }
  });

  it('reports ai: true when a client is available', async () => {
    const srv = await startTestServer({ ai: createAI({ client: stubClient(() => textMessage({})), logger: recordingLogger() }) });
    try {
      const res = await request(srv.port, { path: '/api/status' });
      assert.deepEqual(res.json, { ai: true, model: 'claude-opus-5-5' });
    } finally {
      await srv.close();
    }
  });

  it('405s for the wrong method and 404s for unknown API paths', async () => {
    const srv = await startTestServer();
    try {
      const wrong = await postJSON(srv.port, '/api/status', {});
      assert.equal(wrong.status, 405);
      assert.match(wrong.headers.allow, /GET/);
      assertTerseError(wrong.json, 'bad_input');
      const getBook = await request(srv.port, { path: '/api/book' });
      assert.equal(getBook.status, 405);
      assert.equal(getBook.headers.allow, 'POST');
      const missing = await request(srv.port, { path: '/api/nope' });
      assert.equal(missing.status, 404);
      assertTerseError(missing.json, 'not_found');
    } finally {
      await srv.close();
    }
  });
});

describe('POST /api/book (offline)', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  const ask = (body) => postJSON(srv.port, '/api/book', { regionId: 'fixture', ...body });

  it('answers with the best-matching offline hint', async () => {
    const res = await ask({ question: 'Why do they divide by the sqrt of d_k?' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { answer: hints[1].text, refused: false, offline: true });
  });

  it('matches keywords case-insensitively and picks the strongest hint', async () => {
    const res = await ask({ question: 'What are the QUERY, the KEY and the VALUE?' });
    assert.equal(res.json.answer, hints[2].text);
    const heads = await ask({ question: 'Why use multi-head attention with many heads?' });
    assert.equal(heads.json.answer, hints[3].text);
  });

  it('lets the marked passage break a tie', async () => {
    const res = await ask({ question: 'What does this mean?', selection: 'apply a softmax function to obtain the weights' });
    assert.equal(res.json.answer, hints[0].text);
  });

  it('falls back to a generic cryptic line when nothing matches', async () => {
    const res = await ask({ question: 'Who won the football match?' });
    assert.equal(res.status, 200);
    assert.equal(res.json.refused, false);
    assert.equal(res.json.offline, true);
    assert.ok(res.json.answer.length > 10);
    assert.ok(!hints.some((h) => h.text === res.json.answer));
    const same = await ask({ question: 'Who won the football match?' });
    assert.equal(same.json.answer, res.json.answer, 'the same question gets the same line');
  });

  it('tolerates junk history and selection', async () => {
    const res = await ask({ question: 'softmax?', selection: 42, history: [null, 'x', { q: 1, a: 2 }, { q: 'hi', a: 'ho' }] });
    assert.equal(res.status, 200);
    assert.equal(res.json.answer, hints[0].text);
  });

  it('mutters in the lab (regionId null)', async () => {
    const res = await postJSON(srv.port, '/api/book', { regionId: null, question: 'Hello?' });
    assert.equal(res.status, 200);
    assert.equal(res.json.refused, false);
    assert.equal(res.json.offline, true);
    assert.match(res.json.answer, /\w/);
  });

  it('rejects bad requests with { error }', async () => {
    const cases = [
      [{ regionId: 'fixture' }, 400],
      [{ regionId: 'fixture', question: '   ' }, 400],
      [{ regionId: 'atlantis', question: 'hi' }, 404],
      [{ regionId: '../fixture', question: 'hi' }, 404],
      [{ regionId: 7, question: 'hi' }, 400],
    ];
    for (const [body, status] of cases) {
      const res = await postJSON(srv.port, '/api/book', body);
      assert.equal(res.status, status, JSON.stringify(body));
      assertTerseError(res.json, status === 404 ? 'not_found' : 'bad_input');
    }
  });
});

describe('POST /api/grade (offline keyword groups)', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  const grade = (answer, extra = {}) => postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer, ...extra });

  it('passes when every group has a keyword', async () => {
    const res = await grade('We divide the scores by the square root of d_k so the softmax does not saturate and the gradients stay useful.');
    assert.equal(res.status, 200);
    assert.equal(res.json.pass, true);
    assert.equal(res.json.score, 1);
    assert.equal(res.json.offline, true);
    assert.equal(typeof res.json.feedback, 'string');
    assert.ok(res.json.feedback.length > 0);
  });

  it('is case-insensitive and matches word stems', async () => {
    const res = await grade('SCALING keeps the SOFTMAX from SATURATING.');
    assert.equal(res.json.pass, true);
    const root = await grade('Taking √d_k keeps every gradient alive.');
    assert.equal(root.json.pass, true, 'the square-root sign counts as sqrt');
  });

  it('fails when a group is missing, with partial credit and just the retry line', async () => {
    const res = await grade('Because scaling makes the numbers smaller.');
    assert.equal(res.status, 200);
    assert.equal(res.json.pass, false);
    assert.equal(res.json.score, 0.5, 'the score carries the tally');
    assert.equal(res.json.offline, true);
    assert.equal(res.json.feedback, explain.retry[0], 'no status sentence after the line');
  });

  it('keeps the feedback to a short line', async () => {
    const pass = await grade('We scale the scores so the softmax keeps its gradients.');
    assert.equal(pass.json.pass, true);
    assert.ok(pass.json.feedback.length <= 40, pass.json.feedback);
    const noRetry = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'no idea' });
    assert.ok(noRetry.json.feedback.length <= 90, noRetry.json.feedback);
  });

  it('scores zero when nothing matches', async () => {
    const res = await grade('I have no idea, honestly.');
    assert.equal(res.json.pass, false);
    assert.equal(res.json.score, 0);
  });

  it('ignores any rubric or keywords sent by the client', async () => {
    const res = await grade('banana', { offline: [['banana']], rubric: ['say banana'] });
    assert.equal(res.json.pass, false);
  });

  it('rejects bad requests with { error }', async () => {
    const cases = [
      [{ regionId: 'fixture', challengeId: 'explain1' }, 400],
      [{ regionId: 'fixture', challengeId: 'explain1', answer: '  ' }, 400],
      [{ regionId: 'fixture', challengeId: 'explain1', answer: 'x'.repeat(6001) }, 400],
      [{ regionId: 'fixture', answer: 'hi' }, 400],
      [{ challengeId: 'explain1', answer: 'hi' }, 400],
      [{ regionId: 'atlantis', challengeId: 'explain1', answer: 'hi' }, 404],
      [{ regionId: 'fixture', challengeId: 'nope', answer: 'hi' }, 404],
      [{ regionId: 'fixture', challengeId: 'code1', answer: 'hi' }, 400],
    ];
    for (const [body, status] of cases) {
      const res = await postJSON(srv.port, '/api/grade', body);
      assert.equal(res.status, status, JSON.stringify(body).slice(0, 80));
      assertTerseError(res.json, status === 404 ? 'not_found' : 'bad_input');
    }
  });
});

describe('POST /api/avatar (offline)', () => {
  it('answers 503 { error, offline: true } without a key', async () => {
    const srv = await startTestServer();
    try {
      const res = await postJSON(srv.port, '/api/avatar', { image: PNG_DATA_URL });
      assert.equal(res.status, 503);
      assert.equal(res.json.offline, true);
      assertTerseError(res.json, 'offline');
      assert.deepEqual(Object.keys(res.json).sort(), ['code', 'error', 'offline']);
    } finally {
      await srv.close();
    }
  });
});

describe('JSON bodies and limits', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  it('413s a body over 64 KB on /api/book and /api/grade', async () => {
    const big = { regionId: 'fixture', question: 'x'.repeat(70 * 1024) };
    const res = await postJSON(srv.port, '/api/book', big);
    assert.equal(res.status, 413);
    assertTerseError(res.json, 'too_large');
    const grade = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'y'.repeat(70 * 1024) });
    assert.equal(grade.status, 413);
  });

  it('accepts a body just under 64 KB', async () => {
    const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: `softmax ${'x'.repeat(60 * 1024)}` });
    assert.equal(res.status, 200);
  });

  it('allows up to 8 MB on /api/avatar but not more', async () => {
    const ok = await postJSON(srv.port, '/api/avatar', { image: `data:image/png;base64,${'A'.repeat(1024 * 1024)}` });
    assert.equal(ok.status, 503, 'a 1 MB photo passes the size check (then meets the offline mirror)');
    const tooBig = await postJSON(srv.port, '/api/avatar', { image: `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}` });
    assert.equal(tooBig.status, 413);
    assertTerseError(tooBig.json, 'too_large');
  });

  it('enforces the limit on chunked bodies without Content-Length', async () => {
    const res = await request(srv.port, {
      method: 'POST',
      path: '/api/book',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regionId: 'fixture', question: 'z'.repeat(200 * 1024) }),
      chunked: true,
    });
    assert.equal(res.status, 413);
  });

  it('refuses an oversized upload before it is sent (Expect: 100-continue)', async () => {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: srv.port,
        method: 'POST',
        path: '/api/book',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': 10 * 1024 * 1024, expect: '100-continue' },
      });
      let continued = false;
      req.on('continue', () => { continued = true; req.destroy(); });
      req.on('response', (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => resolve({ status: res.statusCode, text, continued }));
      });
      req.on('error', (err) => (continued ? resolve({ continued }) : reject(err)));
      req.flushHeaders();
    });
    assert.equal(result.continued, false, 'the server must not ask for the body');
    assert.equal(result.status, 413);
    assertTerseError(JSON.parse(result.text), 'too_large');
  });

  it('400s on invalid JSON and on non-object JSON', async () => {
    for (const body of ['{"question": ', '[1,2,3]', '"just a string"', 'null']) {
      const res = await request(srv.port, { method: 'POST', path: '/api/book', headers: { 'content-type': 'application/json' }, body });
      assert.equal(res.status, 400, body);
      assertTerseError(res.json, 'bad_input');
    }
  });

  it('415s when the body is not sent as JSON', async () => {
    const res = await request(srv.port, { method: 'POST', path: '/api/book', headers: { 'content-type': 'text/plain' }, body: '{"regionId":"fixture","question":"hi"}' });
    assert.equal(res.status, 415);
    assertTerseError(res.json, 'bad_input');
  });

  it('refuses cross-site posts but accepts same-origin ones', async () => {
    const body = { regionId: 'fixture', question: 'softmax?' };
    const evil = await postJSON(srv.port, '/api/book', body, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assertTerseError(evil.json, 'forbidden');
    const opaque = await postJSON(srv.port, '/api/book', body, { origin: 'null' });
    assert.equal(opaque.status, 403);
    const same = await postJSON(srv.port, '/api/book', body, { origin: `http://127.0.0.1:${srv.port}` });
    assert.equal(same.status, 200);
  });

  it('stays quiet when clients hang up mid-upload (no error log, access log says 499)', async () => {
    const logger = recordingLogger();
    const quiet = await startTestServer({ logger });
    try {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => {
          const req = http.request({
            host: '127.0.0.1',
            port: quiet.port,
            method: 'POST',
            path: '/api/avatar',
            agent: false,
            headers: { 'content-type': 'application/json', 'content-length': 4 * 1024 * 1024 },
          });
          req.on('error', () => {});
          req.write(`{"image":"data:image/png;base64,${'A'.repeat(256 * 1024)}`);
          setTimeout(() => { req.destroy(); resolve(); }, 60);
        });
      }
      const logged = await eventually(() => (logger.text().match(/POST \/api\/avatar 499/g) || []).length === 5);
      assert.ok(logged, logger.text());
      assert.deepEqual(logger.lines.filter((l) => l.level === 'error' || l.level === 'warn'), []);
      assert.doesNotMatch(logger.text(), /aborted|ECONNRESET/);
      const ok = await request(quiet.port, { path: '/api/status' });
      assert.equal(ok.status, 200);
    } finally {
      await quiet.close();
    }
  });

  it('keeps serving after rejecting bodies', async () => {
    const res = await request(srv.port, { path: '/api/status' });
    assert.equal(res.status, 200);
  });
});

describe('GET /api/paper/:id/* validation', () => {
  it('400s on malformed arXiv ids without touching the network', async () => {
    let fetches = 0;
    const papers = createPaperStore({ cacheDir: tmpDir(), fetch: async () => { fetches += 1; throw new Error('no network in this test'); }, logger: recordingLogger() });
    const srv = await startTestServer({ papers });
    try {
      for (const id of ['notanid', '1706.037', '1706.037621', '1706.03762v', '..%2F1706.03762', '1706.03762.pdf', '%E0%A4%A']) {
        for (const what of ['pdf', 'text', 'meta']) {
          const res = await request(srv.port, { path: `/api/paper/${id}/${what}` });
          assert.equal(res.status, 400, `${id}/${what}`);
          assertTerseError(res.json, 'bad_input');
        }
      }
      const unknown = await request(srv.port, { path: '/api/paper/1706.03762/summary' });
      assert.equal(unknown.status, 404);
      assert.equal(fetches, 0);
    } finally {
      await srv.close();
    }
  });

  it('turns upstream failures into friendly JSON errors', async () => {
    const papers = createPaperStore({
      cacheDir: tmpDir(),
      fetch: async (url) => (String(url).includes('2501.99999') ? new Response('Paper not found', { status: 404 }) : Promise.reject(new TypeError('fetch failed'))),
      logger: recordingLogger(),
    });
    const srv = await startTestServer({ papers });
    try {
      const missing = await request(srv.port, { path: '/api/paper/2501.99999/text' });
      assert.equal(missing.status, 404);
      assert.match(missing.json.error, /no paper/i);
      assertTerseError(missing.json, 'not_found');
      const down = await request(srv.port, { path: '/api/paper/1706.03762/pdf' });
      assert.equal(down.status, 502);
      assertTerseError(down.json, 'offline');
    } finally {
      await srv.close();
    }
  });
});
