// Paper proxy: arXiv PDFs, alphaXiv markdown text and alphaXiv metadata, cached on disk.
//
//   PDF   https://arxiv.org/pdf/<id>            -> <cacheDir>/<id>.pdf        (kept forever)
//   text  https://www.alphaxiv.org/abs/<id>.md  -> <cacheDir>/<id>.md         (kept forever)
//   meta  https://www.alphaxiv.org/abs/<id>     -> <cacheDir>/<id>.meta.json  (refreshed after 24h)
//
// Concurrent requests for the same thing share one upstream fetch. A failed text fetch is not retried
// for TEXT_RETRY_MS (each book question would otherwise wait on a dead network), and a failed or
// unreadable metadata refresh (a "Just a moment..." challenge page, a new page layout) never replaces a
// good cached copy and is not retried for META_RETRY_MS. Requests use Node's default fetch user agent;
// we never pretend to be a browser. Error messages are a word or two; details go to the log.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;
export const META_TTL_MS = 24 * 60 * 60 * 1000;
export const TEXT_RETRY_MS = 60 * 1000;
export const META_RETRY_MS = 5 * 60 * 1000;

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const TEXT_MEMORY_SLOTS = 8;
const NO_META = Object.freeze({ title: null, votes: null, visits: null });

export const upstreamUrls = {
  pdf: (id) => `https://arxiv.org/pdf/${id}`,
  text: (id) => `https://www.alphaxiv.org/abs/${id}.md`,
  abs: (id) => `https://www.alphaxiv.org/abs/${id}`,
};

const SAY = Object.freeze({
  badId: '✕ bad arXiv id',
  slow: '✕ too slow',
  unreachable: '✕ unreachable',
  noPaper: '✕ no paper',
  upstream: '✕ library error',
  tooBig: '✕ too big',
  notPdf: '✕ not a PDF',
  notText: '✕ not text',
  empty: '✕ empty page',
  cutOff: '✕ cut off',
});

export function isValidArxivId(id) {
  return typeof id === 'string' && ARXIV_ID_RE.test(id);
}

export function defaultCacheDir(env = process.env) {
  return env.PAPERS_CACHE_DIR ? path.resolve(env.PAPERS_CACHE_DIR) : path.join(ROOT, '.cache', 'papers');
}

// status: the HTTP status the route answers with; message: a word or two for the player;
// code: offline | timeout | not_found | bad_input | error (see ERROR_CODES in index.js).
export class PaperError extends Error {
  constructor(status, message, { code, ...options } = {}) {
    super(message, options);
    this.name = 'PaperError';
    this.status = status;
    this.code = code ?? ({ 400: 'bad_input', 404: 'not_found', 504: 'timeout' }[status] || 'error');
  }
}

export function createPaperStore({
  cacheDir = defaultCacheDir(),
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  metaTtlMs = META_TTL_MS,
  textRetryMs = TEXT_RETRY_MS,
  metaRetryMs = META_RETRY_MS,
  timeoutMs = 45_000,
  logger = console,
} = {}) {
  const inflight = new Map(); // "kind:id" -> Promise
  const texts = new Map(); // small in-memory LRU of paper texts (the book and grader read them a lot)
  const failures = new Map(); // "kind:id" -> { until, error } (error null: the page was unreadable)

  function once(key, fn) {
    let p = inflight.get(key);
    if (!p) {
      p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  function recentFailure(key) {
    const f = failures.get(key);
    if (f && now() < f.until) return f;
    failures.delete(key);
    return null;
  }

  function rememberFailure(key, error, forMs) {
    failures.set(key, { until: now() + forMs, error });
    if (failures.size > 256) failures.delete(failures.keys().next().value);
  }

  function checkId(id) {
    if (!isValidArxivId(id)) throw new PaperError(400, SAY.badId);
  }

  const fileFor = (id, ext) => path.join(cacheDir, `${id}${ext}`);

  async function readCached(file, encoding) {
    try {
      return await fsp.readFile(file, encoding);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn?.(`[papers] cannot read cache ${file}: ${err.message}`);
      return null;
    }
  }

  async function writeCached(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, file); // atomic: readers never see half a file
      return true;
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      logger.warn?.(`[papers] cannot write cache ${file}: ${err.message}`);
      return false;
    }
  }

  async function download(url, { maxBytes }) {
    const fail = (status, message, detail, { code, cause } = {}) => {
      if (status !== 404) logger.warn?.(`[papers] ${url}: ${detail}`);
      return new PaperError(status, message, { code, cause });
    };
    const aborted = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';
    let res;
    try {
      res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (aborted(err)) throw fail(504, SAY.slow, `no answer within ${timeoutMs}ms`, { cause: err });
      throw fail(502, SAY.unreachable, `cannot connect (${err?.cause?.code || err?.message || err})`, { code: 'offline', cause: err });
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => {});
      throw fail(404, SAY.noPaper, `HTTP ${res.status}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw fail(502, SAY.upstream, `HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw fail(502, SAY.tooBig, `declared ${declared} bytes`);
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body ?? []) {
        size += chunk.byteLength;
        if (size > maxBytes) throw fail(502, SAY.tooBig, `more than ${maxBytes} bytes`);
        chunks.push(Buffer.from(chunk));
      }
    } catch (err) {
      if (err instanceof PaperError) throw err;
      if (aborted(err)) throw fail(504, SAY.slow, `body not done within ${timeoutMs}ms`, { cause: err });
      throw fail(502, SAY.cutOff, `body cut off (${err?.message || err})`, { cause: err });
    }
    return { body: Buffer.concat(chunks), contentType: res.headers.get('content-type') || '' };
  }

  // -> { file } when the PDF sits in the disk cache, or { data } if the cache is not writable.
  async function getPdf(id) {
    checkId(id);
    const file = fileFor(id, '.pdf');
    return once(`pdf:${id}`, async () => {
      try {
        const st = await fsp.stat(file);
        if (st.isFile() && st.size > 0) return { file };
      } catch { /* not cached yet */ }
      const { body } = await download(upstreamUrls.pdf(id), { maxBytes: MAX_PDF_BYTES });
      if (!body.subarray(0, 1024).includes('%PDF-')) {
        logger.warn?.(`[papers] ${upstreamUrls.pdf(id)}: not a PDF`);
        throw new PaperError(502, SAY.notPdf);
      }
      return (await writeCached(file, body)) ? { file } : { data: body };
    });
  }

  function remember(id, text) {
    texts.delete(id);
    texts.set(id, text);
    while (texts.size > TEXT_MEMORY_SLOTS) texts.delete(texts.keys().next().value);
    return text;
  }

  // -> the paper as markdown (string)
  async function getText(id) {
    checkId(id);
    if (texts.has(id)) return remember(id, texts.get(id));
    return once(`text:${id}`, async () => {
      const file = fileFor(id, '.md');
      const cached = await readCached(file, 'utf8');
      if (cached && cached.trim()) return remember(id, cached);
      const failed = recentFailure(`text:${id}`);
      if (failed) throw failed.error;
      try {
        const { body, contentType } = await download(upstreamUrls.text(id), { maxBytes: MAX_TEXT_BYTES });
        const text = body.toString('utf8').replace(/^﻿/, '');
        if (/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(text)) {
          logger.warn?.(`[papers] ${upstreamUrls.text(id)}: a web page, not the paper text`);
          throw new PaperError(502, SAY.notText);
        }
        if (!text.trim()) throw new PaperError(502, SAY.empty);
        await writeCached(file, text);
        return remember(id, text);
      } catch (err) {
        if (err instanceof PaperError) rememberFailure(`text:${id}`, err, textRetryMs);
        throw err;
      }
    });
  }

  // -> { title, votes, visits } (votes/visits may be null)
  async function getMeta(id) {
    checkId(id);
    return once(`meta:${id}`, async () => {
      const file = fileFor(id, '.meta.json');
      let cached = null;
      try {
        cached = JSON.parse((await readCached(file, 'utf8')) ?? 'null');
      } catch { cached = null; }
      if (!cached || typeof cached !== 'object' || Array.isArray(cached)) cached = null;
      const fresh = cached && typeof cached.fetchedAt === 'number' && now() - cached.fetchedAt < metaTtlMs;
      if (fresh) return publicMeta(cached);
      const failed = recentFailure(`meta:${id}`);
      if (failed) {
        if (cached) return publicMeta(cached);
        if (failed.error) throw failed.error;
        return { ...NO_META };
      }
      let html;
      try {
        html = (await download(upstreamUrls.abs(id), { maxBytes: MAX_HTML_BYTES })).body.toString('utf8');
      } catch (err) {
        rememberFailure(`meta:${id}`, err, metaRetryMs);
        if (cached) {
          logger.warn?.(`[papers] meta refresh for ${id} failed (${err.message}); serving the cached copy`);
          return publicMeta(cached);
        }
        throw err;
      }
      const meta = parseAlphaxivMeta(html, id);
      // Not this paper's page (a challenge page, an error page, a new layout), or numbers gone missing:
      // not a refresh. Keep what we had and try again later.
      if (!describesPaper(html, id) || (cached && hasNumbers(cached) && !hasNumbers(meta))) {
        rememberFailure(`meta:${id}`, null, metaRetryMs);
        logger.warn?.(`[papers] alphaXiv page for ${id} did not parse${cached ? '; serving the cached copy' : ''}`);
        return cached ? publicMeta(cached) : { ...NO_META };
      }
      await writeCached(file, JSON.stringify({ ...meta, fetchedAt: now() }));
      return meta;
    });
  }

  return { cacheDir, getPdf, getText, getMeta };
}

function publicMeta(m) {
  return {
    title: typeof m.title === 'string' && m.title ? m.title : null,
    votes: Number.isFinite(m.votes) ? m.votes : null,
    visits: Number.isFinite(m.visits) ? m.visits : null,
  };
}

const hasNumbers = (m) => Number.isFinite(m?.votes) || Number.isFinite(m?.visits);

// ---------------------------------------------------------------------------------------------
// alphaXiv abs page parsing. The page embeds its data as a serialized JS object, e.g.
//   universalId:"1706.03762",...,metrics:$R[349]={commentsCount:892,totalVotes:368,
//   publicTotalVotes:1182,visitsCount:$R[350]={last24Hours:45,...,all:181172}},...
// Keys may also appear quoted ("key":) or escaped (\"key\":) depending on how the page is built.

const Q = String.raw`\\?"?`; // optional, possibly escaped, quote around a key
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const paperIdRe = (baseId, flags) => new RegExp(`${Q}universalId${Q}\\s*:\\s*\\\\?"${escapeRe(baseId)}(v\\d+)?\\\\?"`, flags);
const baseIdOf = (id) => String(id).replace(/v\d+$/, '');

export function parseAlphaxivMeta(html, id) {
  const text = String(html ?? '');
  const { votes, visits } = parseMetrics(text, baseIdOf(id));
  return { title: parseTitle(text), votes, visits };
}

// True when the page carries this paper's own data (not a challenge page or a stranger's page).
export function describesPaper(html, id) {
  return paperIdRe(baseIdOf(id), '').test(String(html ?? ''));
}

function parseTitle(html) {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?? '';
  const title = decodeEntities(raw).replace(/\s+/g, ' ').replace(/\s*[|–—-]\s*alphaxiv\s*$/i, '').trim();
  return title && !/^alphaxiv$/i.test(title) ? title : null;
}

function parseMetrics(html, baseId) {
  const idRe = paperIdRe(baseId, 'g');
  const anyIdRe = new RegExp(`${Q}universalId${Q}\\s*:`, 'g');
  const hits = [...html.matchAll(idRe)];
  // The paper itself is listed under its bare id; versioned ids mostly belong to comments.
  hits.sort((a, b) => Number(Boolean(a[1])) - Number(Boolean(b[1])));
  for (const hit of hits) {
    const start = hit.index + hit[0].length;
    anyIdRe.lastIndex = start;
    const next = anyIdRe.exec(html);
    const windowText = html.slice(start, next ? next.index : start + 20_000);
    const metricsAt = windowText.search(new RegExp(`${Q}metrics${Q}\\s*:`));
    if (metricsAt < 0) continue;
    const metrics = windowText.slice(metricsAt, metricsAt + 4000);
    const votes = metrics.match(new RegExp(`${Q}publicTotalVotes${Q}\\s*:\\s*(\\d+|null)`));
    if (!votes) continue;
    let visits = null;
    const visitsAt = metrics.search(new RegExp(`${Q}visitsCount${Q}\\s*:`));
    if (visitsAt >= 0) {
      const obj = metrics.slice(visitsAt).match(/\{[^}]*\}/)?.[0] ?? '';
      const all = obj.match(new RegExp(`[{,\\s]${Q}all${Q}\\s*:\\s*(\\d+|null)`));
      if (all && all[1] !== 'null') visits = Number(all[1]);
    }
    return { votes: votes[1] === 'null' ? null : Number(votes[1]), visits };
  }
  return { votes: null, visits: null };
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}
