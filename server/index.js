// Escape the Latent: plain node:http server (no framework).
//   static:  /  -> public/,  /vendor/three -> three/build,  /vendor/pdfjs -> pdfjs-dist/build,
//            /vendor/pdfjs-web -> pdfjs-dist/web,  /vendor/pdfjs-cmaps -> pdfjs-dist/cmaps,
//            /vendor/pdfjs-fonts -> pdfjs-dist/standard_fonts,  /content -> content/
//   api:     see "Server routes" in docs/ARCHITECTURE.md
// Env: PORT (default 3000), HOST (default localhost), ALLOWED_HOSTS, TRUST_PROXY, REGIONS_DIR,
//      PAPERS_CACHE_DIR, ANTHROPIC_API_KEY.
//
// Who may talk to the server:
// - Host: only this machine's names answer (localhost, *.localhost, any IP literal, HOST, and the
//   comma-separated ALLOWED_HOSTS list: "game.example", ".example.org" for a domain and its
//   subdomains, "*" for anything). Any other Host gets 403, which stops DNS rebinding.
// - /api/*: requests sent by pages on other sites (Sec-Fetch-Site cross-site/same-site, or an Origin
//   that is not this server) get 403, so no web page can spend the Claude budget or make the server
//   download papers.
// - X-Forwarded-Host is only read with TRUST_PROXY=1 (a reverse proxy that sets it in front of us).
//
// Errors are { error, code } (+ offline / retryable): error is a symbol and a word or two for the
// player, code is one of ERROR_CODES for the UI to pick an icon. Details go to the server log only.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import { createAI, AIError, MODEL, labBookAnswer } from './ai.js';
import { createPaperStore, PaperError } from './papers.js';
import { createRegionStore, findChallenge } from './regions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
});

export const BODY_LIMITS = Object.freeze({ '/api/avatar': 8 * 1024 * 1024 });
export const DEFAULT_BODY_LIMIT = 64 * 1024;
const DRAIN_ALLOWANCE = 16 * 1024 * 1024; // past the limit we keep reading (and discarding) this much, then hang up

// body.code for every error status (AIError / PaperError may set a more precise one, e.g. "offline").
export const ERROR_CODES = Object.freeze({
  400: 'bad_input',
  403: 'forbidden',
  404: 'not_found',
  405: 'bad_input',
  413: 'too_large',
  415: 'bad_input',
  422: 'refused',
  429: 'busy',
  500: 'error',
  502: 'error',
  503: 'busy',
  504: 'timeout',
});
const codeFor = (status) => ERROR_CODES[status] || 'error';

// What the player may see: a symbol and at most a few words.
const SAY = Object.freeze({
  tooBig: '✕ too big',
  smudged: '✕ smudged',
  notJson: '✕ not JSON',
  otherSite: '✕ other site',
  unknownHost: '✕ unknown host',
  noQuestion: '✕ no question',
  badRegion: '✕ bad region',
  noPlace: '✕ no such place',
  whichChallenge: '✕ which challenge?',
  empty: '✕ empty',
  tooLong: '✕ too long',
  nobodyAsked: '✕ nobody asked',
  wrongKind: '✕ wrong kind',
  wrongMethod: '✕ wrong method',
  noPath: '✕ no such path',
  badId: '✕ bad arXiv id',
  jammed: '✕ jammed',
});

class HttpError extends Error {
  constructor(status, message, headers = {}, code = codeFor(status)) {
    super(message);
    this.status = status;
    this.headers = headers;
    this.code = code;
  }
}

// Status 499: the client hung up before we answered; there is nobody to answer and nothing to log.
const GONE = 499;

const isInside = (dir, p) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const bodyLimitFor = (pathname) => BODY_LIMITS[pathname] ?? DEFAULT_BODY_LIMIT;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const firstValue = (v) => String(Array.isArray(v) ? v[0] : v ?? '').split(',')[0].trim();

function sendJSON(res, status, data, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendError(res, err) {
  sendJSON(res, err.status, {
    error: err.message,
    code: err.code || codeFor(err.status),
    ...(err.offline ? { offline: true } : {}),
    ...(err.retryable ? { retryable: true } : {}),
  }, err.headers || {});
}

function sendText(res, status, text, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

// ---------------------------------------------------------------------------------------------
// Host names (DNS rebinding) and same-origin checks

// "Example.com:3000" -> { hostname: 'example.com', port: '3000' }; "[::1]:3000" keeps the brackets.
// Returns null for anything a browser would never send as a Host.
export function parseHost(value) {
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?)(?::(\d{1,5}))?$/.exec(String(value ?? '').trim().toLowerCase());
  if (!m) return null;
  let hostname = m[1];
  if (hostname.startsWith('[')) {
    if (!net.isIPv6(hostname.slice(1, -1))) return null;
  } else {
    hostname = hostname.replace(/\.$/, '');
  }
  return { hostname, port: m[2] ?? null };
}

// Exact names, ".domain" (the domain and its subdomains) or "*", from HOST and ALLOWED_HOSTS.
function hostAllowList(host, allowedHosts) {
  const list = [];
  const add = (raw) => {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return;
    if (s === '*') {
      list.push('*');
      return;
    }
    const dot = s.startsWith('.');
    const bare = dot ? s.slice(1) : s;
    const parsed = parseHost(bare) ?? (net.isIPv6(bare) ? { hostname: `[${bare}]` } : null);
    if (parsed) list.push(dot ? `.${parsed.hostname}` : parsed.hostname);
  };
  if (host && !['0.0.0.0', '::', '[::]'].includes(String(host).trim())) add(host);
  for (const entry of Array.isArray(allowedHosts) ? allowedHosts : String(allowedHosts ?? '').split(/[\s,]+/)) add(entry);
  return list;
}

// IP literals are always fine: a page can only send Host: <ip> if it was itself loaded from that IP.
function isAllowedHostname(hostname, list) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname.startsWith('[') || net.isIPv4(hostname)) return true;
  return list.some((e) => e === '*' || e === hostname || (e.startsWith('.') && (hostname === e.slice(1) || hostname.endsWith(e))));
}

// ---------------------------------------------------------------------------------------------
// Content-Security-Policy for HTML pages. Model answers and alphaXiv markdown reach the DOM, so no
// script may run unless it is a file from this server or one of the page's own inline <script>s
// (hashed when the page is served, so pages can change freely). Styles, images and fonts stay relaxed.
// JS files get no CSP header: workers keep their own policy (the Python worker loads Pyodide from a CDN).

const CSP_DIRECTIVES = Object.freeze([
  ['default-src', "'self'"],
  ['script-src', "'self'", "'wasm-unsafe-eval'"],
  ['style-src', "'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  ['font-src', "'self'", 'data:', 'https://fonts.gstatic.com'],
  ['img-src', "'self'", 'data:', 'blob:'],
  ['media-src', "'self'", 'data:', 'blob:'],
  ['connect-src', "'self'", 'data:', 'blob:'],
  ['worker-src', "'self'", 'blob:'],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'self'"],
]);

// 'sha256-...' sources for every inline <script> (import maps included), as the browser hashes them.
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const m of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const text = m[2].replace(/\r\n?/g, '\n'); // the HTML parser normalises newlines before scripts see them
    hashes.add(`'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

export function contentSecurityPolicy(html) {
  const hashes = inlineScriptHashes(html);
  return CSP_DIRECTIVES.map(([name, ...sources]) => [name, ...sources, ...(name === 'script-src' ? hashes : [])].join(' ')).join('; ');
}

// ---------------------------------------------------------------------------------------------

// Single byte range ("bytes=a-b", "bytes=a-", "bytes=-n"). Returns null to ignore the header.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

async function sendFile(req, res, file, st, { type, cacheControl = 'no-cache', headers = {} }) {
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const base = {
    'Content-Type': type,
    'Cache-Control': cacheControl,
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  };
  const inm = req.headers['if-none-match'];
  const ims = Date.parse(req.headers['if-modified-since'] ?? '');
  if (inm ? inm === '*' || inm.split(/\s*,\s*/).includes(etag) : ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(ims / 1000)) {
    res.writeHead(304, base);
    res.end();
    return;
  }
  let status = 200;
  let start = 0;
  let end = st.size - 1;
  const ifRange = req.headers['if-range'];
  if (req.headers.range && (!ifRange || ifRange === etag)) {
    const r = parseRange(req.headers.range, st.size);
    if (r === 'unsatisfiable') {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${st.size}`, 'Content-Length': 0 });
      res.end();
      return;
    }
    if (r) {
      ({ start, end } = r);
      status = 206;
      base['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
  }
  res.writeHead(status, { ...base, 'Content-Length': st.size === 0 ? 0 : end - start + 1 });
  if (req.method === 'HEAD' || st.size === 0) {
    res.end();
    return;
  }
  try {
    await pipeline(fs.createReadStream(file, { start, end }), res);
  } catch {
    res.destroy();
  }
}

// Reads a JSON body. Past the limit we keep draining (so the client can read our 413), up to a cap.
// A client that hangs up mid-upload (the player closed the creator) ends quietly with status 499.
function readJSONBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit + DRAIN_ALLOWANCE) {
      req.resume();
      reject(new HttpError(413, SAY.tooBig, { Connection: 'close' }));
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    let settled = false;
    const fail = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    const gone = () => fail(new HttpError(GONE, 'gone'));
    if (req.destroyed && !req.complete) {
      gone();
      return;
    }
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit + DRAIN_ALLOWANCE) {
        fail(new HttpError(413, SAY.tooBig, { Connection: 'close' }));
        req.pause();
        return;
      }
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
      }
      if (!overflow) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) return fail(new HttpError(413, SAY.tooBig));
      if (settled) return undefined;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return reject(new HttpError(400, SAY.smudged));
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return reject(new HttpError(400, SAY.smudged));
      }
      return resolve(data);
    });
    req.on('error', (err) => {
      if (req.destroyed || err?.code === 'ECONNRESET' || err?.message === 'aborted') gone();
      else fail(err);
    });
    req.on('close', () => {
      if (!req.complete) gone();
    });
  });
}

export function createApp({
  rootDir = ROOT,
  publicDir = path.join(rootDir, 'public'),
  contentDir = path.join(rootDir, 'content'),
  logger = console,
  regions = createRegionStore({ logger }),
  papers = createPaperStore({ logger }),
  ai = createAI({ logger }),
  logRequests = true,
  host = process.env.HOST,
  allowedHosts = process.env.ALLOWED_HOSTS,
  trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? ''),
} = {}) {
  const pdfjs = path.join(rootDir, 'node_modules', 'pdfjs-dist');
  const mounts = [
    { prefix: '/vendor/three/', dir: path.join(rootDir, 'node_modules', 'three', 'build') },
    { prefix: '/vendor/pdfjs/', dir: path.join(pdfjs, 'build') },
    { prefix: '/vendor/pdfjs-web/', dir: path.join(pdfjs, 'web') },
    { prefix: '/vendor/pdfjs-cmaps/', dir: path.join(pdfjs, 'cmaps') }, // getDocument({ cMapUrl, cMapPacked: true })
    { prefix: '/vendor/pdfjs-fonts/', dir: path.join(pdfjs, 'standard_fonts') }, // getDocument({ standardFontDataUrl })
    { prefix: '/content/regions/', dir: regions.dir || path.join(contentDir, 'regions') }, // the files the server reads (REGIONS_DIR aware)
    { prefix: '/content/', dir: contentDir },
    { prefix: '/', dir: publicDir },
  ].map((m) => ({ ...m, dir: path.resolve(m.dir) }));
  const realDirs = new Map();
  const cspCache = new Map(); // html file -> { mtimeMs, size, value }
  const hostList = hostAllowList(host, allowedHosts);
  const refusedHosts = new Set();

  async function realDir(dir) {
    if (!realDirs.has(dir)) realDirs.set(dir, await fsp.realpath(dir).catch(() => dir));
    return realDirs.get(dir);
  }

  async function cspFor(file, st) {
    const hit = cspCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
    const value = contentSecurityPolicy(await fsp.readFile(file, 'utf8'));
    cspCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
    return value;
  }

  function noteRefusedHost(value) {
    const shown = String(value).replace(/[^\x20-\x7e]/g, '?').slice(0, 100);
    if (refusedHosts.has(shown) || refusedHosts.size >= 20) return;
    refusedHosts.add(shown);
    logger.warn?.(`[server] refused Host "${shown}" (to allow it: ALLOWED_HOSTS=<name>)`);
  }

  // The host values we would act on: Host, plus X-Forwarded-Host behind a trusted proxy.
  function hostValues(req, absoluteHost) {
    const values = [req.headers.host];
    if (trustProxy && req.headers['x-forwarded-host']) values.push(...String(req.headers['x-forwarded-host']).split(','));
    if (absoluteHost) values.push(absoluteHost);
    return values;
  }

  function sameOrigin(origin, req) {
    let o;
    try {
      o = new URL(origin);
    } catch {
      return false; // includes "null" (sandboxed frames, file: pages)
    }
    if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
    const own = parseHost(trustProxy && req.headers['x-forwarded-host'] ? firstValue(req.headers['x-forwarded-host']) : req.headers.host);
    const theirs = parseHost(o.host);
    return Boolean(own && theirs && own.hostname === theirs.hostname && own.port === theirs.port);
  }

  // A page on another site (or another port of this one) is calling the API.
  function fromOtherSite(req) {
    const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (site === 'cross-site' || site === 'same-site') return true;
    const { origin } = req.headers;
    return origin !== undefined && origin !== '' && !sameOrigin(origin, req);
  }

  // -> an HttpError to answer with, or null to go ahead.
  function refusal(req, isApi, absoluteHost) {
    for (const value of hostValues(req, absoluteHost)) {
      if (value === undefined) continue; // no Host at all (HTTP/1.0 tools): not a browser, nothing to rebind
      const parsed = parseHost(value);
      if (!parsed || !isAllowedHostname(parsed.hostname, hostList)) {
        noteRefusedHost(value);
        return new HttpError(403, SAY.unknownHost);
      }
    }
    if (isApi && fromOtherSite(req)) return new HttpError(403, SAY.otherSite);
    return null;
  }

  async function serveStatic(req, res, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    const mount = mounts.find((m) => rawPath.startsWith(m.prefix));
    let rel;
    try {
      rel = decodeURIComponent(rawPath.slice(mount.prefix.length));
    } catch {
      return sendText(res, 400, 'Bad request');
    }
    if (rel.includes('\0') || rel.includes('\\')) return sendText(res, 400, 'Bad request');
    const segments = rel.split('/').filter(Boolean);
    // No dot segments (traversal) and no dotfiles (.env, .git, ...).
    if (segments.some((s) => s.startsWith('.'))) return sendText(res, 404, 'Not found');
    let file = path.resolve(mount.dir, ...segments);
    if (!isInside(mount.dir, file)) return sendText(res, 404, 'Not found');
    let st;
    try {
      st = await fsp.stat(file);
      if (st.isDirectory()) {
        file = path.join(file, 'index.html');
        st = await fsp.stat(file);
      }
    } catch {
      return sendText(res, 404, 'Not found');
    }
    if (!st.isFile()) return sendText(res, 404, 'Not found');
    const real = await fsp.realpath(file).catch(() => null);
    if (!real || !isInside(await realDir(mount.dir), real)) return sendText(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = ext === '.html' ? { 'Content-Security-Policy': await cspFor(file, st) } : {};
    return sendFile(req, res, file, st, { type, headers });
  }

  async function body(req, pathname) {
    const type = String(req.headers['content-type'] || '');
    if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) {
      req.resume();
      throw new HttpError(415, SAY.notJson);
    }
    return readJSONBody(req, bodyLimitFor(pathname));
  }

  async function paperText(region) {
    if (!ai.enabled || !region?.paper?.arxivId) return null;
    try {
      return await papers.getText(region.paper.arxivId);
    } catch (err) {
      logger.warn?.(`[papers] no text for ${region.paper.arxivId}: ${err.message}`);
      return null;
    }
  }

  async function handleBook(req, res, signal) {
    const { regionId = null, question, selection, history, learned } = await body(req, '/api/book');
    if (!nonEmpty(question)) throw new HttpError(400, SAY.noQuestion);
    if (regionId !== null && typeof regionId !== 'string') throw new HttpError(400, SAY.badRegion);
    const region = regionId ? regions.getRegion(regionId) : null;
    if (regionId && !region) throw new HttpError(404, SAY.noPlace);
    if (!region) return sendJSON(res, 200, { answer: labBookAnswer(question), refused: false, offline: !ai.enabled });
    const result = await ai.book({
      region,
      paperText: await paperText(region),
      question: question.trim(),
      selection: typeof selection === 'string' ? selection : undefined,
      history: Array.isArray(history) ? history : undefined,
      learned: conceptTitles(learned),
      signal,
    });
    return sendJSON(res, 200, result);
  }

  // concept ids from the player's Learned pages -> titles from content/concepts.json (anything else is dropped)
  let concepts = null;
  function conceptTitles(ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    if (!concepts) {
      concepts = new Map();
      try {
        for (const c of JSON.parse(fs.readFileSync(path.join(contentDir, 'concepts.json'), 'utf8'))) if (c?.id && c?.title) concepts.set(c.id, c.title);
      } catch (err) { logger.warn?.(`[book] concepts.json: ${err.message}`); }
    }
    return [...new Set(ids.filter((id) => typeof id === 'string').slice(0, 64).map((id) => concepts.get(id)).filter(Boolean))];
  }

  async function handleAvatar(req, res, signal) {
    const { image } = await body(req, '/api/avatar');
    const result = await ai.avatar({ image, signal });
    return sendJSON(res, 200, result);
  }

  async function handleGrade(req, res, signal) {
    const { regionId, challengeId, answer } = await body(req, '/api/grade');
    if (!nonEmpty(regionId) || !nonEmpty(challengeId)) throw new HttpError(400, SAY.whichChallenge);
    if (!nonEmpty(answer)) throw new HttpError(400, SAY.empty);
    if (answer.length > 6000) throw new HttpError(400, SAY.tooLong);
    const region = regions.getRegion(regionId);
    if (!region) throw new HttpError(404, SAY.noPlace);
    const challenge = findChallenge(region, challengeId);
    if (!challenge) throw new HttpError(404, SAY.nobodyAsked);
    if (challenge.type !== 'explain') throw new HttpError(400, SAY.wrongKind);
    const result = await ai.grade({ region, challenge, paperText: await paperText(region), answer: answer.trim(), signal });
    return sendJSON(res, 200, result);
  }

  async function handlePaper(req, res, rawId, what) {
    let id;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      throw new HttpError(400, SAY.badId);
    }
    if (what === 'text') return sendJSON(res, 200, { text: await papers.getText(id) });
    if (what === 'meta') return sendJSON(res, 200, await papers.getMeta(id));
    const pdf = await papers.getPdf(id);
    const headers = { 'Content-Disposition': `inline; filename="${id}.pdf"` };
    if (pdf.file) {
      return sendFile(req, res, pdf.file, await fsp.stat(pdf.file), { type: 'application/pdf', cacheControl: 'public, max-age=86400', headers });
    }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.data.length, 'Cache-Control': 'public, max-age=86400', ...headers });
    return res.end(req.method === 'HEAD' ? undefined : pdf.data);
  }

  async function handleApi(req, res, pathname, signal) {
    const only = (...methods) => {
      if (!methods.includes(req.method)) {
        req.resume();
        throw new HttpError(405, SAY.wrongMethod, { Allow: methods.join(', ') });
      }
    };
    if (pathname === '/api/status') {
      only('GET', 'HEAD');
      return sendJSON(res, 200, { ai: ai.enabled, model: ai.model || MODEL });
    }
    const paper = /^\/api\/paper\/([^/]+)\/(pdf|text|meta)$/.exec(pathname);
    if (paper) {
      only('GET', 'HEAD');
      return handlePaper(req, res, paper[1], paper[2]);
    }
    if (pathname === '/api/book') {
      only('POST');
      return handleBook(req, res, signal);
    }
    if (pathname === '/api/avatar') {
      only('POST');
      return handleAvatar(req, res, signal);
    }
    if (pathname === '/api/grade') {
      only('POST');
      return handleGrade(req, res, signal);
    }
    req.resume();
    throw new HttpError(404, SAY.noPath);
  }

  async function handle(req, res) {
    const started = Date.now();
    let rawPath = String(req.url || '/').split(/[?#]/)[0];
    let absoluteHost = null;
    if (!rawPath.startsWith('/')) {
      try {
        const url = new URL(req.url);
        rawPath = url.pathname;
        absoluteHost = url.host;
      } catch {
        return sendText(res, 400, 'Bad request');
      }
    }
    const isApi = rawPath === '/api' || rawPath.startsWith('/api/');
    if (isApi && logRequests) {
      res.on('close', () => logger.log?.(`${req.method} ${rawPath} ${res.headersSent ? res.statusCode : GONE} ${Date.now() - started}ms`));
    }
    const refused = refusal(req, isApi, absoluteHost);
    if (refused) {
      req.resume();
      return isApi ? sendError(res, refused) : sendText(res, refused.status, refused.message);
    }
    if (!isApi) return serveStatic(req, res, rawPath);

    // Abort the Claude call if the player closes the book mid-question.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    try {
      await handleApi(req, res, rawPath, controller.signal);
    } catch (err) {
      if (err?.status === GONE) return undefined;
      if (err instanceof HttpError || err instanceof AIError || err instanceof PaperError) {
        sendError(res, err);
      } else {
        logger.error?.(`[server] ${req.method} ${rawPath} failed:`, err);
        sendError(res, new HttpError(500, SAY.jammed));
      }
    }
    return undefined;
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error?.('[server] unhandled', err);
      if (!res.headersSent) sendText(res, 500, 'Internal error');
      else res.destroy();
    });
  });
  // "Expect: 100-continue" (curl does this for big uploads): refuse oversized bodies before they are sent.
  server.on('checkContinue', (req, res) => {
    const rawPath = String(req.url || '/').split(/[?#]/)[0];
    if (Number(req.headers['content-length']) > bodyLimitFor(rawPath)) {
      sendError(res, new HttpError(413, SAY.tooBig, { Connection: 'close' }));
      return;
    }
    res.writeContinue();
    server.emit('request', req, res);
  });
  server.on('clientError', (err, socket) => {
    if (socket.writable && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  return server;
}

export async function startServer({ port, host, ...options } = {}) {
  const server = createApp({ host, ...options });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

// ---------------------------------------------------------------------------------------------
// Behind an HTTPS proxy (corporate networks, sandboxes) Node's fetch ignores HTTPS_PROXY unless the
// process starts with NODE_USE_ENV_PROXY=1 (Node >= 22.21 / 24.5). Restart once with it so arXiv and
// alphaXiv downloads (and Claude calls) go through the proxy. Opt out with ETL_NO_PROXY_RELAUNCH=1.

export function needsProxyRelaunch(env = process.env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY || env.ETL_NO_PROXY_RELAUNCH || env.ETL_RELAUNCHED) return false;
  return Boolean(process.allowedNodeEnvironmentFlags?.has('--use-env-proxy'));
}

export function relaunchWithEnvProxy({ logger = console } = {}) {
  const env = { ...process.env, NODE_USE_ENV_PROXY: '1', ETL_RELAUNCHED: '1' };
  delete env.WATCH_REPORT_DEPENDENCIES; // only the original process reports to `node --watch`
  const execArgv = [...process.execArgv];
  if (process.allowedNodeEnvironmentFlags?.has('--disable-warning')) execArgv.push('--disable-warning=UNDICI-EHPA');
  logger.log?.('[server] HTTPS proxy detected: restarting with NODE_USE_ENV_PROXY=1 so downloads use it.');
  const child = spawn(process.execPath, [...execArgv, ...process.argv.slice(1)], {
    env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'], // the IPC channel lets the child notice if we die
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    });
  }
  child.on('error', (err) => {
    logger.error?.(`[server] could not restart: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  return child;
}

async function main() {
  if (needsProxyRelaunch()) {
    relaunchWithEnvProxy();
    return;
  }
  const port = process.env.PORT === undefined || process.env.PORT === '' ? 3000 : Number(process.env.PORT);
  const host = process.env.HOST || 'localhost';
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT must be a number between 0 and 65535 (got "${process.env.PORT}").`);
    process.exit(1);
  }
  const ai = createAI();
  let server;
  try {
    server = await startServer({ port, host, ai });
  } catch (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${port} on ${host} is already in use. Stop the other server or pick another one: PORT=3001 npm start`
      : `Could not start the server: ${err.message}`);
    process.exit(1);
  }
  const addr = server.address();
  const shownHost = host === 'localhost' || host === '0.0.0.0' || host === '::' ? 'localhost' : (addr.family === 'IPv6' ? `[${addr.address}]` : addr.address);
  console.log([
    `Escape the Latent is running at http://${shownHost}:${addr.port}/`,
    ai.enabled
      ? `Claude: on (${MODEL}${ai.viaClaudeCode ? ', through your Claude Code login' : ''}).`
      : 'Claude: off (no ANTHROPIC_API_KEY): the book mutters pre-written hints and explanations are graded with keywords.',
  ].join('\n'));

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.env.ETL_RELAUNCHED && process.connected) process.on('disconnect', shutdown);
}

const entry = process.argv[1] ? (() => { try { return fs.realpathSync(process.argv[1]); } catch { return null; } })() : null;
if (entry && entry === fs.realpathSync(fileURLToPath(import.meta.url))) main();
