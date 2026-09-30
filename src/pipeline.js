// fetch → normalize → (demo aging) → rules → merge → summary.
// One function so the CLI table, the JSON report, the CI summary and the email
// always describe the same run. Claude (phase 4) plugs in between rules and merge.

import { fetchIssues } from './jira/index.js';
import { assessIssue, sortResults } from './merge/merge.js';
import { summarize } from './report/summarize.js';
import { runRules } from './rules/index.js';
import { applyDemoAging } from './seed/aging.js';

/**
 * @param {object} config - resolved config
 * @param {{demoAging?: boolean, fetch?: typeof fetchIssues, scenarios?: object[]}} [options]
 *   demoAging defaults to config.seed.demoAging; fetch/scenarios are injectable for tests
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

  const results = sortResults(
    issues.map((issue) => ({ issue, ...assessIssue(runRules(issue, config), null, config) })),
  );

  return {
    referenceDate: config.referenceDate,
    timezone: config.timezone,
    jql: config.jql,
    ai: 'off', // phase 4: 'on' | 'partial' | 'off'
    demoAging: { applied: demoAging, aged },
    warnings,
    summary: summarize(results),
    results,
  };
}
