#!/usr/bin/env node
// Server test suite: `npm test` (or `node server/test/run.mjs [node --test flags]`).
// Runs every server/test/*.test.mjs file with node:test. Unit and HTTP tests never touch the network
// or the Anthropic API (stub clients). ETL_LIVE=1 also runs live.test.mjs, which fetches real papers
// from arXiv/alphaXiv; ETL_LIVE_AI=1 with a key also makes real Claude calls.
//
// Temp folders all go under one root per run (ETL_TEST_TMP), removed when the run ends. Leftovers of
// runs that were killed (older than an hour) are swept first.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(here, f));

const STALE_MS = 60 * 60 * 1000;
for (const name of fs.readdirSync(os.tmpdir())) {
  if (!/^etl-(test-|live-cache-)/.test(name)) continue; // ours: etl-test-run-* (and older etl-test-*, etl-live-cache-*)
  const dir = path.join(os.tmpdir(), name);
  try {
    if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* gone already, or not ours to touch */ }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'etl-test-run-'));
const cleanup = () => fs.rmSync(tmpRoot, { recursive: true, force: true });

const env = { ...process.env, ETL_TEST_TMP: tmpRoot };
if (!env.ETL_LIVE_AI) {
  // Offline paths must be exercised for real, and no test may spend tokens by accident.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
}
// Node's fetch only honours HTTPS_PROXY when started with NODE_USE_ENV_PROXY=1 (see server/index.js).
const proxied = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
if (proxied && !env.NODE_USE_ENV_PROXY && process.allowedNodeEnvironmentFlags.has('--use-env-proxy')) {
  env.NODE_USE_ENV_PROXY = '1';
  if (process.allowedNodeEnvironmentFlags.has('--disable-warning')) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--disable-warning=UNDICI-EHPA`;
  }
}

const child = spawn(process.execPath, ['--test', '--test-reporter=spec', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
  env,
  cwd: path.resolve(here, '..', '..'),
});
// Ctrl-C reaches the test runner too; wait for it so the temp root can be removed.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});
