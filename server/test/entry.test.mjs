// The real entry point: `node server/index.js` with PORT/HOST/REGIONS_DIR, shutdown and proxy relaunch.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cleanEnv, spawnServer, waitForExit, waitForOutput, portClosed, request, postJSON, tmpDir, FIXTURE_REGIONS, FIXTURE, ROOT } from './helpers.mjs';

const baseEnv = () => cleanEnv({ PORT: '0', HOST: '127.0.0.1', REGIONS_DIR: FIXTURE_REGIONS, PAPERS_CACHE_DIR: tmpDir() });

describe('node server/index.js', () => {
  it('listens on PORT/HOST, serves the API offline and stops on SIGTERM', async () => {
    const { child, port, output } = await spawnServer(baseEnv());
    try {
      assert.match(await waitForOutput(output, /Claude: off/), /Claude: off/);
      const status = await request(port, { path: '/api/status' });
      assert.deepEqual(status.json, { ai: false, model: 'claude-opus-5-5' });
      const region = await request(port, { path: '/content/regions/fixture.json' });
      assert.equal(region.json.id, 'fixture');
      const book = await postJSON(port, '/api/book', { regionId: 'fixture', question: 'Why scale by sqrt(d_k)?' });
      assert.deepEqual(book.json, { answer: FIXTURE.book.offlineHints[1].text, refused: false, offline: true });
      const css = await request(port, { path: '/css/game.css' });
      assert.equal(css.status, 200);
      assert.match(await waitForOutput(output, /POST \/api\/book 200/), /POST \/api\/book 200/);
    } finally {
      child.kill('SIGTERM');
    }
    const { code } = await waitForExit(child);
    assert.equal(code, 0);
    assert.ok(await portClosed(port));
  });

  it('does not start a server when imported as a module', () => {
    const src = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./server/index.js').then(() => console.log('imported'))"], { cwd: ROOT, env: cleanEnv(), encoding: 'utf8', timeout: 10_000 });
    assert.equal(src.status, 0, src.stderr);
    assert.match(src.stdout, /imported/);
    assert.doesNotMatch(src.stdout, /running at/, 'importing the module must not start a server');
  });

  it('explains a bad PORT and a busy port', async () => {
    const bad = spawnSync(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...baseEnv(), PORT: 'abc' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /PORT must be a number/);

    const blocker = net.createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    try {
      const busy = spawnSync(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...baseEnv(), PORT: String(blocker.address().port) }, encoding: 'utf8', timeout: 10_000 });
      assert.equal(busy.status, 1);
      assert.match(busy.stderr, /already in use/);
    } finally {
      blocker.close();
    }
  });
});

describe('proxy relaunch (NODE_USE_ENV_PROXY)', { skip: !process.allowedNodeEnvironmentFlags.has('--use-env-proxy') && 'this Node has no --use-env-proxy' }, () => {
  const proxyEnv = () => ({ ...baseEnv(), HTTPS_PROXY: 'http://127.0.0.1:9' });

  it('restarts itself once with NODE_USE_ENV_PROXY=1 and stops cleanly', async () => {
    const { child, port, output } = await spawnServer(proxyEnv());
    try {
      assert.match(output(), /restarting with NODE_USE_ENV_PROXY=1/);
      assert.equal(output().match(/restarting/g).length, 1);
      const status = await request(port, { path: '/api/status' });
      assert.equal(status.status, 200);
    } finally {
      child.kill('SIGTERM');
    }
    await waitForExit(child);
    assert.ok(await portClosed(port), 'the relaunched server must stop with its parent');
  });

  it('takes the relaunched server down even if the parent is killed hard', async () => {
    const { child, port } = await spawnServer(proxyEnv());
    child.kill('SIGKILL');
    await waitForExit(child);
    assert.ok(await portClosed(port, 5000), 'no orphaned server may keep the port');
  });

  it('can be switched off', async () => {
    const { child, output } = await spawnServer({ ...proxyEnv(), ETL_NO_PROXY_RELAUNCH: '1' });
    try {
      assert.doesNotMatch(output(), /restarting/);
    } finally {
      child.kill('SIGTERM');
      await waitForExit(child);
    }
  });
});
