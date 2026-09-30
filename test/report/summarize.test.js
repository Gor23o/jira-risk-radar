import { describe, expect, it } from 'vitest';
import { levelCountsText, summarize } from '../../src/report/summarize.js';
import { makeIssue } from '../helpers/makeIssue.js';

const alex = { accountId: 'a', name: 'Alex' };
const sam = { accountId: 's', name: 'Sam' };
const r = (level, assignee) => ({ issue: makeIssue({ assignee }), level });

describe('summarize', () => {
  const summary = summarize([r('critical', alex), r('ok', alex), r('at_risk', sam), r('at_risk', sam), r('critical', null), r('ok', null)]);

  it('counts issues per level', () => {
    expect(summary).toMatchObject({ total: 6, byLevel: { critical: 2, at_risk: 2, ok: 2 } });
  });

  it('counts per assignee, with Unassigned as its own row, most critical first', () => {
    expect(summary.byAssignee).toEqual([
      { name: 'Alex', critical: 1, at_risk: 0, ok: 1, total: 2 },
      { name: 'Unassigned', critical: 1, at_risk: 0, ok: 1, total: 2 },
      { name: 'Sam', critical: 0, at_risk: 2, ok: 0, total: 2 },
    ]);
  });

  it('handles no issues', () => {
    expect(summarize([])).toEqual({ total: 0, byLevel: { critical: 0, at_risk: 0, ok: 0 }, byAssignee: [] });
  });
});

describe('levelCountsText', () => {
  it('lists non-zero levels from most to least severe', () => {
    expect(levelCountsText({ byLevel: { critical: 3, at_risk: 12, ok: 20 } })).toBe('3 critical, 12 at risk, 20 ok');
    expect(levelCountsText({ byLevel: { critical: 0, at_risk: 0, ok: 5 } })).toBe('5 ok');
    expect(levelCountsText({ byLevel: { critical: 0, at_risk: 0, ok: 0 } })).toBe('no issues');
  });
});
