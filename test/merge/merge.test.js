import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { assessIssue, sortResults } from '../../src/merge/merge.js';
import { makeIssue } from '../helpers/makeIssue.js';

const config = parseConfig(JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8')), { systemTimezone: 'UTC' });
const flag = (rule, source = 'rule') => ({ rule, source, severity: config.severity.rules[rule], message: rule, evidence: '' });
const ai = (risk_level, ...rules) => ({ status: 'ok', risk_level, flags: rules.map((r) => flag(r, 'ai')) });

describe('assessIssue (severity model)', () => {
  it('no flags and no AI → ok', () => {
    expect(assessIssue([], null, config)).toMatchObject({ level: 'ok', problems: 0, escalated: false });
  });

  it('one at_risk flag → at_risk', () => {
    expect(assessIssue([flag('stuck')], null, config).level).toBe('at_risk');
  });

  it('a critical flag → critical', () => {
    expect(assessIssue([flag('overdue')], null, config).level).toBe('critical');
  });

  it('blocked + blockedInComments are one problem → stays at_risk', () => {
    const result = assessIssue([flag('blocked')], ai('at_risk', 'blockedInComments'), config);
    expect(result).toMatchObject({ level: 'at_risk', problems: 1, escalated: false });
  });

  it('blocked + blockedInComments + dueSoonNotStarted are two problems → critical', () => {
    const result = assessIssue([flag('blocked'), flag('dueSoonNotStarted')], ai('at_risk', 'blockedInComments'), config);
    expect(result).toMatchObject({ level: 'critical', problems: 2, escalated: true });
  });

  it('Claude-sourced flags count toward escalation: vague + stuck → critical', () => {
    expect(assessIssue([flag('stuck')], ai('at_risk', 'vague'), config)).toMatchObject({ level: 'critical', escalated: true });
  });

  it('Claude cannot downgrade: overdue issue that Claude calls ok → critical', () => {
    expect(assessIssue([flag('overdue')], ai('ok'), config).level).toBe('critical');
  });

  it('Claude can raise the level on its own judgment', () => {
    expect(assessIssue([], ai('at_risk'), config).level).toBe('at_risk');
  });

  it('AI unavailable → rule flags only', () => {
    const result = assessIssue([flag('stuck')], { status: 'unavailable', reason: 'timeout' }, config);
    expect(result).toMatchObject({ level: 'at_risk', flags: [flag('stuck')] });
  });

  it('a flag mapped to ok is kept but does not raise the level or count as a problem', () => {
    const cfg = { ...config, severity: { ...config.severity, rules: { ...config.severity.rules, stuck: 'ok' } } };
    const result = assessIssue([{ ...flag('stuck'), severity: 'ok' }], null, cfg);
    expect(result).toMatchObject({ level: 'ok', problems: 0 });
    expect(result.flags).toHaveLength(1);
  });
});

describe('sortResults', () => {
  const result = (key, level, problems, dueDate = null) => ({ issue: makeIssue({ key, dueDate }), level, problems });

  it('sorts by level, then problems, then due date (none last), then key numerically', () => {
    const sorted = sortResults([
      result('SCRUM-10', 'ok', 0),
      result('SCRUM-9', 'at_risk', 1),
      result('SCRUM-2', 'at_risk', 1, '2026-10-05'),
      result('SCRUM-3', 'at_risk', 2),
      result('SCRUM-1', 'critical', 1),
      result('SCRUM-11', 'at_risk', 1),
    ]);
    expect(sorted.map((r) => r.issue.key)).toEqual(['SCRUM-1', 'SCRUM-3', 'SCRUM-2', 'SCRUM-9', 'SCRUM-11', 'SCRUM-10']);
  });
});
