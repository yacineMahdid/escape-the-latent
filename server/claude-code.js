// A stand-in for the Anthropic SDK client that answers through the local Claude Code CLI (`claude -p`),
// so the game can use your Claude login instead of an API key. Turn it on with USE_CLAUDE_CODE=1
// (npm run start:claude). It implements only what ai.js uses: client.beta.messages.create(params, opts),
// and returns a message shaped like the API's (text content + stop_reason).
//
// Differences from the API: no prompt caching control, no max_tokens, no retries, and each call starts a
// fresh CLI process (a few seconds of overhead). Earlier book exchanges are folded into the last user
// message, since the CLI takes only user turns as input.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const textOfContent = (content) => (typeof content === 'string'
  ? content
  : (Array.isArray(content) ? content : []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n'));

function systemText(system) {
  if (typeof system === 'string') return system;
  return (Array.isArray(system) ? system : []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n\n');
}

// The API's content blocks, minus fields the CLI does not take (cache_control).
function blocksOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (Array.isArray(content) ? content : []).map(({ cache_control, ...b }) => b);
}

// All messages become one user turn: earlier turns as a transcript, then the last user message's blocks.
export function toUserMessage(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  const earlier = list.slice(0, -1);
  const blocks = blocksOf(last?.content ?? '');
  if (earlier.length) {
    const transcript = earlier
      .map((m) => `<${m.role === 'assistant' ? 'you_said' : 'reader_said'}>\n${textOfContent(m.content)}\n</${m.role === 'assistant' ? 'you_said' : 'reader_said'}>`)
      .join('\n');
    blocks.unshift({ type: 'text', text: `Earlier in this conversation:\n${transcript}\n\nNow:` });
  }
  return { type: 'user', message: { role: 'user', content: blocks } };
}

export function createClaudeCodeClient({ bin = 'claude', logger = console } = {}) {
  async function create(params, { signal } = {}) {
    if (signal?.aborted) throw new Anthropic.APIUserAbortError();
    const dir = await mkdtemp(join(tmpdir(), 'escape-the-latent-'));
    try {
      const systemFile = join(dir, 'system.txt');
      await writeFile(systemFile, systemText(params.system));
      const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--system-prompt-file', systemFile,
        '--tools', '',
        '--strict-mcp-config',
        '--setting-sources', '',
        '--no-session-persistence',
      ];
      if (params.model) args.push('--model', params.model);
      const effort = params.output_config?.effort;
      if (effort) args.push('--effort', effort);
      const schema = params.output_config?.format?.type === 'json_schema' ? params.output_config.format.schema : null;
      if (schema) args.push('--json-schema', JSON.stringify(schema));

      const result = await run(bin, args, JSON.stringify(toUserMessage(params.messages)) + '\n', { cwd: dir, signal });
      if (result.is_error || result.subtype !== 'success') {
        const why = String(result.result || result.api_error_status || result.subtype || 'unknown error').slice(0, 300);
        logger.error?.(`[claude-code] call failed: ${why}`);
        throw new Anthropic.APIConnectionError({ message: `Claude Code: ${why}` });
      }
      const text = result.structured_output != null ? JSON.stringify(result.structured_output) : String(result.result ?? '');
      return {
        type: 'message',
        role: 'assistant',
        model: params.model,
        content: [{ type: 'text', text }],
        stop_reason: result.stop_reason === 'refusal' ? 'refusal' : 'end_turn',
      };
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { beta: { messages: { create } }, viaClaudeCode: true };
}

// Runs the CLI and resolves with its final "result" event.
function run(bin, args, input, { cwd, signal }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Anthropic.APIConnectionError({ message: `Could not start ${bin}`, cause: err }));
      return;
    }
    let out = '';
    let err = '';
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Anthropic.APIConnectionError({ message: `Could not start ${bin} (is Claude Code installed?)`, cause: e }));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (aborted) return reject(new Anthropic.APIUserAbortError());
      const result = out.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((e) => e?.type === 'result').pop();
      if (result) return resolve(result);
      reject(new Anthropic.APIConnectionError({ message: `${bin} exited ${code}: ${(err || out).trim().slice(0, 300)}` }));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
