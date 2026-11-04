#!/usr/bin/env node
// Server test suite: `npm test` (or `node server/test/run.mjs [node --test flags]`).
// Runs every server/test/*.test.mjs file with node:test. Unit and HTTP tests never touch the network
// or the Anthropic API (stub clients). live.test.mjs fetches real papers from arXiv/alphaXiv and skips,
// with a warning, when the network is unavailable. ETL_LIVE_AI=1 with a key also runs real Claude calls.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(here, f));

const env = { ...process.env };
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
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
