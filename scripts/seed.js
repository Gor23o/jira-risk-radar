// Creates, refreshes or deletes the demo issues described in seed-data.js.
//
//   npm run seed                      create ~30 issues (refuses if seed issues exist)
//   npm run seed -- --refresh         demo day: restart healthy clocks, re-anchor due dates
//   npm run seed -- --reset           delete every issue with the seed label (asks first)
//   add --dry-run to any of them to see the plan without writing to Jira
//
// See CLAUDE.md → "Seed design" for why seeding and refreshing are separate steps.

import dotenv from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createJiraClient, readJiraEnv } from '../src/jira/client.js';
import { addBusinessDays } from '../src/rules/dates.js';
import { describeScenario, findSeedIssues, preflight, transitionTo } from '../src/seed/jira.js';
import { createFields, dueDateFor, refreshTransitions, resolveAssignee, toAdf } from '../src/seed/plan.js';
import { scenarios } from './seed-data.js';

const { values: args } = parseArgs({
  options: {
    refresh: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});
if (args.refresh && args.reset) {
  console.error('Choose one: --refresh or --reset.');
  process.exit(2);
}

dotenv.config({ quiet: true });
const config = await loadConfig('config.json', { overrides: { noAi: true } });
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
  console.log(`  Earliest demo day (clean stuck contrast): ${addBusinessDays(today, longestThreshold + 1, workingDays)}`);
  console.log(`  On demo day run: npm run seed -- --refresh, then npm run radar`);
  console.log(`  Short-notice fallback: npm run radar -- --reference-date ${addBusinessDays(today, 3, workingDays)}`);
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
  await (args.reset ? reset() : args.refresh ? refresh() : seed());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
