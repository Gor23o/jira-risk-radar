// Acceptance test: the rule engine must raise exactly the flags each demo
// scenario promises, both on the real demo day and on seed day with demo aging.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { runRules } from '../../src/rules/index.js';
import { applyDemoAging } from '../../src/seed/aging.js';
import { dueDateFor, finalStatus } from '../../src/seed/plan.js';
import { scenarios } from '../../scripts/seed-data.js';
import { makeIssue } from '../helpers/makeIssue.js';

const raw = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));
const SEED_DAY = '2026-09-30'; // Wednesday
const DEMO_DAY = '2026-10-08'; // six business days later
const configOn = (date) => parseConfig(raw, { overrides: { referenceDate: date }, systemTimezone: 'UTC' });

/** The issue as Jira holds it after `npm run seed` on SEED_DAY (and `--refresh` on `refreshedOn`, if given). */
function seededIssue(scenario, index, { dueAnchor, refreshedOn }) {
  const issue = makeIssue({
    key: `SCRUM-${index + 9}`,
    summary: scenario.summary,
    path: scenario.path,
    movedOn: SEED_DAY,
    created: SEED_DAY,
    priority: scenario.priority,
    assignee: scenario.assignee ? { accountId: 'acc-1', name: 'Gor' } : null,
    dueDate: dueDateFor(scenario, dueAnchor, raw.businessDays.workingDays),
    flagged: Boolean(scenario.flagged),
    labels: [raw.seed.label],
  });
  const current = finalStatus(scenario);
  const via = raw.seed.refreshViaStatus;
  if (refreshedOn && scenario.refresh && current !== via && current !== 'Done') {
    issue.statusHistory.push(
      { date: refreshedOn, from: current, to: via },
      { date: refreshedOn, from: via, to: current },
    );
  }
  return issue;
}

const sorted = (list) => [...list].sort();

describe('demo day, after `seed --refresh` (real aging, no simulation)', () => {
  const config = configOn(DEMO_DAY);
  it.each(scenarios.map((s, i) => [s.summary, s, i]))('%s', (_, scenario, i) => {
    const issue = seededIssue(scenario, i, { dueAnchor: DEMO_DAY, refreshedOn: DEMO_DAY });
    expect(sorted(runRules(issue, config).map((f) => f.rule))).toEqual(sorted(scenario.expect));
  });
});

describe('seed day, checked immediately with --demo-aging', () => {
  const config = configOn(SEED_DAY);
  const fresh = scenarios.map((s, i) => seededIssue(s, i, { dueAnchor: SEED_DAY }));
  const { issues, aged } = applyDemoAging(fresh, { scenarios, config });

  it.each(scenarios.map((s, i) => [s.summary, s, i]))('%s', (_, scenario, i) => {
    expect(sorted(runRules(issues[i], config).map((f) => f.rule))).toEqual(sorted(scenario.expect));
  });

  it('ages exactly the scenarios meant to be stuck, and marks the change as simulated', () => {
    const meantToBeStuck = scenarios.flatMap((s, i) => (s.expect.includes('stuck') ? [`SCRUM-${i + 9}`] : []));
    expect(aged).toEqual(meantToBeStuck);
    const agedIssue = issues.find((i) => i.key === aged[0]);
    expect(agedIssue.statusHistory.at(-1)).toMatchObject({ simulated: true, date: '2026-09-22' });
  });

  it('without aging, the same data has no stuck flags: that is what aging simulates', () => {
    const stuckCount = fresh.filter((i) => runRules(i, config).some((f) => f.rule === 'stuck')).length;
    expect(stuckCount).toBe(0);
  });
});

describe('applyDemoAging safety', () => {
  const config = configOn(SEED_DAY);
  const stuckScenario = scenarios.find((s) => !s.refresh && s.expect.includes('stuck'));

  it('never touches issues without the seed label', () => {
    const real = { ...seededIssue(stuckScenario, 0, { dueAnchor: SEED_DAY }), labels: [] };
    const { issues, aged } = applyDemoAging([real], { scenarios, config });
    expect(aged).toEqual([]);
    expect(issues[0]).toBe(real);
  });

  it('never makes an issue younger when real time has already aged it', () => {
    const old = seededIssue(stuckScenario, 0, { dueAnchor: SEED_DAY });
    old.statusHistory = old.statusHistory.map((t) => ({ ...t, date: '2026-09-01' }));
    const { aged } = applyDemoAging([old], { scenarios, config });
    expect(aged).toEqual([]);
  });

  it('leaves the rest of the issue untouched', () => {
    const issue = seededIssue(stuckScenario, 0, { dueAnchor: SEED_DAY });
    const [agedIssue] = applyDemoAging([issue], { scenarios, config }).issues;
    const { statusHistory: _a, ...restAged } = agedIssue;
    const { statusHistory: _b, ...restOriginal } = issue;
    expect(restAged).toEqual(restOriginal);
    expect(agedIssue.statusHistory.map((t) => t.to)).toEqual(issue.statusHistory.map((t) => t.to));
  });
});
