// Shared helpers for the server tests.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createApp } from '../index.js';
import { createRegionStore } from '../regions.js';
import { createAI } from '../ai.js';
import { PaperError } from '../papers.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const FIXTURE_REGIONS = path.join(HERE, 'fixtures', 'regions');
export const FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURE_REGIONS, 'fixture.json'), 'utf8'));

export const PAPER_TEXT = [
  '# Attention Is All You Need',
  '',
  '## 3.2.1 Scaled Dot-Product Attention',
  '',
  'We compute the dot products of the query with all keys, divide each by sqrt(d_k), and apply a softmax',
  'function to obtain the weights on the values. Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V   (1)',
  '',
  'We suspect that for large values of d_k, the dot products grow large in magnitude, pushing the softmax',
  'function into regions where it has extremely small gradients. To counteract this effect, we scale the',
  'dot products by 1/sqrt(d_k).',
].join('\n');

// A 1x1 PNG and the start of a JPEG, as data URLs.
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
export const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]).toString('base64');

export function recordingLogger() {
  const lines = [];
  const rec = (level) => (...args) => lines.push({ level, text: args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' ') });
  return { lines, log: rec('log'), info: rec('info'), warn: rec('warn'), error: rec('error'), text: () => lines.map((l) => l.text).join('\n') };
}

export function tmpDir(prefix = 'etl-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Paper store stand-in: no network.
export function fakePapers({ text = PAPER_TEXT, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async getText(id) {
      calls.push(['text', id]);
      if (fail) throw new PaperError(502, 'The alphaXiv reading room can\'t be reached right now.');
      return text;
    },
    async getMeta(id) {
      calls.push(['meta', id]);
      return { title: 'Attention Is All You Need', votes: 1, visits: 2 };
    },
    async getPdf(id) {
      calls.push(['pdf', id]);
      throw new PaperError(502, 'No PDFs in unit tests.');
    },
  };
}

// Stands in for `new Anthropic()`: records every client.beta.messages.create call.
export function stubClient(responder) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params, options = {}) {
          calls.push({ params: structuredClone(params), timeout: options.timeout, hasSignal: Boolean(options.signal) });
          return responder(params, calls.length);
        },
      },
    },
  };
}

export function textMessage(payload, { stop_reason = 'end_turn', extraBlocks = [] } = {}) {
  return {
    id: 'msg_stub',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason,
    stop_details: null,
    content: [
      { type: 'thinking', thinking: '', signature: 'stub-signature' },
      ...extraBlocks,
      { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
    ],
    usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

// A refusal whose content must not be read: touching it throws.
export function refusalMessage() {
  const msg = {
    id: 'msg_refused',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: 'cyber', explanation: 'stub refusal' },
    usage: { input_tokens: 10, output_tokens: 0 },
  };
  Object.defineProperty(msg, 'content', {
    enumerable: true,
    get() { throw new Error('content was read on a refusal'); },
  });
  return msg;
}

export async function startTestServer({ logger = recordingLogger(), regions, ai, papers, ...rest } = {}) {
  const server = createApp({
    logger,
    regions: regions ?? createRegionStore({ dir: FIXTURE_REGIONS, logger }),
    ai: ai ?? createAI({ env: {}, logger }),
    papers: papers ?? fakePapers(),
    ...rest,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    port,
    logger,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

// Raw HTTP request: the path goes out exactly as given (no URL normalisation), unlike fetch.
export function request(port, { method = 'GET', path: reqPath = '/', headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null
      : Buffer.isBuffer(body) ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      agent: false,
      headers: { ...(payload && !chunked ? { 'content-length': payload.length } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload && chunked) {
      // Write in pieces without a Content-Length so Node uses chunked transfer encoding.
      const step = 64 * 1024;
      for (let i = 0; i < payload.length; i += step) req.write(payload.subarray(i, i + step));
    } else if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

export const postJSON = (port, p, data, headers = {}) =>
  request(port, { method: 'POST', path: p, headers: { 'content-type': 'application/json', ...headers }, body: data });

// Environment for spawning the real server: no keys, no proxy, nothing inherited that changes behaviour.
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
    'NODE_USE_ENV_PROXY', 'ETL_RELAUNCHED', 'ETL_NO_PROXY_RELAUNCH', 'PORT', 'HOST', 'REGIONS_DIR', 'PAPERS_CACHE_DIR']) {
    delete env[k];
  }
  return { ...env, ...extra };
}

// Spawns `node server/index.js` and resolves once it prints its URL.
export function spawnServer(env, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => {
      out += d;
      const m = /running at http:\/\/[^\s]+?:(\d+)\//.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]), output: () => out });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`server exited early (code ${code}):\n${out}`), { code, output: out }));
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not start in time:\n${out}`));
    }, timeoutMs);
  });
}

// Polls a spawned server's output until it matches.
export async function waitForOutput(output, re, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!re.test(output()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  return output();
}

export function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

// Resolves true once nothing accepts connections on the port.
export async function portClosed(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/status', agent: false, timeout: 500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (!open) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
