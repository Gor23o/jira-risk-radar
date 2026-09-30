// Entry point. Parses flags and runs the pipeline; business logic lives in the modules.

import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.js';
import { JiraError } from './jira/client.js';
import { fetchIssues } from './jira/index.js';
import { runRadar } from './pipeline.js';
import { levelCountsText } from './report/summarize.js';

const HELP = `Usage: npm run radar -- [options]

Options:
  --config <path>          Config file (default: config.json)
  --jql <query>            Override the JQL from config, e.g. "sprint in openSprints()"
  --reference-date <date>  Evaluate "as of" this date, YYYY-MM-DD (default: today)
  --no-ai                  Rules only; skip the Claude assessment
  --demo-aging             Simulate the waiting period for seeded "stuck" demo issues
                           (always on while config seed.demoAging is true)
  --json                   Print the full report as JSON (used by the GitHub workflow)
  --dump                   Print the normalized issues as JSON and stop
  -h, --help               Show this help`;

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: 'config.json' },
      jql: { type: 'string' },
      'reference-date': { type: 'string' },
      'no-ai': { type: 'boolean', default: false },
      'demo-aging': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      dump: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return values;
}

const LEVEL_LABEL = { critical: 'CRITICAL', at_risk: 'AT RISK', ok: 'ok' };

/** Plain-text report; the HTML report replaces this in phase 5. */
function printReport(report) {
  console.log(`\nRisk Radar as of ${report.referenceDate} (${report.timezone}): ${levelCountsText(report.summary)} · Claude: ${report.ai}\n`);
  for (const { issue, level, flags, escalated, ai } of report.results) {
    const summary = issue.summary.length > 44 ? `${issue.summary.slice(0, 43)}…` : issue.summary;
    const why = flags.length ? flags.map((f) => f.rule).join(', ') + (escalated ? ' → escalated' : '') : '';
    console.log(`${LEVEL_LABEL[level].padEnd(9)} ${issue.key.padEnd(9)} ${issue.status.name.padEnd(13)} ${summary.padEnd(45)} ${why}`);
    for (const f of flags) console.log(`${' '.repeat(33)}↳ ${f.evidence}`);
    if (ai?.status === 'ok' && level !== 'ok') console.log(`${' '.repeat(33)}↳ Claude: ${ai.reason} Next: ${ai.suggested_action}`);
    if (ai?.status === 'unavailable') console.log(`${' '.repeat(33)}↳ Claude unavailable: ${ai.reason}`);
  }
  console.log('\nBy assignee:');
  for (const p of report.summary.byAssignee) {
    console.log(`  ${p.name.padEnd(20)} ${p.critical} critical, ${p.at_risk} at risk, ${p.ok} ok`);
  }
}

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${HELP}`);
    process.exit(2);
  }

  if (args.help) {
    console.log(HELP);
    return;
  }

  dotenv.config({ quiet: true });
  const config = await loadConfig(args.config, {
    overrides: { referenceDate: args['reference-date'], jql: args.jql, noAi: args['no-ai'] },
  });

  // Progress and warnings go to stderr so --json / --dump output stays clean.
  console.error(`Searching Jira: ${config.jql}`);

  if (args.dump) {
    const { issues, warnings } = await fetchIssues(config);
    for (const warning of warnings) console.error(`Warning: ${warning}`);
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  const report = await runRadar(config, { demoAging: args['demo-aging'] || config.seed.demoAging });
  for (const warning of report.warnings) console.error(`Warning: ${warning}`);
  console.error(`Found ${report.summary.total} issue(s).`);
  if (report.aiUsage) {
    const { calls, issues, inputTokens, outputTokens, costUsd } = report.aiUsage;
    const cost = costUsd == null ? '' : `, about $${costUsd.toFixed(3)}`;
    console.error(`Claude (${report.aiModel}): ${issues} open issue(s) in ${calls} call(s), ${inputTokens} in / ${outputTokens} out tokens${cost}. Status: ${report.ai}.`);
  }
  if (report.demoAging.applied) {
    const { aged } = report.demoAging;
    console.error(`Demo aging: simulated the waiting period for ${aged.length} seeded issue(s)${aged.length ? ` (${aged.join(', ')})` : ''}.`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}

main().catch((err) => {
  if (err instanceof ConfigError || err instanceof JiraError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
