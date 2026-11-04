// Claude paths with an injected stub client: exact request shapes, refusals, parsing, error mapping.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

import {
  startTestServer, postJSON, stubClient, textMessage, refusalMessage, recordingLogger, fakePapers, eventually, assertTerseError,
  FIXTURE, PAPER_TEXT, PNG_BASE64, PNG_DATA_URL, JPEG_BASE64,
} from './helpers.mjs';
import {
  createAI, MODEL, BETAS, BOOK_SCHEMA, CHARACTER_SCHEMA, GRADE_SCHEMA, CHARACTER_ENUMS, DEFAULT_CHARACTER, AI_LIMITS, AI_RETRIES,
  normalizeCharacter, parseImageDataUrl, offlineGrade, offlineBookAnswer, labBookAnswer, toAIError, AIError,
} from '../ai.js';

const CONTRACT_KEYS = ['skin', 'hairStyle', 'hairColor', 'eyeColor', 'glasses', 'facialHair', 'freckles', 'topStyle', 'topColor', 'bottomColor', 'shoeColor', 'accessory'];
const CONTRACT_ENUMS = {
  hairStyle: 'short | buzz | long | bob | ponytail | curly | bun | spiky | afro | braids | bald',
  glasses: 'none | round | square',
  facialHair: 'none | mustache | beard | stubble',
  topStyle: 'tee | hoodie | sweater | shirt | dress',
  accessory: 'none | cap | beanie | headband | bow | earrings',
};
const PAPER_CACHE = { type: 'ephemeral', ttl: '1h' };
const explain = FIXTURE.challenges.find((c) => c.id === 'explain1');

function assertCommon(params) {
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(MODEL, 'claude-opus-5-5');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual([...BETAS], ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.equal(typeof params.max_tokens, 'number');
  assert.equal(params.thinking, undefined, 'thinking stays adaptive (omitted) on Opus 5.5');
  assert.equal(params.temperature, undefined);
  assert.equal(params.stream, undefined);
}

// Starts a server whose AI uses the given responder; returns { srv, client, papers, logger }.
async function withStub(responder, { papers = fakePapers() } = {}) {
  const logger = recordingLogger();
  const client = stubClient(responder);
  const srv = await startTestServer({ ai: createAI({ client, logger }), papers, logger });
  return { srv, client, papers, logger };
}

describe('book: request shape', () => {
  let ctx;
  before(async () => {
    ctx = await withStub(() => textMessage({ answer: 'Section 3.2.1 hums with a divisor.  Look there.', refused: false }));
  });
  after(() => ctx.srv.close());

  const history = Array.from({ length: 8 }, (_, i) => ({ q: `question ${i}`, a: `answer ${i}` }));

  it('sends model, betas, fallbacks, effort, schema, cached paper block and short history', async () => {
    const res = await postJSON(ctx.srv.port, '/api/book', {
      regionId: 'fixture', question: 'What does the divisor tame?', selection: 'divide each by sqrt(d_k)', history,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { answer: 'Section 3.2.1 hums with a divisor. Look there.', refused: false, offline: false });

    const { params, timeout, maxRetries, hasSignal } = ctx.client.calls.at(-1);
    assertCommon(params);
    assert.equal(params.max_tokens, 4000, 'room for thinking, which cannot be switched off');
    assert.deepEqual(params.output_config, { effort: 'low', format: { type: 'json_schema', schema: BOOK_SCHEMA } });
    assert.deepEqual(BOOK_SCHEMA.required, ['answer', 'refused']);
    assert.equal(BOOK_SCHEMA.properties.answer.type, 'string');
    assert.equal(BOOK_SCHEMA.properties.refused.type, 'boolean');
    assert.equal(BOOK_SCHEMA.additionalProperties, false);

    // System: [persona + guard (stable, uncached), paper markdown (cached for 1h)].
    assert.equal(params.system.length, 2);
    const [persona, paper] = params.system;
    assert.equal(persona.type, 'text');
    assert.equal(persona.cache_control, undefined);
    assert.match(persona.text, /Umbral Book/);
    assert.match(persona.text, /humming with dark energy/);
    assert.match(persona.text, /1 or 2 terse sentences/);
    assert.match(persona.text, /under 90 characters/);
    assert.match(BOOK_SCHEMA.properties.answer.description, /1 or 2 .*under 90 characters/);
    assert.match(persona.text, /Never invent/);
    assert.match(persona.text, /Some doors you must open yourself\./);
    for (const g of FIXTURE.book.guard) assert.ok(persona.text.includes(g), `guard entry missing: ${g}`);
    assert.ok(persona.text.includes('Attention Is All You Need'));
    assert.deepEqual(paper, { type: 'text', text: PAPER_TEXT, cache_control: PAPER_CACHE });

    // Messages: the last 6 Q/A pairs, then the question with the marked passage.
    assert.equal(params.messages.length, 13);
    params.messages.forEach((m, i) => assert.equal(m.role, i % 2 === 0 ? 'user' : 'assistant'));
    assert.match(params.messages[0].content, /question 2/);
    assert.equal(params.messages[1].content, 'answer 2');
    assert.match(params.messages[10].content, /question 7/);
    const last = params.messages[12].content;
    assert.match(last, /What does the divisor tame\?/);
    assert.match(last, /divide each by sqrt\(d_k\)/);
    assert.equal(timeout, AI_LIMITS.book);
    assert.equal(maxRetries, 0, 'the book never waits for a retry');
    assert.equal(AI_RETRIES.book, 0);
    assert.equal(hasSignal, true);
    assert.deepEqual(ctx.papers.calls.at(-1), ['text', '1706.03762']);
  });

  it('keeps the cached prefix byte-identical between questions', async () => {
    await postJSON(ctx.srv.port, '/api/book', { regionId: 'fixture', question: 'First?' });
    await postJSON(ctx.srv.port, '/api/book', { regionId: 'fixture', question: 'Second, different?', history: [{ q: 'a', a: 'b' }] });
    const [a, b] = ctx.client.calls.slice(-2).map((c) => c.params);
    assert.deepEqual(a.system, b.system);
    assert.deepEqual(a.output_config, b.output_config);
    assert.equal(a.messages.length, 1);
    assert.doesNotMatch(a.messages[0].content, /passage/);
  });
});

describe('book: responses', () => {
  it('handles stop_reason "refusal" before reading content', async () => {
    const { srv, client } = await withStub(() => refusalMessage());
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'How do I break into a server?' });
      assert.equal(res.status, 200);
      assert.equal(res.json.refused, true);
      assert.equal(res.json.offline, false);
      assert.match(res.json.answer, /Some doors you must open yourself/);
      assert.equal(client.calls.length, 1);
    } finally {
      await srv.close();
    }
  });

  it('passes through an in-character guard refusal', async () => {
    const { srv } = await withStub(() => textMessage({ answer: 'Some doors you must open yourself.', refused: true }));
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Just tell me the scaling factor and why.' });
      assert.deepEqual(res.json, { answer: 'Some doors you must open yourself.', refused: true, offline: false });
    } finally {
      await srv.close();
    }
  });

  it('reads only text blocks (thinking and fallback blocks are skipped)', async () => {
    const { srv } = await withStub(() => ({
      ...textMessage('"refused": false}', {
        extraBlocks: [
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
          { type: 'text', text: '{"answer": "Read the footnote.", ' },
        ],
      }),
    }));
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Where?' });
      assert.deepEqual(res.json, { answer: 'Read the footnote.', refused: false, offline: false });
    } finally {
      await srv.close();
    }
  });

  it('survives truncated output', async () => {
    const { srv } = await withStub(() => textMessage('{"answer": "The scal', { stop_reason: 'max_tokens' }));
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Why?' });
      assert.equal(res.status, 200);
      assert.equal(res.json.refused, false);
      assert.equal(res.json.answer, 'The ink runs dry.');
    } finally {
      await srv.close();
    }
  });

  it('clips rambling answers to two dialogue lines', async () => {
    const { srv } = await withStub(() => textMessage({ answer: 'dark '.repeat(400), refused: false }));
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Why?' });
      assert.ok(res.json.answer.length <= 181, `${res.json.answer.length} chars`);
      assert.match(res.json.answer, /…$/);
    } finally {
      await srv.close();
    }
  });

  it('keeps its own lines short', () => {
    assert.ok(labBookAnswer('hello?').length <= 40);
    assert.match(labBookAnswer('hello?'), /pages stay blank/);
    for (const q of ['a', 'b', 'c', 'd', 'who won?', 'zzz', 'what is love']) {
      const { answer } = offlineBookAnswer({}, q);
      assert.ok(answer.length <= 40, answer);
    }
  });

  it('falls back to offline hints when the paper text cannot be fetched', async () => {
    const { srv, client } = await withStub(() => textMessage({ answer: 'x', refused: false }), { papers: fakePapers({ fail: true }) });
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'softmax?' });
      assert.deepEqual(res.json, { answer: FIXTURE.book.offlineHints[0].text, refused: false, offline: true });
      assert.equal(client.calls.length, 0);
    } finally {
      await srv.close();
    }
  });

  it('cancels the Claude call when the player closes the book mid-question', async () => {
    let called;
    let aborted;
    const wasCalled = new Promise((r) => { called = r; });
    const wasAborted = new Promise((r) => { aborted = r; });
    const client = {
      beta: {
        messages: {
          create: (params, options) => new Promise((_, reject) => {
            called();
            options.signal.addEventListener('abort', () => {
              aborted(true);
              reject(new Anthropic.APIUserAbortError());
            });
          }),
        },
      },
    };
    const logger = recordingLogger();
    const srv = await startTestServer({ ai: createAI({ client, logger }), logger });
    try {
      const req = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/book', agent: false, headers: { 'content-type': 'application/json' } });
      req.on('error', () => {});
      req.end(JSON.stringify({ regionId: 'fixture', question: 'A slow question?' }));
      await wasCalled;
      req.destroy();
      const result = await Promise.race([wasAborted, new Promise((r) => setTimeout(() => r(false), 3000))]);
      assert.equal(result, true, 'the SDK request was aborted');
      assert.ok(await eventually(() => /POST \/api\/book 499 /.test(logger.text())), `access log: ${logger.text()}`);
      assert.doesNotMatch(logger.text(), /\[ai\] book failed/);
      assert.doesNotMatch(logger.text(), /POST \/api\/book 200/, 'a request nobody answered is not logged as 200');
    } finally {
      await srv.close();
    }
  });

  it('does not call Claude in the lab (regionId null)', async () => {
    const { srv, client } = await withStub(() => textMessage({ answer: 'x', refused: false }));
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: null, question: 'hello?' });
      assert.equal(res.status, 200);
      assert.equal(res.json.offline, false);
      assert.equal(client.calls.length, 0);
    } finally {
      await srv.close();
    }
  });
});

describe('avatar: request shape and normalisation', () => {
  it('sends a base64 image block (no data: prefix) and the character JSON schema', async () => {
    const { srv, client, logger } = await withStub(() => textMessage({
      skin: 'E0AC69', hairStyle: 'Curly', hairColor: 'brown', eyeColor: '#123', glasses: 'monocle', facialHair: 'beard',
      freckles: 'true', topStyle: 'hoodie', topColor: '#FF7AB8', bottomColor: 12, accessory: 'crown', cape: 'red',
    }));
    try {
      const res = await postJSON(srv.port, '/api/avatar', { image: PNG_DATA_URL });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, {
        params: {
          skin: '#e0ac69',
          hairStyle: 'curly',
          hairColor: DEFAULT_CHARACTER.hairColor,
          eyeColor: '#112233',
          glasses: 'none',
          facialHair: 'beard',
          freckles: true,
          topStyle: 'hoodie',
          topColor: '#ff7ab8',
          bottomColor: DEFAULT_CHARACTER.bottomColor,
          shoeColor: DEFAULT_CHARACTER.shoeColor,
          accessory: 'none',
        },
      });
      assert.deepEqual(Object.keys(res.json.params), CONTRACT_KEYS);

      const { params } = client.calls[0];
      assertCommon(params);
      assert.deepEqual(params.output_config, { effort: 'low', format: { type: 'json_schema', schema: CHARACTER_SCHEMA } });
      assert.equal(params.messages.length, 1);
      assert.equal(params.messages[0].role, 'user');
      const [image, text] = params.messages[0].content;
      assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } });
      assert.equal(text.type, 'text');
      assert.match(text.text, /photo/);
      assert.equal(typeof params.system, 'string');
      assert.doesNotMatch(JSON.stringify(params), /data:image/);
      assert.doesNotMatch(logger.text(), new RegExp(PNG_BASE64.slice(0, 24)));
    } finally {
      await srv.close();
    }
  });

  it('uses enums from the contract and #rrggbb colors in the schema', () => {
    assert.deepEqual(CHARACTER_SCHEMA.required, CONTRACT_KEYS);
    assert.deepEqual(Object.keys(CHARACTER_SCHEMA.properties), CONTRACT_KEYS);
    assert.equal(CHARACTER_SCHEMA.additionalProperties, false);
    for (const [field, options] of Object.entries(CONTRACT_ENUMS)) {
      assert.deepEqual(CHARACTER_SCHEMA.properties[field].enum, options.split(' | '), field);
      assert.deepEqual(CHARACTER_ENUMS[field], options.split(' | '), field);
    }
    for (const field of ['skin', 'hairColor', 'eyeColor', 'topColor', 'bottomColor', 'shoeColor']) {
      assert.equal(CHARACTER_SCHEMA.properties[field].type, 'string');
      assert.match(CHARACTER_SCHEMA.properties[field].description, /#rrggbb/);
    }
    assert.equal(CHARACTER_SCHEMA.properties.freckles.type, 'boolean');
  });

  it('keeps the photo media type, fixing image/jpg and mislabelled data URLs from the bytes', async () => {
    const { srv, client } = await withStub(() => textMessage(DEFAULT_CHARACTER));
    try {
      await postJSON(srv.port, '/api/avatar', { image: `data:image/jpg;base64,${JPEG_BASE64}` });
      assert.equal(client.calls[0].params.messages[0].content[0].source.media_type, 'image/jpeg');
      assert.equal(client.calls[0].params.messages[0].content[0].source.data, JPEG_BASE64);
      await postJSON(srv.port, '/api/avatar', { image: `data:image/jpeg;base64,${PNG_BASE64}` });
      assert.equal(client.calls[1].params.messages[0].content[0].source.media_type, 'image/png');
      const wrapped = `data:image/png;base64,${PNG_BASE64.slice(0, 20)}\n${PNG_BASE64.slice(20)}`;
      await postJSON(srv.port, '/api/avatar', { image: wrapped });
      assert.equal(client.calls[2].params.messages[0].content[0].source.data, PNG_BASE64, 'line breaks are stripped');
    } finally {
      await srv.close();
    }
  });

  it('400s on things that are not photos, without calling Claude', async () => {
    const { srv, client } = await withStub(() => textMessage(DEFAULT_CHARACTER));
    try {
      for (const image of [undefined, 42, '', 'hello', `data:text/plain;base64,${PNG_BASE64}`, 'data:image/png;base64,***', 'data:image/png;base64,AAAAAAAA', `https://example.com/me.png`]) {
        const res = await postJSON(srv.port, '/api/avatar', { image });
        assert.equal(res.status, 400, String(image));
        assertTerseError(res.json, 'bad_input');
      }
      assert.equal(client.calls.length, 0);
    } finally {
      await srv.close();
    }
  });

  it('turns refusals and unreadable output into friendly errors', async () => {
    const refused = await withStub(() => refusalMessage());
    try {
      const res = await postJSON(refused.srv.port, '/api/avatar', { image: PNG_DATA_URL });
      assert.equal(res.status, 422);
      assertTerseError(res.json, 'refused');
    } finally {
      await refused.srv.close();
    }
    const garbled = await withStub(() => textMessage('not json at all'));
    try {
      const res = await postJSON(garbled.srv.port, '/api/avatar', { image: PNG_DATA_URL });
      assert.equal(res.status, 502);
      assert.equal(res.json.retryable, true);
      assertTerseError(res.json, 'error');
    } finally {
      await garbled.srv.close();
    }
  });

  it('never logs the photo, even when the SDK fails', async () => {
    const { srv, logger } = await withStub(() => {
      throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Could not process image' } }, 'Could not process image', new Headers());
    });
    try {
      const res = await postJSON(srv.port, '/api/avatar', { image: PNG_DATA_URL });
      assert.equal(res.status, 502);
      assert.ok(logger.lines.length > 0, 'the failure is logged');
      assert.doesNotMatch(logger.text(), new RegExp(PNG_BASE64.slice(0, 24)));
      assert.doesNotMatch(logger.text(), /data:image/);
    } finally {
      await srv.close();
    }
  });
});

describe('grade: request shape and results', () => {
  const verdict = {
    criteria: explain.rubric.map((criterion, i) => ({ criterion, met: i !== 1, why: 'stub' })),
    pass: true,
    score: 0.67,
    feedback: 'Ribbit! So the big numbers make the softmax go stiff. Clever little human.',
  };

  it('sends the paper (cached), question, rubric and pass bar from the server copy of the region', async () => {
    const { srv, client } = await withStub(() => textMessage(verdict));
    try {
      const answer = 'Dividing by sqrt(d_k) keeps the softmax away from its flat, saturated regions.';
      const res = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer, rubric: ['INJECTED RUBRIC'], passBar: 'INJECTED BAR' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { pass: true, score: 0.67, feedback: verdict.feedback, offline: false });
      assert.equal(res.json.criteria, undefined, 'per-criterion verdicts stay on the server');

      const { params, timeout, maxRetries } = client.calls[0];
      assertCommon(params);
      assert.equal(timeout, AI_LIMITS.grade);
      assert.equal(maxRetries, AI_RETRIES.grade);
      assert.deepEqual(params.output_config, { effort: 'medium', format: { type: 'json_schema', schema: GRADE_SCHEMA } });
      const paper = params.system.find((b) => b.cache_control);
      assert.deepEqual(paper, { type: 'text', text: PAPER_TEXT, cache_control: PAPER_CACHE });
      assert.equal(params.system.filter((b) => b.cache_control).length, 1);
      const system = params.system.map((b) => b.text).join('\n');
      assert.ok(system.includes(explain.question));
      for (const r of explain.rubric) assert.ok(system.includes(r), `rubric criterion missing: ${r}`);
      assert.ok(system.includes(explain.passBar));
      assert.match(system, /Elder Moss/);
      assert.match(system, /frog/);
      assert.match(system, /never state the full answer/);
      assert.match(system, /1 or 2 short sentences, each under 90 characters/);
      assert.match(GRADE_SCHEMA.properties.feedback.description, /under 90 characters/);
      assert.doesNotMatch(JSON.stringify(params), /INJECTED/);
      assert.equal(params.messages.length, 1);
      assert.equal(params.messages[0].role, 'user');
      assert.ok(params.messages[0].content.includes(answer));
    } finally {
      await srv.close();
    }
  });

  it('defines the grading schema', () => {
    assert.deepEqual(GRADE_SCHEMA.required, ['criteria', 'pass', 'score', 'feedback']);
    assert.equal(GRADE_SCHEMA.additionalProperties, false);
    const item = GRADE_SCHEMA.properties.criteria.items;
    assert.deepEqual(item.required, ['criterion', 'met', 'why']);
    assert.equal(item.properties.met.type, 'boolean');
    assert.equal(item.additionalProperties, false);
    assert.equal(GRADE_SCHEMA.properties.pass.type, 'boolean');
    assert.equal(GRADE_SCHEMA.properties.score.type, 'number');
    assert.equal(GRADE_SCHEMA.properties.feedback.type, 'string');
  });

  it('clamps and repairs scores', async () => {
    const cases = [[7, 0.07], [150, 1], [-2, 0], ['abc', 2 / 3], [0.5, 0.5]];
    for (const [score, expected] of cases) {
      const { srv } = await withStub(() => textMessage({ ...verdict, score }));
      try {
        const res = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'something' });
        assert.equal(res.json.score, Math.round(expected * 100) / 100, `score ${score}`);
      } finally {
        await srv.close();
      }
    }
  });

  it('still grades from the rubric when the paper text is unavailable', async () => {
    const { srv, client } = await withStub(() => textMessage({ ...verdict, pass: false, score: 0.33 }), { papers: fakePapers({ fail: true }) });
    try {
      const res = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'something' });
      assert.deepEqual(res.json, { pass: false, score: 0.33, feedback: verdict.feedback, offline: false });
      const { params } = client.calls[0];
      assert.equal(params.system.some((b) => b.cache_control), false);
      assert.match(params.system.map((b) => b.text).join('\n'), /could not be loaded/);
    } finally {
      await srv.close();
    }
  });

  it('handles refusals before reading content', async () => {
    const { srv } = await withStub(() => refusalMessage());
    try {
      const res = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'something' });
      assert.equal(res.status, 422);
      assertTerseError(res.json, 'refused');
    } finally {
      await srv.close();
    }
  });
});

describe('SDK errors become short JSON errors', () => {
  const headers = () => new Headers({ 'request-id': 'req_stub' });
  const routes = [
    ['/api/book', { regionId: 'fixture', question: 'softmax?' }],
    ['/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'scaling and softmax' }],
    ['/api/avatar', { image: PNG_DATA_URL }],
  ];
  const cases = [
    ['RateLimitError', () => new Anthropic.RateLimitError(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', headers()), 429, 'busy', true],
    ['BadRequestError', () => new Anthropic.BadRequestError(400, { error: { type: 'invalid_request_error' } }, 'bad', headers()), 502, 'error', false],
    ['InternalServerError (overloaded)', () => new Anthropic.InternalServerError(529, { error: { type: 'overloaded_error' } }, 'overloaded', headers()), 503, 'busy', true],
    ['APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError(), 504, 'timeout', true],
    ['APIError (other)', () => Anthropic.APIError.generate(418, { error: { type: 'teapot' } }, 'teapot', headers()), 502, 'error', false],
    ['plain Error', () => new Error('kaboom'), 500, 'error', false],
  ];

  for (const [name, make, status, code, retryable] of cases) {
    it(`${name} -> ${status} ${code}`, async () => {
      const { srv, logger } = await withStub(() => { throw make(); });
      try {
        for (const [route, body] of routes) {
          const res = await postJSON(srv.port, route, body);
          assert.equal(res.status, status, `${route}`);
          assertTerseError(res.json, code);
          assert.equal(Boolean(res.json.retryable), retryable, `${route} retryable`);
          assert.equal(res.json.offline, undefined);
          assert.doesNotMatch(res.json.error, /rate_limit_error|authentication_error|overloaded_error|kaboom|req_stub/);
        }
        assert.match(logger.text(), /\[ai\] book failed/, 'the details go to the log');
      } finally {
        await srv.close();
      }
    });
  }

  // A key that is set but cannot be used (or no network): the book and the grader play on offline.
  const unusable = [
    ['AuthenticationError', () => new Anthropic.AuthenticationError(401, { error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', headers())],
    ['PermissionDeniedError', () => new Anthropic.PermissionDeniedError(403, { error: { type: 'permission_error' } }, 'nope', headers())],
    ['NotFoundError (model)', () => new Anthropic.NotFoundError(404, { error: { type: 'not_found_error' } }, 'model: claude-opus-5-5', headers())],
    ['billing (402)', () => Anthropic.APIError.generate(402, { error: { type: 'billing_error' } }, 'pay up', headers())],
    ['APIConnectionError', () => new Anthropic.APIConnectionError({ message: 'socket hang up' })],
  ];
  for (const [name, make] of unusable) {
    it(`${name} -> offline book and grading, avatar 503 { offline: true }`, async () => {
      const { srv, client, logger } = await withStub(() => { throw make(); });
      try {
        const book = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Why divide by sqrt(d_k)?' });
        assert.equal(book.status, 200);
        assert.deepEqual(book.json, { answer: FIXTURE.book.offlineHints[1].text, refused: false, offline: true });
        const pass = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'Scaling keeps the softmax away from tiny gradients.' });
        assert.equal(pass.status, 200);
        assert.deepEqual(pass.json, { pass: true, score: 1, feedback: pass.json.feedback, offline: true });
        const fail = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'It is nicer.' });
        assert.deepEqual(fail.json, { pass: false, score: 0, feedback: explain.retry[0], offline: true });
        const avatar = await postJSON(srv.port, '/api/avatar', { image: PNG_DATA_URL });
        assert.equal(avatar.status, 503);
        assert.equal(avatar.json.offline, true);
        assertTerseError(avatar.json, 'offline');
        assert.equal(client.calls.length, 4, 'Claude was tried each time');
        assert.match(logger.text(), /\[ai\] book failed: .*answering offline/);
      } finally {
        await srv.close();
      }
    });
  }

  it('maps errors with the typed SDK classes', () => {
    const mapped = toAIError(new Anthropic.RateLimitError(429, {}, 'x', new Headers()));
    assert.ok(mapped instanceof AIError);
    assert.equal(mapped.status, 429);
    assert.equal(mapped.code, 'busy');
    assert.equal(toAIError(new Anthropic.APIUserAbortError()).status, 499);
    assert.equal(toAIError(new Anthropic.AuthenticationError(401, {}, 'x', new Headers())).offline, true);
    assert.equal(toAIError(new Anthropic.APIConnectionTimeoutError()).offline, false, 'a timeout is not "offline"');
  });
});

describe('one deadline per Claude call', () => {
  // Never answers; rejects like the SDK once its signal aborts.
  const hanging = () => {
    const calls = [];
    return {
      calls,
      beta: {
        messages: {
          create: (params, options) => new Promise((_, reject) => {
            calls.push(options);
            options.signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()));
          }),
        },
      },
    };
  };

  it('answers 504 { code: "timeout" } when the deadline passes (not a silent 499)', async () => {
    const client = hanging();
    const logger = recordingLogger();
    const srv = await startTestServer({ ai: createAI({ client, logger, timeouts: { book: 80, grade: 80, avatar: 80 } }), logger });
    try {
      for (const [route, body] of [
        ['/api/book', { regionId: 'fixture', question: 'softmax?' }],
        ['/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'scaling' }],
        ['/api/avatar', { image: PNG_DATA_URL }],
      ]) {
        const started = Date.now();
        const res = await postJSON(srv.port, route, body);
        assert.equal(res.status, 504, route);
        assertTerseError(res.json, 'timeout');
        assert.equal(res.json.retryable, true);
        assert.ok(Date.now() - started < 2000, `${route} took ${Date.now() - started}ms`);
      }
      assert.deepEqual(client.calls.map((o) => o.maxRetries), [0, 1, 1]);
      assert.deepEqual(client.calls.map((o) => o.timeout), [80, 80, 80]);
      assert.match(logger.text(), /\[ai\] book failed: no answer within 80ms/);
    } finally {
      await srv.close();
    }
  });

  it('bounds the real SDK too: a 429 with a long retry-after fails fast on the book', async () => {
    let hits = 0;
    const api = http.createServer((req, res) => {
      hits += 1;
      req.resume();
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '20' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }));
    });
    await new Promise((r) => api.listen(0, '127.0.0.1', r));
    const client = new Anthropic({ apiKey: 'sk-ant-test', baseURL: `http://127.0.0.1:${api.address().port}`, maxRetries: 1 });
    const logger = recordingLogger();
    const srv = await startTestServer({ ai: createAI({ client, logger, timeouts: { grade: 300 } }), logger });
    try {
      let started = Date.now();
      const book = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'softmax?' });
      assert.equal(book.status, 429);
      assertTerseError(book.json, 'busy');
      assert.equal(hits, 1, 'no retry for the book');
      assert.ok(Date.now() - started < 2000, `book took ${Date.now() - started}ms`);
      started = Date.now();
      const grade = await postJSON(srv.port, '/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'scaling' });
      assert.equal(grade.status, 504, 'the deadline cuts the 20 s retry-after wait');
      assert.ok(Date.now() - started < 2000, `grade took ${Date.now() - started}ms`);
    } finally {
      await srv.close();
      await new Promise((r) => { api.closeAllConnections?.(); api.close(r); });
    }
  });
});

describe('createAI', () => {
  it('only creates a client when ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set', () => {
    assert.equal(createAI({ env: {} }).enabled, false);
    assert.equal(createAI({ env: { ANTHROPIC_API_KEY: '' } }).enabled, false);
    assert.equal(createAI({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' } }).enabled, true);
    assert.equal(createAI({ env: { ANTHROPIC_AUTH_TOKEN: 'token' } }).enabled, true);
    assert.equal(createAI({ env: {} }).model, 'claude-opus-5-5');
  });

  it('works offline when called directly', async () => {
    const ai = createAI({ env: {} });
    await assert.rejects(ai.avatar({ image: PNG_DATA_URL }), (err) => err instanceof AIError && err.status === 503 && err.offline === true);
    const graded = await ai.grade({ region: FIXTURE, challenge: explain, answer: 'scale the softmax' });
    assert.deepEqual(graded, { pass: true, score: 1, feedback: graded.feedback, offline: true });
    const answered = await ai.book({ region: FIXTURE, paperText: PAPER_TEXT, question: 'heads?' });
    assert.equal(answered.offline, true);
  });
});

describe('helpers', () => {
  it('normalizeCharacter fills every gap with defaults', () => {
    assert.deepEqual(normalizeCharacter(null), DEFAULT_CHARACTER);
    assert.deepEqual(normalizeCharacter('nope'), DEFAULT_CHARACTER);
    assert.deepEqual(normalizeCharacter([1, 2]), DEFAULT_CHARACTER);
    assert.deepEqual(normalizeCharacter({ hairStyle: 'BALD ', freckles: 1, skin: '#GGGGGG' }), { ...DEFAULT_CHARACTER, hairStyle: 'bald' });
  });

  it('parseImageDataUrl sniffs real image bytes', () => {
    assert.deepEqual(parseImageDataUrl(PNG_DATA_URL), { mediaType: 'image/png', data: PNG_BASE64, byteLength: Buffer.from(PNG_BASE64, 'base64').length });
    assert.equal(parseImageDataUrl('data:image/png;base64,R0lGODlhAQABAAAAACw=').mediaType, 'image/gif');
    assert.equal(parseImageDataUrl(`data:image/webp;base64,${Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ').toString('base64')}`).mediaType, 'image/webp');
    assert.equal(parseImageDataUrl('data:image/png;base64,'), null);
  });

  it('offline hints accept keywords given as a single string', () => {
    const region = { book: { offlineHints: [{ keywords: 'softmax', text: 'S' }, { keywords: ['heads'], text: 'H' }, { text: 'no keywords' }, null] } };
    assert.equal(offlineBookAnswer(region, 'What is a SOFTMAX?').answer, 'S');
    assert.equal(offlineBookAnswer(region, 'so many heads').answer, 'H');
    assert.equal(offlineBookAnswer({}, 'anything').offline, true);
  });

  it('offlineGrade accepts any real attempt when no keyword groups exist', () => {
    const challenge = { ...explain, offline: [] };
    assert.equal(offlineGrade(FIXTURE, challenge, 'too short').pass, false);
    assert.equal(offlineGrade(FIXTURE, challenge, 'this is a long enough answer with at least twelve different words in it').pass, true);
  });
});
