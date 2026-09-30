// Creates, refreshes or deletes the demo issues described in seed-data.js.
//
//   npm run seed                      create ~30 issues (refuses if seed issues exist)
//   npm run seed -- --refresh         demo day: restart healthy clocks, re-anchor due dates
//   npm run seed -- --reset           delete every issue with the seed label (asks first)
//   npm run seed -- --verify          check the live seeded issues against their scenarios (read-only)
//   add --dry-run to seed/refresh/reset to see the plan without writing to Jira
//   add --demo-aging to --verify to check "stuck" scenarios without waiting (see src/seed/aging.js)
//   add --reference-date YYYY-MM-DD to --verify to preview what a later day's run will say
//
// See CLAUDE.md → "Seed design" for why seeding and refreshing are separate steps.

import dotenv from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createJiraClient, readJiraEnv } from '../src/jira/client.js';
import { fetchIssues } from '../src/jira/index.js';
import { addBusinessDays } from '../src/rules/dates.js';
import { runRules } from '../src/rules/index.js';
import { applyDemoAging } from '../src/seed/aging.js';
import { describeScenario, findSeedIssues, preflight, transitionTo } from '../src/seed/jira.js';
import { createFields, dueDateFor, refreshTransitions, resolveAssignee, toAdf } from '../src/seed/plan.js';
import { scenarios } from './seed-data.js';

const { values: args } = parseArgs({
  options: {
    refresh: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    'demo-aging': { type: 'boolean', default: false },
    'reference-date': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});
if ([args.refresh, args.reset, args.verify].filter(Boolean).length > 1) {
  console.error('Choose one: --refresh, --reset or --verify.');
  process.exit(2);
}

if (args['reference-date'] && !args.verify) {
  console.error('--reference-date only works with --verify (to preview another day). Seeding always uses today.');
  process.exit(2);
}

dotenv.config({ quiet: true });
const config = await loadConfig('config.json', { overrides: { noAi: true, referenceDate: args['reference-date'] } });
const client = createJiraClient(readJiraEnv());
const dryRun = args['dry-run'];
const today = config.referenceDate;
const workingDays = config.businessDays.workingDays;
const label = config.seed.label;
const tag = dryRun ? '[dry run] ' : '';

async function seed() {
  const ctx = await preflight(client, config, scenarios);
  ctx.warnings.forEach((w) => console.warn(`Warning: ${w}`));

  const existing = await findSeedIssues(client, config);
  if (existing.length) {
    throw new Error(
      `${existing.length} issue(s) labelled "${label}" already exist in ${ctx.projectKey}. ` +
        'Run `npm run seed -- --reset` first, or `--refresh` on demo day.',
    );
  }

  console.log(`${tag}Seeding ${scenarios.length} issues into ${ctx.projectKey}` + (ctx.sprint ? ` (sprint "${ctx.sprint.name}")` : '') + ` as of ${today}\n`);
  const created = [];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const dueDate = dueDateFor(scenario, today, workingDays);
      const assigneeId = resolveAssignee(scenario.assignee, ctx, index);
      const fields = createFields(scenario, {
        projectKey: ctx.projectKey,
        label,
        dueDate,
        assigneeId,
        sprintId: ctx.sprint?.id ?? null,
        customFieldIds: ctx.customFieldIds,
      });

      let key = '(new)';
      if (!dryRun) {
        ({ key } = await client.post('/rest/api/3/issue', { fields }));
        created.push(key);
        // The project's default assignee can override an explicit null on create.
        if (!assigneeId) await client.put(`/rest/api/3/issue/${key}/assignee`, { accountId: null });
        for (const status of scenario.path) await transitionTo(client, key, status);
        for (const text of scenario.comments ?? []) {
          await client.post(`/rest/api/3/issue/${key}/comment`, { body: toAdf(text) });
        }
      }
      const extras = [
        !assigneeId && 'unassigned',
        scenario.flagged && 'flagged',
        scenario.comments?.length && `${scenario.comments.length} comment(s)`,
      ].filter(Boolean);
      console.log(
        `${tag}${key.padEnd(9)} ${scenario.summary.padEnd(46)} → ${describeScenario(scenario).padEnd(28)} ` +
          `due ${dueDate ?? '—'}${extras.length ? `  [${extras.join(', ')}]` : ''}`,
      );
    }
  } catch (err) {
    if (created.length) err.message += `\n${created.length} issue(s) were created before the failure. Run \`npm run seed -- --reset\` to start clean.`;
    throw err;
  }

  const longestThreshold = Math.max(...Object.values(config.stuckThresholdBusinessDays));
  console.log(`\n${tag}Done. Seeded on ${today}.`);
  console.log(`  Check right away:  npm run seed -- --verify --demo-aging`);
  console.log(`  Real aging done:   ${addBusinessDays(today, longestThreshold + 1, workingDays)} (then --refresh, and no simulation needed)`);
}

async function verify() {
  const jql = `project = ${config.seed.projectKey} AND labels = "${label}" ORDER BY key ASC`;
  let { issues } = await fetchIssues({ ...config, jql });
  if (!issues.length) throw new Error(`No issues labelled "${label}" found. Run \`npm run seed\` first.`);

  let aged = [];
  if (args['demo-aging']) ({ issues, aged } = applyDemoAging(issues, { scenarios, config }));
  const bySummary = new Map(issues.map((i) => [i.summary, i]));
  const sorted = (list) => [...list].sort().join(', ') || '—';

  console.log(`Verifying ${scenarios.length} scenarios against live Jira as of ${today}` +
    (args['demo-aging'] ? `, demo aging simulated for ${aged.length} issue(s)` : '') + '\n');

  let failures = 0;
  let dueDrift = 0;
  let unaged = 0;
  for (const scenario of scenarios) {
    const issue = bySummary.get(scenario.summary);
    if (!issue) {
      failures++;
      console.log(`✗ ${'(missing)'.padEnd(9)} ${scenario.summary}: not found in Jira`);
      continue;
    }
    const flags = runRules(issue, config);
    const expected = sorted(scenario.expect);
    const actual = sorted(flags.map((f) => f.rule));
    const ok = expected === actual;
    if (!ok) failures++;
    if (issue.dueDate !== dueDateFor(scenario, today, workingDays)) dueDrift++;
    if (!ok && scenario.expect.includes('stuck') && !actual.includes('stuck')) unaged++;

    const ai = scenario.expectAi.length ? `   (Claude, phase 4: ${scenario.expectAi.join(', ')})` : '';
    console.log(`${ok ? '✓' : '✗'} ${issue.key.padEnd(9)} ${scenario.summary.padEnd(46)} ${actual}${ok ? '' : `   expected: ${expected}`}${ai}`);
  }

  const passed = scenarios.length - failures;
  console.log(`\n${passed}/${scenarios.length} scenarios match.`);
  if (dueDrift && failures) console.log(`Note: ${dueDrift} due date(s) were anchored to another day. Run \`npm run seed -- --refresh\` to re-anchor them to today.`);
  if (unaged && !args['demo-aging']) console.log(`Note: ${unaged} "stuck" scenario(s) haven't aged yet. Add --demo-aging to simulate the wait.`);
  if (failures) process.exitCode = 1;
}

async function refresh() {
  const ctx = await preflight(client, config, scenarios);
  const issues = await findSeedIssues(client, config);
  if (!issues.length) throw new Error(`No issues labelled "${label}" found. Run \`npm run seed\` first.`);

  const bySummary = new Map(issues.map((i) => [i.summary, i]));
  const known = new Set(scenarios.map((s) => s.summary));
  const viaStatus = config.seed.refreshViaStatus;
  console.log(`${tag}Refreshing ${issues.length} seed issues in ${ctx.projectKey} as of ${today}\n`);

  for (const scenario of scenarios) {
    const issue = bySummary.get(scenario.summary);
    if (!issue) {
      console.warn(`Warning: no seeded issue for "${scenario.summary}" (renamed or deleted?)`);
      continue;
    }
    const dueDate = dueDateFor(scenario, today, workingDays);
    const moves = refreshTransitions(scenario, issue.status, { viaStatus, doneCategory: issue.category === 'done' });
    if (!dryRun) {
      await client.put(`/rest/api/3/issue/${issue.key}`, { fields: { duedate: dueDate } });
      for (const status of moves) await transitionTo(client, issue.key, status);
    }
    const clock = moves.length ? `clock restarted via ${viaStatus}` : scenario.refresh ? 'no status change needed' : 'left alone (stuck)';
    console.log(`${tag}${issue.key.padEnd(9)} ${scenario.summary.padEnd(46)} due ${(dueDate ?? '—').padEnd(10)}  ${clock}`);
  }
  for (const issue of issues.filter((i) => !known.has(i.summary))) {
    console.warn(`Warning: ${issue.key} "${issue.summary}" has the seed label but no matching scenario; left unchanged.`);
  }
  console.log(`\n${tag}Done. Now run: npm run radar`);
}

async function reset() {
  const issues = await findSeedIssues(client, config);
  if (!issues.length) {
    console.log(`No issues labelled "${label}" in ${config.seed.projectKey}. Nothing to delete.`);
    return;
  }
  console.log(`${issues.length} issue(s) labelled "${label}" in ${config.seed.projectKey}:`);
  issues.forEach((i) => console.log(`  ${i.key.padEnd(9)} ${i.summary}`));
  if (dryRun) {
    console.log(`\n[dry run] These would be permanently deleted.`);
    return;
  }

  if (!args.yes) {
    if (!process.stdin.isTTY) throw new Error('Deleting needs confirmation: run this in a terminal, or pass --yes.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nPermanently delete these ${issues.length} issues? Type "yes" to confirm: `);
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Cancelled. Nothing was deleted.');
      return;
    }
  }
  for (const issue of issues) {
    await client.delete(`/rest/api/3/issue/${issue.key}`);
    console.log(`Deleted ${issue.key}`);
  }
  console.log(`\nDone. ${issues.length} issue(s) deleted. Run \`npm run seed\` to create them again.`);
}

try {
  await (args.verify ? verify() : args.reset ? reset() : args.refresh ? refresh() : seed());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
