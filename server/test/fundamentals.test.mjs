import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChallenge } from '../regions.js';

const region = {
  challenges: [{ id: 'c1', type: 'explain', question: 'q' }],
  fundamentals: [
    { id: 'f1', concept: 'softmax', giver: 'pip', title: 'Softmax', check: { kind: 'explain', question: 'Why softmax?', rubric: ['r1'], passBar: 'all', offline: [['probab']] } },
    { id: 'f2', concept: 'dot-product', giver: 'pip', title: 'Dot product', check: { kind: 'choice', question: 'a.b?', options: ['1', '2'], answer: 1 } },
  ],
};

test('findChallenge still finds regular challenges', () => {
  assert.equal(findChallenge(region, 'c1').question, 'q');
});

test('explain fundamentals are graded like explain challenges', () => {
  const c = findChallenge(region, 'f1');
  assert.equal(c.type, 'explain');
  assert.equal(c.question, 'Why softmax?');
  assert.deepEqual(c.rubric, ['r1']);
  assert.deepEqual(c.offline, [['probab']]);
  assert.equal(c.giver, 'pip');
});

test('non-explain fundamentals are found but not gradeable', () => {
  assert.equal(findChallenge(region, 'f2').type, 'fundamental');
  assert.equal(findChallenge(region, 'nope'), null);
});
