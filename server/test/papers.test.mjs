// Paper store with a fake fetch: caching, de-duplication, TTL, validation and alphaXiv parsing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createPaperStore, parseAlphaxivMeta, isValidArxivId, PaperError, upstreamUrls, META_TTL_MS } from '../papers.js';
import { tmpDir, recordingLogger } from './helpers.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.5\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const ABS_HTML = `<!DOCTYPE html><html><head><title>Attention Is All You Need | alphaXiv</title></head><body><script>
  self.$R=[];($R=>{comments:[{body:"nice",universalId:"1706.03762v7",paperTitle:"Attention Is All You Need",upvotes:31}],
  paper:{universalId:"1706.03762",maxVersionOrder:7,topics:$R[348]=["transformers"],metrics:$R[349]={commentsCount:892,
  totalVotes:368,publicTotalVotes:1182,visitsCount:$R[350]={last24Hours:45,last7Days:668,last30Days:3660,last90Days:14185,all:181172}},
  blocked:!1},related:[{universalId:"1409.0473",metrics:$R[351]={publicTotalVotes:151,visitsCount:$R[352]={all:5840}}}]})($R)
</script></body></html>`;

// fetch stand-in: routes by URL, records calls, optional delay.
function fakeFetch(routes, { delayMs = 0 } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const route = routes[String(url)];
    if (!route) return new Response('not found', { status: 404 });
    if (route instanceof Error) throw route;
    const [status, body, type = 'text/plain'] = typeof route === 'function' ? route() : route;
    return new Response(body, { status, headers: { 'content-type': type } });
  };
  fn.calls = calls;
  return fn;
}

const store = (fetch, opts = {}) => createPaperStore({ cacheDir: path.join(tmpDir(), 'nested', 'papers'), fetch, logger: recordingLogger(), ...opts });

describe('arXiv id validation', () => {
  it('accepts new-style ids with an optional version', () => {
    for (const id of ['1706.03762', '1706.03762v7', '2401.12345', '0704.0001', '2312.00752v2']) assert.ok(isValidArxivId(id), id);
  });
  it('rejects everything else', () => {
    for (const id of ['', 'abc', '170603762', '1706.037', '1706.037621', '1706.03762v', '1706.03762vx', '../1706.03762', '1706.03762/../x', '1706.03762.pdf', ' 1706.03762', 'hep-th/9901001', null, 1706.03762]) {
      assert.equal(isValidArxivId(id), false, String(id));
    }
  });
  it('never fetches for an invalid id', async () => {
    const fetch = fakeFetch({});
    const s = store(fetch);
    for (const fn of [s.getPdf, s.getText, s.getMeta]) {
      await assert.rejects(fn('../../etc/passwd'), (e) => e instanceof PaperError && e.status === 400);
    }
    assert.equal(fetch.calls.length, 0);
  });
});

describe('PDFs', () => {
  it('downloads from arxiv.org/pdf/<id> with default fetch settings and caches on disk', async () => {
    const fetch = fakeFetch({ [upstreamUrls.pdf('1706.03762')]: [200, PDF_BYTES, 'application/pdf'] });
    const s = store(fetch);
    const { file } = await s.getPdf('1706.03762');
    assert.equal(file, path.join(s.cacheDir, '1706.03762.pdf'));
    assert.deepEqual(fs.readFileSync(file), PDF_BYTES);
    assert.equal(fetch.calls[0].url, 'https://arxiv.org/pdf/1706.03762');
    assert.equal(fetch.calls[0].init.redirect, 'follow');
    assert.equal(fetch.calls[0].init.headers, undefined, "no custom headers: Node's own user agent");
    await s.getPdf('1706.03762');
    assert.equal(fetch.calls.length, 1, 'second call is served from disk');
    assert.deepEqual(fs.readdirSync(s.cacheDir), ['1706.03762.pdf'], 'no temp files left behind');
  });

  it('rejects responses that are not PDFs', async () => {
    const s = store(fakeFetch({ [upstreamUrls.pdf('1706.03762')]: [200, '<!DOCTYPE html><p>captcha</p>', 'text/html'] }));
    await assert.rejects(s.getPdf('1706.03762'), (e) => e.status === 502 && /not a PDF/.test(e.message));
    assert.equal(fs.existsSync(path.join(s.cacheDir, '1706.03762.pdf')), false);
  });

  it('maps upstream 404, network failures and timeouts', async () => {
    await assert.rejects(store(fakeFetch({})).getPdf('2501.99999'), (e) => e.status === 404);
    await assert.rejects(store(fakeFetch({ [upstreamUrls.pdf('1706.03762')]: new TypeError('fetch failed') })).getPdf('1706.03762'), (e) => e.status === 502);
    await assert.rejects(store(fakeFetch({ [upstreamUrls.pdf('1706.03762')]: [503, 'busy'] })).getPdf('1706.03762'), (e) => e.status === 502 && /503/.test(e.message));
    // AbortSignal.timeout() does not keep the process alive on its own (a listening server does).
    const hang = async (url, init) => new Promise((_, reject) => {
      const keepAlive = setInterval(() => {}, 1000);
      init.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        reject(init.signal.reason);
      });
    });
    await assert.rejects(store(hang, { timeoutMs: 50 }).getPdf('1706.03762'), (e) => e.status === 504);
  });

  it('still serves the PDF from memory when the cache cannot be written', async () => {
    const blocker = path.join(tmpDir(), 'not-a-dir');
    fs.writeFileSync(blocker, 'a file where the cache folder should be');
    const s = createPaperStore({ cacheDir: blocker, fetch: fakeFetch({ [upstreamUrls.pdf('1706.03762')]: [200, PDF_BYTES] }), logger: recordingLogger() });
    const res = await s.getPdf('1706.03762');
    assert.deepEqual(res.data, PDF_BYTES);
  });
});

describe('paper text', () => {
  const textUrl = upstreamUrls.text('1706.03762');

  it('fetches alphaxiv.org/abs/<id>.md once for many concurrent callers', async () => {
    const fetch = fakeFetch({ [textUrl]: [200, '# Attention Is All You Need\n\nAll you need.', 'text/markdown; charset=utf-8'] }, { delayMs: 50 });
    const s = store(fetch);
    const results = await Promise.all(Array.from({ length: 6 }, () => s.getText('1706.03762')));
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url, 'https://www.alphaxiv.org/abs/1706.03762.md');
    assert.ok(results.every((t) => t === results[0] && t.startsWith('# Attention')));
    assert.equal(await s.getText('1706.03762'), results[0]);
    assert.equal(fetch.calls.length, 1);
  });

  it('creates the cache folder and reuses it across restarts', async () => {
    const cacheDir = path.join(tmpDir(), 'deep', 'er', 'papers');
    const first = createPaperStore({ cacheDir, fetch: fakeFetch({ [textUrl]: [200, 'cached text'] }), logger: recordingLogger() });
    await first.getText('1706.03762');
    assert.equal(fs.readFileSync(path.join(cacheDir, '1706.03762.md'), 'utf8'), 'cached text');
    const offline = createPaperStore({ cacheDir, fetch: async () => { throw new Error('offline'); }, logger: recordingLogger() });
    assert.equal(await offline.getText('1706.03762'), 'cached text');
  });

  it('retries after a failure instead of caching it', async () => {
    let n = 0;
    const s = store(fakeFetch({ [textUrl]: () => (++n === 1 ? [500, 'oops'] : [200, 'second time lucky']) }));
    await assert.rejects(s.getText('1706.03762'), (e) => e.status === 502);
    assert.equal(await s.getText('1706.03762'), 'second time lucky');
  });

  it('rejects HTML and empty pages', async () => {
    await assert.rejects(store(fakeFetch({ [textUrl]: [200, '<!doctype html><html></html>', 'text/html'] })).getText('1706.03762'), (e) => e.status === 502);
    await assert.rejects(store(fakeFetch({ [textUrl]: [200, '   \n'] })).getText('1706.03762'), (e) => e.status === 502);
    await assert.rejects(store(fakeFetch({ [textUrl]: [404, 'Paper not found: 1706.03762'] })).getText('1706.03762'), (e) => e.status === 404);
  });
});

describe('alphaXiv metadata', () => {
  const absUrl = upstreamUrls.abs('1706.03762');

  it('parses title, votes and visits for the paper (not its comments or related papers)', () => {
    assert.deepEqual(parseAlphaxivMeta(ABS_HTML, '1706.03762'), { title: 'Attention Is All You Need', votes: 1182, visits: 181172 });
    assert.deepEqual(parseAlphaxivMeta(ABS_HTML, '1706.03762v7'), { title: 'Attention Is All You Need', votes: 1182, visits: 181172 });
    assert.deepEqual(parseAlphaxivMeta(ABS_HTML, '1409.0473'), { title: 'Attention Is All You Need', votes: 151, visits: 5840 });
  });

  it('copes with quoted and escaped JSON payloads', () => {
    const quoted = '<title>X | alphaXiv</title>{"universalId":"2401.00001","metrics":{"publicTotalVotes":12,"visitsCount":{"last7Days":1,"all":345}}}';
    assert.deepEqual(parseAlphaxivMeta(quoted, '2401.00001'), { title: 'X', votes: 12, visits: 345 });
    const escaped = String.raw`<title>Y</title>self.__next_f.push([1,"{\"universalId\":\"2401.00002\",\"metrics\":{\"publicTotalVotes\":7,\"visitsCount\":{\"all\":null}}}"])`;
    assert.deepEqual(parseAlphaxivMeta(escaped, '2401.00002'), { title: 'Y', votes: 7, visits: null });
  });

  it('returns nulls when the numbers are missing and decodes the title', () => {
    const html = '<title>Q&amp;A: &quot;Attention&quot; &#8212; really? | alphaXiv</title><p>universalId:"2401.00003",metrics:{}</p>';
    assert.deepEqual(parseAlphaxivMeta(html, '2401.00003'), { title: 'Q&A: "Attention" — really?', votes: null, visits: null });
    assert.deepEqual(parseAlphaxivMeta('<title>alphaXiv</title>', '2401.00004'), { title: null, votes: null, visits: null });
    assert.deepEqual(parseAlphaxivMeta('', '2401.00004'), { title: null, votes: null, visits: null });
  });

  it('caches metadata for 24 hours, then refreshes', async () => {
    let clock = 1_000_000;
    let votes = 1182;
    const fetch = fakeFetch({ [absUrl]: () => [200, ABS_HTML.replace('publicTotalVotes:1182', `publicTotalVotes:${votes}`), 'text/html'] });
    const s = store(fetch, { now: () => clock });
    assert.equal((await s.getMeta('1706.03762')).votes, 1182);
    votes = 1500;
    clock += META_TTL_MS - 60_000;
    assert.equal((await s.getMeta('1706.03762')).votes, 1182, 'still fresh after 23h59m');
    assert.equal(fetch.calls.length, 1);
    clock += 120_000;
    assert.equal((await s.getMeta('1706.03762')).votes, 1500, 'refreshed after 24h');
    assert.equal(fetch.calls.length, 2);
    assert.equal(fetch.calls[0].url, 'https://www.alphaxiv.org/abs/1706.03762');
    assert.equal(fetch.calls[0].init.headers, undefined);
  });

  it('serves stale metadata when a refresh fails, and de-duplicates concurrent refreshes', async () => {
    let clock = 0;
    let online = true;
    const fetch = fakeFetch({ [absUrl]: () => (online ? [200, ABS_HTML, 'text/html'] : [500, 'down']) }, { delayMs: 20 });
    const s = store(fetch, { now: () => clock });
    const all = await Promise.all([s.getMeta('1706.03762'), s.getMeta('1706.03762'), s.getMeta('1706.03762')]);
    assert.equal(fetch.calls.length, 1);
    assert.ok(all.every((m) => m.votes === 1182));
    online = false;
    clock += META_TTL_MS * 2;
    assert.deepEqual(await s.getMeta('1706.03762'), { title: 'Attention Is All You Need', votes: 1182, visits: 181172 });
  });
});
