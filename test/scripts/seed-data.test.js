// Checks that the demo scenarios are internally consistent: each scenario's
// data really produces the flags it claims in `expect`. Phase 3 then checks
// that the rule engine agrees.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAG_NAMES } from '../../src/config.js';
import { finalStatus } from '../../src/seed/plan.js';
import { scenarios } from '../../scripts/seed-data.js';

const config = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));
const WORKFLOW = ['To Do', 'In Progress', 'In Review', 'Ready for QA', 'In QA', 'Done', 'Blocked'];
const AI_FLAGS = ['vague', 'blockedInComments'];

const isDone = (s) => finalStatus(s) === 'Done';
const has = (s, flag) => s.expect.includes(flag);
const bounceCount = (path) =>
  ['To Do', ...path].slice(1).filter((to, i, arr) => {
    const from = ['To Do', ...path][i];
    return config.bounce.fromStatuses.includes(from) && config.bounce.toStatuses.includes(to);
  }).length;

describe.each(scenarios.map((s) => [s.summary, s]))('%s', (_, s) => {
  it('uses real issue types, priorities and workflow statuses', () => {
    expect(['Task', 'Story']).toContain(s.type);
    expect(['Highest', 'High', 'Medium', 'Low', 'Lowest']).toContain(s.priority);
    for (const status of s.path) expect(WORKFLOW).toContain(status);
    expect(s.path[0]).not.toBe('To Do');
    s.path.forEach((status, i) => expect(status).not.toBe(s.path[i - 1]));
  });

  it('only expects known flags, with Claude flags kept separate', () => {
    for (const flag of s.expect) expect(FLAG_NAMES.filter((f) => !AI_FLAGS.includes(f))).toContain(flag);
    for (const flag of s.expectAi) expect(AI_FLAGS).toContain(flag);
  });

  it('is only left unrefreshed when it is meant to be stuck', () => {
    if (isDone(s) || finalStatus(s) === 'To Do') return;
    expect(!s.refresh).toBe(has(s, 'stuck'));
  });

  it('expects overdue / due soon exactly when its due date says so', () => {
    const due = s.dueInBusinessDays;
    expect(has(s, 'overdue')).toBe(!isDone(s) && due != null && due < 0);
    const notStarted = finalStatus(s) === 'To Do';
    expect(has(s, 'dueSoonNotStarted')).toBe(notStarted && due != null && due >= 0 && due <= config.dueSoonBusinessDays);
  });

  it('expects blocked exactly when it is in Blocked or flagged', () => {
    expect(has(s, 'blocked')).toBe(finalStatus(s) === 'Blocked' || Boolean(s.flagged));
  });

  it('expects bouncing exactly when its path bounces often enough', () => {
    expect(has(s, 'bouncing')).toBe(bounceCount(s.path) >= config.bounce.minCount);
  });

  it('expects unassigned-high-priority exactly when that is its setup', () => {
    const expected = !isDone(s) && s.assignee === null && config.highPriorities.includes(s.priority);
    expect(has(s, 'unassignedHighPriority')).toBe(expected);
  });

  it('is vague exactly when it has no acceptance criteria', () => {
    expect(s.expectAi.includes('vague')).toBe(!s.acceptanceCriteria?.length);
  });
});

describe('the scenario set as a whole', () => {
  it('has about 30 issues with unique summaries', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(28);
    expect(new Set(scenarios.map((s) => s.summary)).size).toBe(scenarios.length);
  });

  it('demonstrates every flag at least once', () => {
    const shown = new Set(scenarios.flatMap((s) => [...s.expect, ...s.expectAi]));
    for (const flag of FLAG_NAMES) expect(shown).toContain(flag);
  });

  it('puts issues in every column of the board', () => {
    const columns = new Set(scenarios.map(finalStatus));
    for (const status of WORKFLOW) expect(columns).toContain(status);
  });

  it('includes healthy issues and negative cases, not only problems', () => {
    const clean = scenarios.filter((s) => !s.expect.length && !s.expectAi.length);
    expect(clean.length).toBeGreaterThanOrEqual(8);
  });
});
