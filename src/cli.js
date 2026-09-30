// Entry point. Parses flags and runs the pipeline; business logic lives in the modules.

import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.js';
import { fetchIssues } from './jira/index.js';
import { JiraError } from './jira/client.js';
import { runRules } from './rules/index.js';
import { applyDemoAging } from './seed/aging.js';

const HELP = `Usage: npm run radar -- [options]

Options:
  --config <path>          Config file (default: config.json)
  --jql <query>            Override the JQL from config, e.g. "sprint in openSprints()"
  --reference-date <date>  Evaluate "as of" this date, YYYY-MM-DD (default: today)
  --no-ai                  Rules only; skip the Claude assessment
  --demo-aging             Simulate the waiting period for seeded "stuck" demo issues
                           (seed-demo label only; see README → Demo runbook)
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
      dump: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return values;
}

const LEVEL_ORDER = { critical: 2, at_risk: 1, ok: 0 };

/** Plain-text table of rule flags; the HTML report replaces this in phase 5. */
function printRulesTable(results) {
  const worst = (flags) => Math.max(-1, ...flags.map((f) => LEVEL_ORDER[f.severity]));
  const sortedResults = [...results].sort((a, b) => worst(b.flags) - worst(a.flags) || b.flags.length - a.flags.length);
  for (const { issue, flags } of sortedResults) {
    const summary = issue.summary.length > 44 ? `${issue.summary.slice(0, 43)}…` : issue.summary;
    const labels = flags.length ? flags.map((f) => `${f.rule} (${f.severity})`).join(', ') : '—';
    console.log(`${issue.key.padEnd(9)} ${issue.status.name.padEnd(13)} ${summary.padEnd(45)} ${labels}`);
    for (const f of flags) console.log(`${' '.repeat(24)}↳ ${f.evidence}`);
  }
  const flagged = results.filter((r) => r.flags.length).length;
  console.log(`\n${flagged} of ${results.length} issue(s) have rule flags.`);
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

  // Progress and warnings go to stderr so `--dump > issues.json` stays clean JSON.
  console.error(`Searching Jira: ${config.jql}`);
  let { issues, warnings } = await fetchIssues(config);
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  console.error(`Found ${issues.length} issue(s).`);

  if (args['demo-aging']) {
    const { scenarios } = await import('../scripts/seed-data.js');
    const result = applyDemoAging(issues, { scenarios, config });
    issues = result.issues;
    console.error(`Demo aging: simulated the waiting period for ${result.aged.length} seeded issue(s)${result.aged.length ? ` (${result.aged.join(', ')})` : ''}.`);
  }

  if (args.dump) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  console.log(`\nRisk flags as of ${config.referenceDate} (${config.timezone}), rules only:\n`);
  printRulesTable(issues.map((issue) => ({ issue, flags: runRules(issue, config) })));
  console.log('Claude assessment arrives in phase 4, the combined report in phase 5.');
}

main().catch((err) => {
  if (err instanceof ConfigError || err instanceof JiraError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
