// Region store: lookups, id safety, reload on mtime change, and the fixture's own validity.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createRegionStore, defaultRegionsDir, findChallenge, findSpeaker } from '../regions.js';
import { FIXTURE_REGIONS, FIXTURE, ROOT, HERE, tmpDir, recordingLogger } from './helpers.mjs';

describe('region store', () => {
  it('loads a region by id', () => {
    const store = createRegionStore({ dir: FIXTURE_REGIONS });
    const region = store.getRegion('fixture');
    assert.equal(region.id, 'fixture');
    assert.equal(region.paper.arxivId, '1706.03762');
    assert.equal(store.getRegion('fixture'), region, 'unchanged files come from memory');
    assert.deepEqual(store.listRegions().map((r) => r.id), ['fixture']);
  });

  it('refuses unsafe or unknown ids', () => {
    const store = createRegionStore({ dir: FIXTURE_REGIONS });
    for (const id of ['../fixture', 'fix.ture', 'fixture.json', 'a/b', '', ' fixture', null, undefined, 42, 'missing']) {
      assert.equal(store.getRegion(id), null, String(id));
    }
  });

  it('reloads when the file changes and keeps the last good copy through a broken save', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'meadow.json');
    const write = (data, mtimeSec) => {
      fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
      fs.utimesSync(file, mtimeSec, mtimeSec);
    };
    const logger = recordingLogger();
    const store = createRegionStore({ dir, logger });
    write({ ...FIXTURE, id: 'meadow', region: { ...FIXTURE.region, name: 'First' } }, 1_700_000_000);
    assert.equal(store.getRegion('meadow').region.name, 'First');
    write({ ...FIXTURE, id: 'meadow', region: { ...FIXTURE.region, name: 'Second' } }, 1_700_000_100);
    assert.equal(store.getRegion('meadow').region.name, 'Second');
    write('{ "id": "meadow", oops', 1_700_000_200);
    assert.equal(store.getRegion('meadow').region.name, 'Second');
    assert.match(logger.text(), /could not load meadow\.json/);
    fs.rmSync(file);
    assert.equal(store.getRegion('meadow'), null);
  });

  it('folds in the published extra pack: challenges, book guard lines and offline hints', () => {
    const dir = tmpDir();
    const extraDir = tmpDir();
    fs.writeFileSync(path.join(dir, 'meadow.json'), JSON.stringify({ ...FIXTURE, id: 'meadow' }));
    const store = createRegionStore({ dir, extraDir });
    const base = store.getRegion('meadow');
    const n = base.challenges.length;
    const guards = (base.book?.guard || []).length;
    fs.writeFileSync(path.join(extraDir, 'meadow.json'), JSON.stringify({
      challenges: [{ id: 'q1', type: 'quiz', giver: 'x' }],
      book: { guard: ['Never say 42.'], offlineHints: [{ keywords: ['answer'], text: 'Look closer.' }] },
    }));
    const region = store.getRegion('meadow');
    assert.equal(region.challenges.length, n + 1);
    assert.ok(findChallenge(region, 'q1'));
    assert.equal(region.book.guard.length, guards + 1);
    assert.equal(region.book.guard.at(-1), 'Never say 42.');
    assert.equal(region.book.offlineHints.at(-1).text, 'Look closer.');
    assert.equal(store.getRegion('meadow'), region, 'unchanged files come from memory');
    assert.equal(base.challenges.length, n, 'the base region object is left alone');
    fs.rmSync(path.join(extraDir, 'meadow.json'));
    assert.equal(store.getRegion('meadow').challenges.length, n, 'no pack, no extra challenges');
  });

  it('fills a missing id from the file name', () => {
    const dir = tmpDir();
    const { id, ...rest } = FIXTURE;
    fs.writeFileSync(path.join(dir, 'noid.json'), JSON.stringify(rest));
    assert.equal(createRegionStore({ dir }).getRegion('noid').id, 'noid');
  });

  it('reads REGIONS_DIR, defaulting to content/regions', () => {
    assert.equal(defaultRegionsDir({}), path.join(ROOT, 'content', 'regions'));
    assert.equal(defaultRegionsDir({ REGIONS_DIR: FIXTURE_REGIONS }), FIXTURE_REGIONS);
  });

  it('finds challenges and the inhabitant or station who gives them', () => {
    assert.equal(findChallenge(FIXTURE, 'explain1').type, 'explain');
    assert.equal(findChallenge(FIXTURE, 'nope'), null);
    assert.deepEqual(findSpeaker(FIXTURE, 'elder'), { name: 'Elder Moss', species: 'frog', role: FIXTURE.inhabitants[1].role });
    assert.equal(findSpeaker(FIXTURE, 'loom').name, 'The Glow Loom');
    assert.equal(findSpeaker(FIXTURE, 'ghost').name, 'the villager');
  });
});

describe('fixture region', () => {
  it('has every section of the region contract', () => {
    for (const key of ['id', 'paper', 'region', 'scientist', 'story', 'inhabitants', 'stations', 'challenges', 'artefact', 'book']) {
      assert.ok(key in FIXTURE, key);
    }
    assert.equal(FIXTURE.paper.arxivId, '1706.03762');
    assert.equal(FIXTURE.paper.title, 'Attention Is All You Need');
    assert.equal(FIXTURE.region.biome, 'meadow');
    assert.equal(FIXTURE.inhabitants.length, 2);
    assert.equal(FIXTURE.book.offlineHints.length, 4);
    assert.ok(FIXTURE.book.guard.length > 0);
    const code = findChallenge(FIXTURE, 'code1');
    assert.equal(code.type, 'code');
    assert.match(code.tests, /def test_/);
    const explain = findChallenge(FIXTURE, 'explain1');
    assert.deepEqual(explain.offline, [['sqrt', 'square root', 'scale', 'scaling'], ['softmax', 'saturat', 'gradient']]);
    assert.ok(explain.rubric.length >= 2);
    for (const c of FIXTURE.challenges) {
      const givers = [...FIXTURE.inhabitants, ...FIXTURE.stations].map((x) => x.id);
      assert.ok(givers.includes(c.giver), `${c.id} giver`);
    }
  });

  it('has an explain and a choice fundamental, posed by an inhabitant after the main chain', () => {
    const kinds = FIXTURE.fundamentals.map((f) => f.check.kind);
    assert.deepEqual(kinds.sort(), ['choice', 'explain']);
    const ids = new Set([...FIXTURE.challenges, ...FIXTURE.fundamentals].map((c) => c.id));
    assert.equal(ids.size, FIXTURE.challenges.length + FIXTURE.fundamentals.length, 'one id space');
    for (const f of FIXTURE.fundamentals) {
      assert.ok(FIXTURE.inhabitants.some((i) => i.id === f.giver), `${f.id} giver`);
      assert.deepEqual(f.requires, ['explain1'], 'never in the way of the main chain');
      for (const line of [...f.intro, ...f.wrong, ...f.success, ...f.known]) assert.ok(line.length <= 90, line);
    }
    const explainF = findChallenge(FIXTURE, 'f1');
    assert.equal(explainF.type, 'explain');
    assert.deepEqual(explainF.retry, FIXTURE.fundamentals[0].wrong);
    assert.equal(findChallenge(FIXTURE, 'f2').type, 'fundamental');
  });

  // The code challenge's tests must pass the reference solution and fail the starter and a naive softmax.
  it('code1 tests separate a correct softmax from wrong ones (python3 + numpy)', (t) => {
    const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) return t.skip('python3 with numpy is not available');
    const code = findChallenge(FIXTURE, 'code1');
    const solution = fs.readFileSync(path.join(ROOT, code.solutionFile), 'utf8');
    const naive = 'import numpy as np\ndef softmax(x):\n    e = np.exp(x)\n    return e / e.sum(axis=1, keepdims=True)\n';
    const columns = 'import numpy as np\ndef softmax(x):\n    z = x - x.max()\n    e = np.exp(z)\n    return e / e.sum(axis=0, keepdims=True)\n';
    const harness = [
      'import sys, json, warnings, numpy as np',
      'warnings.simplefilter("ignore")',
      'src = sys.stdin.read()',
      'scope = {}',
      'exec(src, scope)',
      'results = {}',
      'for name, fn in list(scope.items()):',
      '    if name.startswith("test_") and callable(fn):',
      '        try:',
      '            fn(); results[name] = "pass"',
      '        except Exception as e:',
      '            results[name] = type(e).__name__',
      'print(json.dumps(results))',
    ].join('\n');
    const run = (impl) => {
      const out = spawnSync('python3', ['-I', '-c', harness], { input: `${impl}\n${code.tests}`, encoding: 'utf8', cwd: HERE });
      assert.equal(out.status, 0, out.stderr);
      return JSON.parse(out.stdout);
    };
    const good = run(solution);
    assert.ok(Object.keys(good).length >= 5);
    assert.ok(Object.values(good).every((r) => r === 'pass'), JSON.stringify(good));
    assert.ok(Object.values(run(code.starterCode)).every((r) => r !== 'pass'), 'the starter code must fail every test');
    const unstable = run(naive);
    assert.notEqual(unstable.test_large_values_are_stable, 'pass', 'the naive softmax must fail the stability test');
    assert.ok(Object.values(run(columns)).some((r) => r !== 'pass'), 'normalising columns must fail');
    return undefined;
  });
});
