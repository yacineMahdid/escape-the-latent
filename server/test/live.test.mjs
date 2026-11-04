// Live network (opt-in): ETL_LIVE=1 runs real arXiv / alphaXiv fetches through the paper routes (fresh
// cache folder each run), skipped with a warning when the network is unreachable. ETL_LIVE_AI=1 with an
// API key also makes real Claude calls against the fixture region.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { startTestServer, request, postJSON, tmpDir, recordingLogger, FIXTURE } from './helpers.mjs';
import { createPaperStore } from '../papers.js';
import { createAI } from '../ai.js';

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    return true;
  } catch (err) {
    return `${url}: ${err.cause?.code || err.cause?.message || err.message}`;
  }
}

const livePapers = Boolean(process.env.ETL_LIVE && process.env.ETL_LIVE !== '0');
let skipPapers = 'set ETL_LIVE=1 to fetch real papers';
if (livePapers) {
  const probes = await Promise.all([reachable('https://arxiv.org/'), reachable('https://www.alphaxiv.org/')]);
  const offlineReason = probes.find((p) => p !== true);
  skipPapers = offlineReason ? `network unavailable: ${offlineReason}` : false;
  if (offlineReason) console.warn(`\n  WARNING: skipping live paper tests, network unavailable (${offlineReason}).\n`);
}

describe('live paper routes (arXiv + alphaXiv)', { skip: skipPapers, timeout: 180_000 }, () => {
  let srv;
  let cacheDir;
  let upstream = [];

  before(async () => {
    cacheDir = tmpDir('etl-live-cache-');
    const countingFetch = (url, init) => {
      upstream.push(String(url));
      return fetch(url, init);
    };
    srv = await startTestServer({ papers: createPaperStore({ cacheDir, fetch: countingFetch, logger: recordingLogger() }) });
  });
  after(() => srv?.close());

  it('GET /api/paper/1706.03762/text returns the paper as markdown', async () => {
    const res = await request(srv.port, { path: '/api/paper/1706.03762/text' });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.equal(typeof res.json.text, 'string');
    assert.ok(res.json.text.length > 20_000, `text is only ${res.json.text.length} chars`);
    assert.match(res.json.text, /Attention Is All You Need/);
    assert.match(res.json.text, /Scaled Dot-Product Attention/);
    assert.ok(fs.existsSync(`${cacheDir}/1706.03762.md`));
  });

  it('GET /api/paper/1706.03762/meta returns the title and more than 1000 votes', async () => {
    const res = await request(srv.port, { path: '/api/paper/1706.03762/meta' });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.equal(res.json.title, 'Attention Is All You Need');
    assert.equal(typeof res.json.votes, 'number');
    assert.ok(res.json.votes > 1000, `votes = ${res.json.votes}`);
    assert.ok(res.json.visits === null || res.json.visits > 1000, `visits = ${res.json.visits}`);
    assert.deepEqual(Object.keys(res.json).sort(), ['title', 'visits', 'votes']);
  });

  it('GET /api/paper/1706.03762/pdf returns the PDF, then serves it from the cache', async () => {
    const before = upstream.length;
    const [a, b] = await Promise.all([
      request(srv.port, { path: '/api/paper/1706.03762/pdf' }),
      request(srv.port, { path: '/api/paper/1706.03762/pdf' }),
    ]);
    for (const res of [a, b]) {
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.equal(res.body.subarray(0, 5).toString('latin1'), '%PDF-');
      assert.equal(Number(res.headers['content-length']), res.body.length);
    }
    assert.ok(a.body.length > 100_000);
    assert.equal(upstream.length - before, 1, 'two simultaneous requests share one download');

    const range = await request(srv.port, { path: '/api/paper/1706.03762/pdf', headers: { range: 'bytes=0-1023' } });
    assert.equal(range.status, 206);
    assert.equal(range.body.length, 1024);
    const head = await request(srv.port, { method: 'HEAD', path: '/api/paper/1706.03762/pdf' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), a.body.length);
    assert.equal(upstream.length - before, 1, 'later requests come from .cache');
  });

  it('answers 404 for a paper that does not exist', async () => {
    const res = await request(srv.port, { path: '/api/paper/2501.99999/text' });
    assert.equal(res.status, 404);
    assert.equal(typeof res.json.error, 'string');
  });
});

const liveAI = process.env.ETL_LIVE_AI && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
describe('live Claude calls (ETL_LIVE_AI=1 with a key)', { skip: liveAI ? false : 'set ETL_LIVE_AI=1 and ANTHROPIC_API_KEY to run', timeout: 300_000 }, () => {
  let srv;
  before(async () => {
    const logger = recordingLogger();
    srv = await startTestServer({ ai: createAI({ logger }), papers: createPaperStore({ cacheDir: tmpDir(), logger }), logger });
  });
  after(() => srv?.close());

  it('the book answers tersely and refuses guarded questions', async () => {
    const ok = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'What does multi-head attention do?' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.offline, false);
    assert.ok(ok.json.answer.length > 0 && ok.json.answer.length <= 181, ok.json.answer);
    const guarded = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Exactly what do they divide the scores by, and why?' });
    assert.equal(guarded.status, 200, guarded.text);
    assert.equal(guarded.json.refused, true);
  });

  it('grades a good and a weak explanation', async () => {
    const good = await postJSON(srv.port, '/api/grade', {
      regionId: 'fixture',
      challengeId: 'explain1',
      answer: 'Dot products of queries and keys grow with the key dimension d_k, so the scores get huge; a softmax of huge scores is almost one-hot with tiny gradients. Dividing by the square root of d_k keeps the scores in a range where the softmax still has useful gradients.',
    });
    assert.equal(good.status, 200, good.text);
    assert.equal(good.json.pass, true);
    const weak = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'It makes it nicer.' });
    assert.equal(weak.json.pass, false);
    assert.ok(weak.json.feedback.length > 0);
    assert.notEqual(FIXTURE.challenges.length, 0);
  });
});
