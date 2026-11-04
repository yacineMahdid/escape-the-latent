// Fundamentals (basic concepts): explain-kind ones are graded through /api/grade like explain challenges.
import { describe, it, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChallenge } from '../regions.js';
import { createAI } from '../ai.js';
import { startTestServer, postJSON, stubClient, textMessage, recordingLogger, assertTerseError, FIXTURE } from './helpers.mjs';

const region = {
  challenges: [{ id: 'c1', type: 'explain', question: 'q' }],
  fundamentals: [
    {
      id: 'f1', concept: 'softmax', giver: 'pip', title: 'Softmax',
      check: { kind: 'explain', question: 'Why softmax?', rubric: ['r1'], passBar: 'all', offline: [['probab']] },
      wrong: ['Not yet...'], success: ['Yes!'],
    },
    { id: 'f2', concept: 'dot-product', giver: 'pip', title: 'Dot product', check: { kind: 'choice', question: 'a.b?', options: ['1', '2'], answer: 1 } },
  ],
};

test('findChallenge still finds regular challenges', () => {
  assert.equal(findChallenge(region, 'c1').question, 'q');
});

test('explain fundamentals are graded like explain challenges, with their own lines', () => {
  const c = findChallenge(region, 'f1');
  assert.equal(c.type, 'explain');
  assert.equal(c.question, 'Why softmax?');
  assert.deepEqual(c.rubric, ['r1']);
  assert.deepEqual(c.offline, [['probab']]);
  assert.equal(c.giver, 'pip');
  assert.deepEqual(c.retry, ['Not yet...'], '"wrong" lines play the part of "retry"');
  assert.deepEqual(c.success, ['Yes!']);
});

test('non-explain fundamentals are found but not gradeable', () => {
  assert.equal(findChallenge(region, 'f2').type, 'fundamental');
  assert.equal(findChallenge(region, 'nope'), null);
});

const f1 = FIXTURE.fundamentals.find((f) => f.id === 'f1');
const GOOD = 'Softmax turns the scores into weights that sum to one, and bigger scores get bigger weights.';

describe('POST /api/grade with a fundamental id (offline)', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(() => srv.close());

  const grade = (challengeId, answer) => postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId, answer });

  it('passes an answer that has every keyword group', async () => {
    const res = await grade('f1', GOOD);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { pass: true, score: 1, feedback: res.json.feedback, offline: true });
    assert.ok(res.json.feedback.length > 0 && res.json.feedback.length <= 40);
  });

  it('fails with the fundamental\'s own "wrong" line', async () => {
    const res = await grade('f1', 'It makes the bigger numbers win.');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { pass: false, score: 0.5, feedback: f1.wrong[0], offline: true });
  });

  it('400s for a choice fundamental (answered in the dialogue, not graded here)', async () => {
    const res = await grade('f2', '11');
    assert.equal(res.status, 400);
    assertTerseError(res.json, 'bad_input');
  });
});

describe('POST /api/grade with a fundamental id (Claude)', () => {
  it('sends the fundamental\'s question, rubric and pass bar, in the giver\'s voice', async () => {
    const client = stubClient(() => textMessage({ criteria: [], pass: true, score: 1, feedback: 'Yes! Always one.' }));
    const logger = recordingLogger();
    const srv = await startTestServer({ ai: createAI({ client, logger }), logger });
    try {
      const res = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'f1', answer: GOOD });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { pass: true, score: 1, feedback: 'Yes! Always one.', offline: false });
      const system = client.calls[0].params.system.map((b) => b.text).join('\n');
      assert.ok(system.includes(f1.check.question));
      for (const r of f1.check.rubric) assert.ok(system.includes(r), r);
      assert.ok(system.includes(f1.check.passBar));
      assert.match(system, /Pip, a bunny/);
    } finally {
      await srv.close();
    }
  });
});
