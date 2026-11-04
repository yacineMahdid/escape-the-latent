// Claude paths with an injected stub client: exact request shapes, refusals, parsing, error mapping.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

import {
  startTestServer, postJSON, stubClient, textMessage, refusalMessage, recordingLogger, fakePapers,
  FIXTURE, PAPER_TEXT, PNG_BASE64, PNG_DATA_URL, JPEG_BASE64,
} from './helpers.mjs';
import {
  createAI, MODEL, BETAS, BOOK_SCHEMA, CHARACTER_SCHEMA, GRADE_SCHEMA, CHARACTER_ENUMS, DEFAULT_CHARACTER,
  normalizeCharacter, parseImageDataUrl, offlineGrade, offlineBookAnswer, toAIError, AIError,
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

    const { params, timeout, hasSignal } = ctx.client.calls.at(-1);
    assertCommon(params);
    assert.equal(params.max_tokens, 1200);
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
    assert.match(persona.text, /1 to 3 terse sentences/);
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
    assert.equal(typeof timeout, 'number');
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
      assert.match(res.json.answer, /ink runs dry/);
    } finally {
      await srv.close();
    }
  });

  it('clips rambling answers', async () => {
    const { srv } = await withStub(() => textMessage({ answer: 'dark '.repeat(400), refused: false }));
    try {
      const res = await postJSON(srv.port, '/api/book', { regionId: 'fixture', question: 'Why?' });
      assert.ok(res.json.answer.length <= 701);
    } finally {
      await srv.close();
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
      assert.doesNotMatch(logger.text(), /\[ai\] book failed/);
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
        assert.equal(typeof res.json.error, 'string');
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
      assert.match(res.json.error, /another photo/);
    } finally {
      await refused.srv.close();
    }
    const garbled = await withStub(() => textMessage('not json at all'));
    try {
      const res = await postJSON(garbled.srv.port, '/api/avatar', { image: PNG_DATA_URL });
      assert.equal(res.status, 502);
      assert.equal(res.json.retryable, true);
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

      const { params } = client.calls[0];
      assertCommon(params);
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
      assert.match(res.json.error, /Elder Moss/);
    } finally {
      await srv.close();
    }
  });
});

describe('SDK errors become friendly JSON errors', () => {
  const headers = () => new Headers({ 'request-id': 'req_stub' });
  const cases = [
    ['RateLimitError', () => new Anthropic.RateLimitError(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', headers()), 429, true],
    ['AuthenticationError', () => new Anthropic.AuthenticationError(401, { error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', headers()), 503, false],
    ['PermissionDeniedError', () => new Anthropic.PermissionDeniedError(403, { error: { type: 'permission_error' } }, 'nope', headers()), 503, false],
    ['BadRequestError', () => new Anthropic.BadRequestError(400, { error: { type: 'invalid_request_error' } }, 'bad', headers()), 502, false],
    ['InternalServerError (overloaded)', () => new Anthropic.InternalServerError(529, { error: { type: 'overloaded_error' } }, 'overloaded', headers()), 503, true],
    ['APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError(), 504, true],
    ['APIConnectionError', () => new Anthropic.APIConnectionError({ message: 'socket hang up' }), 502, true],
    ['APIError (other)', () => Anthropic.APIError.generate(418, { error: { type: 'teapot' } }, 'teapot', headers()), 502, false],
    ['plain Error', () => new Error('kaboom'), 500, false],
  ];

  for (const [name, make, status, retryable] of cases) {
    it(`${name} -> ${status}`, async () => {
      const { srv } = await withStub(() => { throw make(); });
      try {
        for (const [route, body] of [
          ['/api/book', { regionId: 'fixture', question: 'softmax?' }],
          ['/api/grade', { regionId: 'fixture', challengeId: 'explain1', answer: 'scaling and softmax' }],
          ['/api/avatar', { image: PNG_DATA_URL }],
        ]) {
          const res = await postJSON(srv.port, route, body);
          assert.equal(res.status, status, `${route}`);
          assert.equal(typeof res.json.error, 'string');
          assert.equal(Boolean(res.json.retryable), retryable, `${route} retryable`);
          assert.doesNotMatch(res.json.error, /rate_limit_error|authentication_error|overloaded_error|kaboom|req_stub/);
        }
      } finally {
        await srv.close();
      }
    });
  }

  it('maps errors with the typed SDK classes', () => {
    const mapped = toAIError(new Anthropic.RateLimitError(429, {}, 'x', new Headers()), 'Pip');
    assert.ok(mapped instanceof AIError);
    assert.equal(mapped.status, 429);
    assert.match(mapped.message, /^Pip /);
    assert.equal(toAIError(new Anthropic.APIUserAbortError()).status, 499);
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
