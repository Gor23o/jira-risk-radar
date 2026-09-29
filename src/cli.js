// Entry point. Parses flags and runs the pipeline; business logic lives in the modules.

import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.js';

const HELP = `Usage: npm run radar -- [options]

Options:
  --config <path>          Config file (default: config.json)
  --reference-date <date>  Evaluate "as of" this date, YYYY-MM-DD (default: today)
  --no-ai                  Rules only; skip the Claude assessment
  -h, --help               Show this help`;

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: 'config.json' },
      'reference-date': { type: 'string' },
      'no-ai': { type: 'boolean', default: false },
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

  const config = await loadConfig(args.config, {
    overrides: { referenceDate: args['reference-date'], noAi: args['no-ai'] },
  });

  console.log('Config OK');
  console.log(`  Reference date: ${config.referenceDate} (${config.timezone})`);
  console.log(`  JQL:            ${config.jql}`);
  console.log(`  Claude:         ${config.claude.enabled ? config.claude.model : 'off (--no-ai)'}`);
  console.log('\nFetching issues from Jira arrives in phase 1.');
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
