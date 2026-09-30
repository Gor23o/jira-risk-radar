// Entry point. Parses flags and runs the pipeline; business logic lives in the modules.

import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.js';
import { fetchIssues } from './jira/index.js';
import { JiraError } from './jira/client.js';

const HELP = `Usage: npm run radar -- [options]

Options:
  --config <path>          Config file (default: config.json)
  --jql <query>            Override the JQL from config, e.g. "sprint in openSprints()"
  --reference-date <date>  Evaluate "as of" this date, YYYY-MM-DD (default: today)
  --no-ai                  Rules only; skip the Claude assessment
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
      dump: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return values;
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
  const { issues, warnings } = await fetchIssues(config);
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  console.error(`Found ${issues.length} issue(s).`);

  if (args.dump) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  console.log(`Fetched ${issues.length} issue(s) as of ${config.referenceDate} (${config.timezone}).`);
  console.log('Risk rules arrive in phase 3. Use --dump to see the normalized issues.');
}

main().catch((err) => {
  if (err instanceof ConfigError || err instanceof JiraError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
