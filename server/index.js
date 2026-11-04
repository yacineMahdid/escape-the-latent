// Escape the Latent: plain node:http server (no framework).
//   static:  /  -> public/,  /vendor/three -> three/build,  /vendor/pdfjs -> pdfjs-dist/build,
//            /vendor/pdfjs-web -> pdfjs-dist/web,  /content -> content/
//   api:     see "Server routes" in docs/ARCHITECTURE.md
// Env: PORT (default 3000), HOST (default localhost), REGIONS_DIR, PAPERS_CACHE_DIR, ANTHROPIC_API_KEY.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
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

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const isInside = (dir, p) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const bodyLimitFor = (pathname) => BODY_LIMITS[pathname] ?? DEFAULT_BODY_LIMIT;
const tooLargeMessage = (limit) => `That message is too heavy for the post (over ${limit >= 1024 * 1024 ? `${limit / 1024 / 1024} MB` : `${limit / 1024} KB`}).`;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

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
function readJSONBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit + DRAIN_ALLOWANCE) {
      req.resume();
      reject(new HttpError(413, tooLargeMessage(limit), { Connection: 'close' }));
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
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit + DRAIN_ALLOWANCE) {
        fail(new HttpError(413, tooLargeMessage(limit), { Connection: 'close' }));
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
      if (overflow) return fail(new HttpError(413, tooLargeMessage(limit)));
      if (settled) return undefined;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return reject(new HttpError(400, 'That message was smudged: the body is not valid JSON.'));
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return reject(new HttpError(400, 'Expected a JSON object.'));
      }
      return resolve(data);
    });
    req.on('error', fail);
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
} = {}) {
  const mounts = [
    { prefix: '/vendor/three/', dir: path.join(rootDir, 'node_modules', 'three', 'build') },
    { prefix: '/vendor/pdfjs/', dir: path.join(rootDir, 'node_modules', 'pdfjs-dist', 'build') },
    { prefix: '/vendor/pdfjs-web/', dir: path.join(rootDir, 'node_modules', 'pdfjs-dist', 'web') },
    { prefix: '/content/regions/', dir: regions.dir || path.join(contentDir, 'regions') }, // the files the server reads (REGIONS_DIR aware)
    { prefix: '/content/', dir: contentDir },
    { prefix: '/', dir: publicDir },
  ].map((m) => ({ ...m, dir: path.resolve(m.dir) }));
  const realDirs = new Map();

  async function realDir(dir) {
    if (!realDirs.has(dir)) realDirs.set(dir, await fsp.realpath(dir).catch(() => dir));
    return realDirs.get(dir);
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
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return sendFile(req, res, file, st, { type });
  }

  async function body(req, pathname) {
    const type = String(req.headers['content-type'] || '');
    if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) {
      req.resume();
      throw new HttpError(415, 'Send the request as JSON (Content-Type: application/json).');
    }
    // A page on another site must not spend this server's Claude budget.
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let host = null;
      try { host = new URL(origin).host; } catch { /* malformed */ }
      if (host !== req.headers.host && host !== req.headers['x-forwarded-host']) {
        req.resume();
        throw new HttpError(403, 'Requests from other sites are not allowed.');
      }
    } else if (origin === 'null') {
      req.resume();
      throw new HttpError(403, 'Requests from other sites are not allowed.');
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
    const { regionId = null, question, selection, history } = await body(req, '/api/book');
    if (!nonEmpty(question)) throw new HttpError(400, 'Ask the book something first.');
    if (regionId !== null && typeof regionId !== 'string') throw new HttpError(400, 'regionId must be a string or null.');
    const region = regionId ? regions.getRegion(regionId) : null;
    if (regionId && !region) throw new HttpError(404, "The book has never heard of that place.");
    if (!region) return sendJSON(res, 200, { answer: labBookAnswer(question), refused: false, offline: !ai.enabled });
    const result = await ai.book({
      region,
      paperText: await paperText(region),
      question: question.trim(),
      selection: typeof selection === 'string' ? selection : undefined,
      history: Array.isArray(history) ? history : undefined,
      signal,
    });
    return sendJSON(res, 200, result);
  }

  async function handleAvatar(req, res, signal) {
    const { image } = await body(req, '/api/avatar');
    const result = await ai.avatar({ image, signal });
    return sendJSON(res, 200, result);
  }

  async function handleGrade(req, res, signal) {
    const { regionId, challengeId, answer } = await body(req, '/api/grade');
    if (!nonEmpty(regionId) || !nonEmpty(challengeId)) throw new HttpError(400, 'Which challenge is this explanation for? (regionId and challengeId)');
    if (!nonEmpty(answer)) throw new HttpError(400, 'Say something first: explain it in your own words.');
    if (answer.length > 6000) throw new HttpError(400, "That's a whole book! Explain it in a few sentences.");
    const region = regions.getRegion(regionId);
    if (!region) throw new HttpError(404, 'No such place on the map.');
    const challenge = findChallenge(region, challengeId);
    if (!challenge) throw new HttpError(404, 'Nobody here asked for that.');
    if (challenge.type !== 'explain') throw new HttpError(400, "That challenge isn't solved by explaining.");
    const result = await ai.grade({ region, challenge, paperText: await paperText(region), answer: answer.trim(), signal });
    return sendJSON(res, 200, result);
  }

  async function handlePaper(req, res, rawId, what) {
    let id;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      throw new HttpError(400, "That doesn't look like an arXiv id.");
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
        throw new HttpError(405, `Use ${methods.filter((m) => m !== 'HEAD').join(' or ')} for ${pathname}.`, { Allow: methods.join(', ') });
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
    throw new HttpError(404, 'No such path here.');
  }

  async function handle(req, res) {
    const started = Date.now();
    let rawPath = String(req.url || '/').split(/[?#]/)[0];
    if (!rawPath.startsWith('/')) {
      try { rawPath = new URL(req.url).pathname; } catch { return sendText(res, 400, 'Bad request'); }
    }
    if (!rawPath.startsWith('/api/') && rawPath !== '/api') return serveStatic(req, res, rawPath);

    // Abort the Claude call if the player closes the book mid-question.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
      if (logRequests) logger.log?.(`${req.method} ${rawPath} ${res.statusCode} ${Date.now() - started}ms`);
    });
    try {
      await handleApi(req, res, rawPath, controller.signal);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJSON(res, err.status, { error: err.message }, err.headers);
      } else if (err instanceof AIError) {
        if (err.status !== 499) {
          sendJSON(res, err.status, { error: err.message, ...(err.offline ? { offline: true } : {}), ...(err.retryable ? { retryable: true } : {}) });
        }
      } else if (err instanceof PaperError) {
        sendJSON(res, err.status, { error: err.message });
      } else {
        logger.error?.(`[server] ${req.method} ${rawPath} failed:`, err);
        sendJSON(res, 500, { error: 'Something went wrong on the server. Try again.' });
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
      sendJSON(res, 413, { error: tooLargeMessage(bodyLimitFor(rawPath)) }, { Connection: 'close' });
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
  const server = createApp(options);
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
      ? `Claude: on (${MODEL}).`
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
