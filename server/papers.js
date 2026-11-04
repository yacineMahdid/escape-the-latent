// Paper proxy: arXiv PDFs, alphaXiv markdown text and alphaXiv metadata, cached on disk.
//
//   PDF   https://arxiv.org/pdf/<id>            -> <cacheDir>/<id>.pdf        (kept forever)
//   text  https://www.alphaxiv.org/abs/<id>.md  -> <cacheDir>/<id>.md         (kept forever)
//   meta  https://www.alphaxiv.org/abs/<id>     -> <cacheDir>/<id>.meta.json  (refreshed after 24h)
//
// Concurrent requests for the same thing share one upstream fetch. Requests use Node's default
// fetch user agent; we never pretend to be a browser.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;
export const META_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const TEXT_MEMORY_SLOTS = 8;

export const upstreamUrls = {
  pdf: (id) => `https://arxiv.org/pdf/${id}`,
  text: (id) => `https://www.alphaxiv.org/abs/${id}.md`,
  abs: (id) => `https://www.alphaxiv.org/abs/${id}`,
};

export function isValidArxivId(id) {
  return typeof id === 'string' && ARXIV_ID_RE.test(id);
}

export function defaultCacheDir(env = process.env) {
  return env.PAPERS_CACHE_DIR ? path.resolve(env.PAPERS_CACHE_DIR) : path.join(ROOT, '.cache', 'papers');
}

// status is the HTTP status the route should answer with; message is safe to show to the player.
export class PaperError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = 'PaperError';
    this.status = status;
  }
}

export function createPaperStore({
  cacheDir = defaultCacheDir(),
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  metaTtlMs = META_TTL_MS,
  timeoutMs = 45_000,
  logger = console,
} = {}) {
  const inflight = new Map(); // "kind:id" -> Promise
  const texts = new Map(); // small in-memory LRU of paper texts (the book and grader read them a lot)

  function once(key, fn) {
    let p = inflight.get(key);
    if (!p) {
      p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  function checkId(id) {
    if (!isValidArxivId(id)) {
      throw new PaperError(400, "That doesn't look like an arXiv id (something like 1706.03762).");
    }
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

  async function download(url, { source, maxBytes }) {
    let res;
    try {
      res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new PaperError(504, `${source} is taking too long to answer. Try again in a moment.`, { cause: err });
      }
      throw new PaperError(502, `${source} can't be reached right now. Is the network up?`, { cause: err });
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => {});
      throw new PaperError(404, `${source} has no paper with that id.`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new PaperError(502, `${source} answered with an error (HTTP ${res.status}). Try again later.`);
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new PaperError(502, `${source} sent something far too large to be a paper.`);
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body ?? []) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new PaperError(502, `${source} sent something far too large to be a paper.`);
        chunks.push(Buffer.from(chunk));
      }
    } catch (err) {
      if (err instanceof PaperError) throw err;
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new PaperError(504, `${source} is taking too long to answer. Try again in a moment.`, { cause: err });
      }
      throw new PaperError(502, `${source} stopped halfway through. Try again.`, { cause: err });
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
      const { body } = await download(upstreamUrls.pdf(id), { source: 'The arXiv library', maxBytes: MAX_PDF_BYTES });
      if (!body.subarray(0, 1024).includes('%PDF-')) {
        throw new PaperError(502, 'The arXiv library sent something that is not a PDF.');
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
      const { body, contentType } = await download(upstreamUrls.text(id), { source: 'The alphaXiv reading room', maxBytes: MAX_TEXT_BYTES });
      const text = body.toString('utf8').replace(/^﻿/, '');
      if (/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(text)) {
        throw new PaperError(502, 'The alphaXiv reading room sent a web page instead of the paper text.');
      }
      if (!text.trim()) throw new PaperError(502, 'The alphaXiv reading room sent an empty page.');
      await writeCached(file, text);
      return remember(id, text);
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
      const fresh = cached && typeof cached.fetchedAt === 'number' && now() - cached.fetchedAt < metaTtlMs;
      if (fresh) return publicMeta(cached);
      try {
        const { body } = await download(upstreamUrls.abs(id), { source: 'alphaXiv', maxBytes: MAX_HTML_BYTES });
        const meta = parseAlphaxivMeta(body.toString('utf8'), id);
        await writeCached(file, JSON.stringify({ ...meta, fetchedAt: now() }));
        return meta;
      } catch (err) {
        if (cached) {
          logger.warn?.(`[papers] meta refresh for ${id} failed (${err.message}); serving the cached copy`);
          return publicMeta(cached);
        }
        throw err;
      }
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

// ---------------------------------------------------------------------------------------------
// alphaXiv abs page parsing. The page embeds its data as a serialized JS object, e.g.
//   universalId:"1706.03762",...,metrics:$R[349]={commentsCount:892,totalVotes:368,
//   publicTotalVotes:1182,visitsCount:$R[350]={last24Hours:45,...,all:181172}},...
// Keys may also appear quoted ("key":) or escaped (\"key\":) depending on how the page is built.

const Q = String.raw`\\?"?`; // optional, possibly escaped, quote around a key
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseAlphaxivMeta(html, id) {
  const text = String(html ?? '');
  const { votes, visits } = parseMetrics(text, String(id).replace(/v\d+$/, ''));
  return { title: parseTitle(text), votes, visits };
}

function parseTitle(html) {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?? '';
  const title = decodeEntities(raw).replace(/\s+/g, ' ').replace(/\s*[|–—-]\s*alphaxiv\s*$/i, '').trim();
  return title && !/^alphaxiv$/i.test(title) ? title : null;
}

function parseMetrics(html, baseId) {
  const idRe = new RegExp(`${Q}universalId${Q}\\s*:\\s*\\\\?"${escapeRe(baseId)}(v\\d+)?\\\\?"`, 'g');
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
