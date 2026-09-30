import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessWithClaude, describeError } from '../../src/ai/assess.js';
import { parseConfig } from '../../src/config.js';
import { makeIssue } from '../helpers/makeIssue.js';

const raw = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));
const config = parseConfig(raw, { overrides: { referenceDate: '2026-10-01' }, systemTimezone: 'UTC' });
const items = (n) => Array.from({ length: n }, (_, i) => ({ issue: makeIssue({ key: `SCRUM-${i + 1}` }), flags: [] }));

const answer = (key, extra = {}) => ({
  key,
  risk_level: 'ok',
  reason: 'On track.',
  suggested_action: 'None',
  blocked_in_comments: { blocked: false, quote: '' },
  vague: { vague: false, why: '' },
  ...extra,
});

/** Fake SDK client: each call gets the next scripted response (or error). */
function fakeClient(...responses) {
  const calls = [];
  return {
    calls,
    messages: {
      parse: async (params) => {
        calls.push(params);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(params) : next;
      },
    },
  };
}
const ok = (assessments, usage = { input_tokens: 1000, output_tokens: 200 }) => ({
  stop_reason: 'end_turn',
  parsed_output: { assessments },
  usage,
});
/** Answers every issue in the request, keys pulled from the prompt. */
const answerAll = (params) => ok([...params.messages[0].content.matchAll(/<issue key="([^"]+)">/g)].map((m) => answer(m[1])));

describe('assessWithClaude', () => {
  it('sends the configured model, effort, system prompt and a structured-output format', async () => {
    const client = fakeClient(ok([answer('SCRUM-1')]));
    await assessWithClaude(items(1), config, { client });
    const params = client.calls[0];
    expect(params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16000, output_config: { effort: 'low' } });
    expect(params.output_config.format).toBeDefined();
    expect(params.system).toContain('assess delivery risk');
  });

  it('turns Claude findings into flags with severities from config', async () => {
    const client = fakeClient(
      ok([
        answer('SCRUM-1', { risk_level: 'at_risk', blocked_in_comments: { blocked: true, quote: 'waiting on sandbox keys' } }),
        answer('SCRUM-2', { vague: { vague: true, why: 'No acceptance criteria.' } }),
      ]),
    );
    const { byKey } = await assessWithClaude(items(2), config, { client });
    expect(byKey.get('SCRUM-1')).toMatchObject({
      status: 'ok',
      risk_level: 'at_risk',
      flags: [{ rule: 'blockedInComments', source: 'ai', severity: 'at_risk', evidence: '"waiting on sandbox keys"' }],
    });
    expect(byKey.get('SCRUM-2').flags).toEqual([
      { rule: 'vague', source: 'ai', severity: 'at_risk', message: 'Vague: no clear acceptance criteria', evidence: 'No acceptance criteria.' },
    ]);
  });

  it('matches answers by key, not position, and marks missing issues unavailable', async () => {
    const client = fakeClient(ok([answer('SCRUM-2', { reason: 'second' }), answer('SCRUM-99')]));
    const { byKey } = await assessWithClaude(items(2), config, { client });
    expect(byKey.get('SCRUM-2').reason).toBe('second');
    expect(byKey.get('SCRUM-1')).toEqual({ status: 'unavailable', reason: 'Missing from Claude’s answer' });
    expect(byKey.has('SCRUM-99')).toBe(false);
  });

  it('splits work into batches of claude.batchSize', async () => {
    const client = fakeClient(answerAll, answerAll, answerAll);
    const { byKey, calls } = await assessWithClaude(items(23), config, { client });
    expect(calls).toBe(3);
    expect(client.calls.map((c) => c.messages[0].content.match(/<issue /g).length)).toEqual([10, 10, 3]);
    expect([...byKey.values()].every((a) => a.status === 'ok')).toBe(true);
  });

  it.each([
    ['a refusal', { stop_reason: 'refusal', parsed_output: null, usage: {} }, 'Claude declined to assess this batch'],
    ['a cut-off answer', { stop_reason: 'max_tokens', parsed_output: null, usage: {} }, 'Claude’s answer was cut off (max_tokens)'],
    ['no parsed output', { stop_reason: 'end_turn', parsed_output: null, usage: {} }, 'Claude returned no usable answer'],
    ['output not matching the schema', new Anthropic.AnthropicError('Failed to parse structured output'), 'Claude returned output that did not match the expected format'],
  ])('marks the whole batch unavailable on %s', async (_, response, reason) => {
    const { byKey } = await assessWithClaude(items(2), config, { client: fakeClient(response) });
    expect([...byKey.values()]).toEqual([
      { status: 'unavailable', reason },
      { status: 'unavailable', reason },
    ]);
  });

  it('keeps other batches when one fails', async () => {
    const client = fakeClient(new Error('boom'), answerAll);
    const { byKey } = await assessWithClaude(items(12), config, { client });
    expect(byKey.get('SCRUM-1').status).toBe('unavailable');
    expect(byKey.get('SCRUM-11').status).toBe('ok');
  });

  it('adds up token usage and estimates cost', async () => {
    const client = fakeClient(answerAll, answerAll);
    const { usage } = await assessWithClaude(items(15), config, { client });
    expect(usage).toEqual({ inputTokens: 2000, outputTokens: 400, costUsd: (2000 * 2 + 400 * 10) / 1e6 });
  });

  it('marks everything unavailable without calling anything when the API key is missing', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { byKey, calls } = await assessWithClaude(items(2), config);
      expect(calls).toBe(0);
      expect(byKey.get('SCRUM-1')).toEqual({ status: 'unavailable', reason: 'ANTHROPIC_API_KEY is not set' });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('makes no call for an empty list', async () => {
    const client = fakeClient();
    expect(await assessWithClaude([], config, { client })).toMatchObject({ calls: 0 });
    expect(client.calls).toHaveLength(0);
  });
});

describe('describeError', () => {
  it('points at the fix for common API errors', () => {
    const err = (Cls, status) => Object.assign(Object.create(Cls.prototype), { status, message: 'x' });
    expect(describeError(err(Anthropic.AuthenticationError, 401))).toContain('check ANTHROPIC_API_KEY');
    expect(describeError(err(Anthropic.NotFoundError, 404))).toContain('check claude.model');
    expect(describeError(err(Anthropic.APIConnectionError))).toBe('Could not reach the Claude API');
    expect(describeError(err(Anthropic.InternalServerError, 500))).toBe('Claude API error 500');
    expect(describeError(new Error('weird'))).toBe('Claude assessment failed: weird');
  });
});
