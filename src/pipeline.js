// fetch → normalize → (demo aging) → rules → Claude → merge → summary.
// One function so the CLI table, the JSON report, the CI summary and the email
// always describe the same run.

import { assessWithClaude } from './ai/assess.js';
import { fetchIssues } from './jira/index.js';
import { assessIssue, sortResults } from './merge/merge.js';
import { summarize } from './report/summarize.js';
import { runRules } from './rules/index.js';
import { effectiveCategory } from './rules/statusHistory.js';
import { applyDemoAging } from './seed/aging.js';

/** 'on' | 'partial' | 'unavailable' | 'off', for the report header. */
function aiStatus(enabled, assessments) {
  if (!enabled) return 'off';
  const values = [...assessments.values()];
  const ok = values.filter((a) => a.status === 'ok').length;
  if (!values.length || ok === values.length) return 'on';
  return ok ? 'partial' : 'unavailable';
}

/**
 * @param {object} config - resolved config
 * @param {object} [options]
 * @param {boolean} [options.demoAging] - defaults to config.seed.demoAging
 * @param {typeof fetchIssues} [options.fetch] - injectable for tests
 * @param {object[]} [options.scenarios] - injectable for tests
 * @param {typeof assessWithClaude} [options.assess] - injectable for tests
 * @returns {Promise<object>} the report: everything the outputs need, and nothing else
 */
export async function runRadar(config, options = {}) {
  const demoAging = options.demoAging ?? config.seed.demoAging;
  const { issues: fetched, warnings } = await (options.fetch ?? fetchIssues)(config);

  let issues = fetched;
  let aged = [];
  if (demoAging) {
    const scenarios = options.scenarios ?? (await import('../scripts/seed-data.js')).scenarios;
    ({ issues, aged } = applyDemoAging(fetched, { scenarios, config }));
  }

  const withRules = issues.map((issue) => ({ issue, flags: runRules(issue, config) }));

  // Claude only sees open work: finished issues carry no delivery risk and cost money to send.
  let assessments = new Map();
  let aiUsage = null;
  if (config.claude.enabled) {
    const open = withRules.filter(({ issue }) => effectiveCategory(issue, config) !== 'done');
    const result = await (options.assess ?? assessWithClaude)(open, config);
    assessments = result.byKey;
    aiUsage = { ...result.usage, calls: result.calls, issues: open.length };
    const reasons = [...new Set([...assessments.values()].filter((a) => a.status !== 'ok').map((a) => a.reason))];
    for (const reason of reasons) warnings.push(`Claude assessment unavailable for some issues: ${reason}`);
  }

  const results = sortResults(
    withRules.map(({ issue, flags }) => ({ issue, ...assessIssue(flags, assessments.get(issue.key) ?? null, config) })),
  );

  return {
    referenceDate: config.referenceDate,
    timezone: config.timezone,
    jql: config.jql,
    ai: aiStatus(config.claude.enabled, assessments),
    aiModel: config.claude.enabled ? config.claude.model : null,
    aiUsage,
    demoAging: { applied: demoAging, aged },
    warnings,
    summary: summarize(results),
    results,
  };
}
