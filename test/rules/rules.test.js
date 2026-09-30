import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { runRules } from '../../src/rules/index.js';
import { countBounces, effectiveCategory, statusEnteredOn } from '../../src/rules/statusHistory.js';
import { makeIssue } from '../helpers/makeIssue.js';

const raw = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));
// Thursday 2026-10-08, six business days after the seed day (Wed 2026-09-30).
const config = parseConfig(raw, { overrides: { referenceDate: '2026-10-08' }, systemTimezone: 'UTC' });
const withConfig = (change) => {
  const copy = structuredClone(raw);
  change(copy);
  return parseConfig(copy, { overrides: { referenceDate: '2026-10-08' }, systemTimezone: 'UTC' });
};

const flagsOf = (issue, cfg = config) => runRules(issue, cfg);
const rulesOf = (issue, cfg = config) => flagsOf(issue, cfg).map((f) => f.rule);
const flag = (issue, rule, cfg = config) => flagsOf(issue, cfg).find((f) => f.rule === rule);

describe('statusHistory helpers', () => {
  it('finds when the issue entered its current status, or its created date', () => {
    const moved = makeIssue({ path: ['In Progress', 'In Review'], movedOn: '2026-10-01' });
    expect(statusEnteredOn(moved)).toBe('2026-10-01');
    expect(statusEnteredOn(makeIssue({ created: '2026-09-20' }))).toBe('2026-09-20');
  });

  it('uses the LAST entry into the current status', () => {
    const issue = makeIssue({
      statusName: 'In Progress',
      statusHistory: [
        { date: '2026-09-21', from: 'To Do', to: 'In Progress' },
        { date: '2026-09-22', from: 'In Progress', to: 'In Review' },
        { date: '2026-10-05', from: 'In Review', to: 'In Progress' },
      ],
    });
    expect(statusEnteredOn(issue)).toBe('2026-10-05');
  });

  it('applies category overrides from config', () => {
    expect(effectiveCategory(makeIssue({ statusName: 'In QA' }), config)).toBe('indeterminate');
    expect(effectiveCategory(makeIssue({ statusName: 'To Do' }), config)).toBe('new');
  });

  it('a demo refresh (In QA → To Do → In QA) is not a bounce and restarts the clock', () => {
    const issue = makeIssue({
      statusName: 'In QA',
      statusHistory: [
        { date: '2026-09-30', from: 'To Do', to: 'In Progress' },
        { date: '2026-09-30', from: 'In Progress', to: 'In Review' },
        { date: '2026-09-30', from: 'In Review', to: 'Ready for QA' },
        { date: '2026-09-30', from: 'Ready for QA', to: 'In QA' },
        { date: '2026-10-08', from: 'In QA', to: 'To Do' },
        { date: '2026-10-08', from: 'To Do', to: 'In QA' },
      ],
    });
    expect(countBounces(issue, config.bounce)).toBe(0);
    expect(statusEnteredOn(issue)).toBe('2026-10-08');
    expect(rulesOf(issue)).toEqual([]);
  });
});

describe('overdue', () => {
  it('flags a past due date with calendar-day evidence', () => {
    const f = flag(makeIssue({ statusName: 'In Progress', dueDate: '2026-10-06' }), 'overdue');
    expect(f).toMatchObject({ source: 'rule', severity: 'critical', message: 'Past its due date', evidence: 'Due 2026-10-06, 2 days ago' });
  });

  it('does not flag due today, in the future, or without a due date', () => {
    for (const dueDate of ['2026-10-08', '2026-10-20', null]) {
      expect(rulesOf(makeIssue({ statusName: 'In Progress', dueDate }))).not.toContain('overdue');
    }
  });

  it('ignores finished work', () => {
    expect(rulesOf(makeIssue({ statusName: 'Done', dueDate: '2026-09-01' }))).toEqual([]);
  });
});

describe('dueSoonNotStarted', () => {
  it('flags not-started work due within the window, counting business days', () => {
    // Thu Oct 8 -> Tue Oct 13 = Fri, Mon, Tue = 3 business days (the edge)
    expect(flag(makeIssue({ dueDate: '2026-10-13' }), 'dueSoonNotStarted').evidence).toBe('Due 2026-10-13 (in 3 business days), still in To Do');
    expect(flag(makeIssue({ dueDate: '2026-10-08' }), 'dueSoonNotStarted').evidence).toContain('(today)');
  });

  it('does not flag beyond the window, once started, or when already overdue', () => {
    expect(rulesOf(makeIssue({ dueDate: '2026-10-14' }))).not.toContain('dueSoonNotStarted');
    expect(rulesOf(makeIssue({ path: ['In Progress'], movedOn: '2026-10-08', dueDate: '2026-10-09' }))).toEqual([]);
    expect(rulesOf(makeIssue({ dueDate: '2026-10-07' }))).toEqual(['overdue']);
  });

  it('treats In QA as started thanks to the category override', () => {
    const inQa = makeIssue({ path: ['In Progress', 'In Review', 'Ready for QA', 'In QA'], movedOn: '2026-10-08', dueDate: '2026-10-09' });
    expect(rulesOf(inQa)).toEqual([]);
    const noOverride = withConfig((c) => (c.statusCategoryOverrides = {}));
    expect(rulesOf(inQa, noOverride)).toContain('dueSoonNotStarted');
  });
});

describe('stuck', () => {
  it('flags time in status beyond that status threshold', () => {
    const f = flag(makeIssue({ path: ['In Progress', 'In Review'], movedOn: '2026-10-02' }), 'stuck');
    expect(f).toMatchObject({ severity: 'at_risk', message: 'Stuck in In Review', evidence: 'In Review for 4 business days since 2026-10-02 (threshold 2)' });
  });

  it('is stricter for waiting statuses than for active work', () => {
    const since = '2026-10-02'; // 4 business days before Oct 8
    expect(rulesOf(makeIssue({ path: ['In Progress', 'In Review'], movedOn: since }))).toContain('stuck');
    expect(rulesOf(makeIssue({ path: ['In Progress'], movedOn: since }))).not.toContain('stuck');
  });

  it('flags only when strictly over the threshold', () => {
    expect(rulesOf(makeIssue({ path: ['In Progress'], movedOn: '2026-10-01' }))).not.toContain('stuck'); // exactly 5
    expect(rulesOf(makeIssue({ path: ['In Progress'], movedOn: '2026-09-30' }))).toContain('stuck'); // 6
  });

  it('uses the default threshold for unlisted statuses and skips To Do', () => {
    expect(rulesOf(makeIssue({ path: ['In Progress', 'Blocked'], movedOn: '2026-10-01' }))).toContain('stuck'); // Blocked: 5 > 4
    expect(rulesOf(makeIssue({ created: '2026-08-01' }))).toEqual([]);
  });
});

describe('blocked', () => {
  it('flags the Blocked status and the Jira flag, listing each reason', () => {
    expect(flag(makeIssue({ path: ['In Progress', 'Blocked'], movedOn: '2026-10-08' }), 'blocked').evidence).toBe('Status is Blocked');
    expect(flag(makeIssue({ flagged: true }), 'blocked').evidence).toBe('Flagged as an impediment in Jira');
    const both = makeIssue({ path: ['In Progress', 'Blocked'], movedOn: '2026-10-08', flagged: true });
    expect(flag(both, 'blocked').evidence).toBe('Status is Blocked; Flagged as an impediment in Jira');
  });
});

describe('bouncing', () => {
  const trip = ['In Progress', 'In Review', 'Ready for QA', 'In QA'];

  it('flags two or more returns from QA to In Progress', () => {
    const issue = makeIssue({ path: [...trip, ...trip, 'In Progress'], movedOn: '2026-10-08' });
    expect(flag(issue, 'bouncing').evidence).toBe('Sent back from In QA/Ready for QA to In Progress 2 times (threshold 2)');
  });

  it('does not flag a single return', () => {
    expect(rulesOf(makeIssue({ path: [...trip, 'In Progress'], movedOn: '2026-10-08' }))).not.toContain('bouncing');
  });
});

describe('unassignedHighPriority', () => {
  it('flags High and Highest issues with no assignee', () => {
    expect(flag(makeIssue({ priority: 'Highest', assignee: null }), 'unassignedHighPriority').evidence).toBe('Highest priority, unassigned');
    expect(rulesOf(makeIssue({ priority: 'Medium', assignee: null }))).toEqual([]);
    expect(rulesOf(makeIssue({ priority: 'High' }))).toEqual([]);
  });
});

describe('runRules', () => {
  it('takes every severity from config', () => {
    const cfg = withConfig((c) => (c.severity.rules.overdue = 'at_risk'));
    expect(flag(makeIssue({ statusName: 'In Progress', dueDate: '2026-10-01' }), 'overdue', cfg).severity).toBe('at_risk');
  });

  it('returns several flags for an issue with several problems', () => {
    const issue = makeIssue({ priority: 'High', assignee: null, dueDate: '2026-10-09' });
    expect(rulesOf(issue)).toEqual(['dueSoonNotStarted', 'unassignedHighPriority']);
  });
});
