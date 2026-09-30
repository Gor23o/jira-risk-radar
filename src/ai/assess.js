// Sends issues to Claude in batches and turns the answers into per-issue
// assessments the severity model understands.
//
// Failure policy (CLAUDE.md → "Claude API notes"): no fallback model. Anything that
// goes wrong with a batch (API error after the SDK's retries, refusal, output cut off,
// output that doesn't fit the schema, an issue missing from the answer) marks those
// issues `{status: 'unavailable', reason}`. The run always continues on rule flags.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { BatchAssessment } from './schema.js';

// USD per million tokens, for the cost line in reports. Estimate only; unknown models show no cost.
const PRICING = { 'claude-sonnet-5-5': { input: 2, output: 10 } };
const PARALLEL_BATCHES = 3;

/** Human-readable reason for a failed call, pointing at the fix where there is one. */
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API authentication failed: check ANTHROPIC_API_KEY';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Claude API key is not allowed to use this model';
  if (err instanceof Anthropic.NotFoundError) return 'Claude model not found: check claude.model in config.json';
  if (err instanceof Anthropic.RateLimitError) return 'Claude API rate limit reached (after retries)';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}`.trim();
  if (err instanceof Anthropic.AnthropicError) return 'Claude returned output that did not match the expected format';
  return `Claude assessment failed: ${err.message}`;
}

/** Claude's findings as Flags, shaped like rule flags so the severity model treats them alike. */
function toFlags(assessment, config) {
  const flags = [];
  if (assessment.blocked_in_comments.blocked) {
    const quote = assessment.blocked_in_comments.quote.trim();
    flags.push({
      rule: 'blockedInComments',
      source: 'ai',
      severity: config.severity.rules.blockedInComments,
      message: 'Blocker mentioned in comments',
      evidence: quote ? `"${quote}"` : 'A comment says the work is blocked',
    });
  }
  if (assessment.vague.vague) {
    flags.push({
      rule: 'vague',
      source: 'ai',
      severity: config.severity.rules.vague,
      message: 'Vague: no clear acceptance criteria',
      evidence: assessment.vague.why.trim() || 'No acceptance criteria or concrete goal',
    });
  }
  return flags;
}

async function assessBatch(client, batch, config) {
  const unavailable = (reason) => new Map(batch.map(({ issue }) => [issue.key, { status: 'unavailable', reason }]));
  let response;
  try {
    response = await client.messages.parse({
      model: config.claude.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(batch, config.referenceDate) }],
      output_config: { effort: config.claude.effort, format: zodOutputFormat(BatchAssessment) },
    });
  } catch (err) {
    return { results: unavailable(describeError(err)), usage: null };
  }

  const usage = response.usage;
  if (response.stop_reason === 'refusal') return { results: unavailable('Claude declined to assess this batch'), usage };
  if (response.stop_reason === 'max_tokens') return { results: unavailable('Claude’s answer was cut off (max_tokens)'), usage };
  if (!response.parsed_output) return { results: unavailable('Claude returned no usable answer'), usage };

  const answers = new Map(response.parsed_output.assessments.map((a) => [a.key, a]));
  const results = new Map();
  for (const { issue } of batch) {
    const a = answers.get(issue.key); // matched by key, never by position
    results.set(
      issue.key,
      a
        ? { status: 'ok', risk_level: a.risk_level, reason: a.reason, suggested_action: a.suggested_action, flags: toFlags(a, config) }
        : { status: 'unavailable', reason: 'Missing from Claude’s answer' },
    );
  }
  return { results, usage };
}

/**
 * @param {{issue: object, flags: object[]}[]} items - open issues with their rule flags
 * @param {object} config
 * @param {{client?: object}} [deps] - inject a fake client in tests; default reads ANTHROPIC_API_KEY
 * @returns {Promise<{byKey: Map<string, object>, usage: {inputTokens: number, outputTokens: number, costUsd: number|null}, calls: number}>}
 */
export async function assessWithClaude(items, config, deps = {}) {
  const byKey = new Map();
  const totals = { inputTokens: 0, outputTokens: 0 };
  if (!items.length) return { byKey, usage: { ...totals, costUsd: 0 }, calls: 0 };

  if (!deps.client && !process.env.ANTHROPIC_API_KEY?.trim()) {
    for (const { issue } of items) byKey.set(issue.key, { status: 'unavailable', reason: 'ANTHROPIC_API_KEY is not set' });
    return { byKey, usage: { ...totals, costUsd: 0 }, calls: 0 };
  }
  const client = deps.client ?? new Anthropic();

  const batches = [];
  for (let i = 0; i < items.length; i += config.claude.batchSize) batches.push(items.slice(i, i + config.claude.batchSize));

  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    const outcomes = await Promise.all(batches.slice(i, i + PARALLEL_BATCHES).map((b) => assessBatch(client, b, config)));
    for (const { results, usage } of outcomes) {
      for (const [key, value] of results) byKey.set(key, value);
      totals.inputTokens += usage?.input_tokens ?? 0;
      totals.outputTokens += usage?.output_tokens ?? 0;
    }
  }

  const price = PRICING[config.claude.model];
  const costUsd = price ? (totals.inputTokens * price.input + totals.outputTokens * price.output) / 1e6 : null;
  return { byKey, usage: { ...totals, costUsd }, calls: batches.length };
}
