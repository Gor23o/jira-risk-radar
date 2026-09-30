import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { runRadar } from '../src/pipeline.js';
import { makeIssue } from './helpers/makeIssue.js';

const raw = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const config = parseConfig(raw, { overrides: { referenceDate: '2026-09-30' }, systemTimezone: 'UTC' });
const noAi = parseConfig(raw, { overrides: { referenceDate: '2026-09-30', noAi: true }, systemTimezone: 'UTC' });

const scenarios = [{ summary: 'Stuck demo', refresh: false, expect: ['stuck'] }];
const issues = [
  makeIssue({ key: 'SCRUM-1', summary: 'Healthy', path: ['In Progress'] }),
  makeIssue({ key: 'SCRUM-2', summary: 'Stuck demo', path: ['In Progress', 'In Review'], labels: ['seed-demo'] }),
  makeIssue({ key: 'SCRUM-3', summary: 'Late', path: ['In Progress'], dueDate: '2026-09-25', assignee: null }),
  makeIssue({ key: 'SCRUM-4', summary: 'Finished', path: ['In Progress', 'Done'] }),
];
const fetch = async () => ({ issues, warnings: ['a warning'] });

/** Fake assessor: returns the given assessments and records what it was asked about. */
function fakeAssess(byKey) {
  const fn = async (items) => {
    fn.keys = items.map((i) => i.issue.key);
    return { byKey: new Map(Object.entries(byKey)), usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 }, calls: 1 };
  };
  return fn;
}
const okAi = (risk_level, flags = []) => ({ status: 'ok', risk_level, reason: 'r', suggested_action: 'a', flags });

describe('runRadar without Claude', () => {
  it('produces sorted results, level counts and per-assignee numbers', async () => {
    const report = await runRadar(noAi, { fetch, demoAging: false });
    expect(report.results.map((r) => [r.issue.key, r.level])).toEqual([
      ['SCRUM-3', 'critical'],
      ['SCRUM-1', 'ok'],
      ['SCRUM-2', 'ok'],
      ['SCRUM-4', 'ok'],
    ]);
    expect(report.summary.byLevel).toEqual({ critical: 1, at_risk: 0, ok: 3 });
    expect(report).toMatchObject({ ai: 'off', aiUsage: null, warnings: ['a warning'], demoAging: { applied: false, aged: [] } });
  });

  it('applies demo aging to seeded stuck scenarios only, and reports it', async () => {
    const report = await runRadar(noAi, { fetch, demoAging: true, scenarios });
    expect(report.demoAging).toEqual({ applied: true, aged: ['SCRUM-2'] });
    expect(report.results.find((r) => r.issue.key === 'SCRUM-2').level).toBe('at_risk');
    expect(report.results.find((r) => r.issue.key === 'SCRUM-1').level).toBe('ok');
  });

  it('follows config.seed.demoAging when no option is given', async () => {
    const report = await runRadar(noAi, { fetch, scenarios });
    expect(report.demoAging.applied).toBe(config.seed.demoAging);
  });
});

describe('runRadar with Claude', () => {
  it('sends only open issues, never finished ones', async () => {
    const assess = fakeAssess({});
    await runRadar(config, { fetch, demoAging: false, assess });
    expect(assess.keys).toEqual(['SCRUM-1', 'SCRUM-2', 'SCRUM-3']);
  });

  it('lets Claude raise a level and add flags, but never lower one', async () => {
    const vague = { rule: 'vague', source: 'ai', severity: 'at_risk', message: 'Vague', evidence: 'no AC' };
    const assess = fakeAssess({ 'SCRUM-1': okAi('at_risk', [vague]), 'SCRUM-2': okAi('ok'), 'SCRUM-3': okAi('ok') });
    const report = await runRadar(config, { fetch, demoAging: false, assess });
    const byKey = Object.fromEntries(report.results.map((r) => [r.issue.key, r]));
    expect(byKey['SCRUM-1']).toMatchObject({ level: 'at_risk', flags: [vague], ai: { reason: 'r', suggested_action: 'a' } });
    expect(byKey['SCRUM-3'].level).toBe('critical'); // overdue stays critical though Claude said ok
    expect(report).toMatchObject({ ai: 'on', aiModel: 'claude-sonnet-5-5', aiUsage: { costUsd: 0.001, calls: 1, issues: 3 } });
  });

  it('reports partial AI coverage and why', async () => {
    const assess = fakeAssess({ 'SCRUM-1': okAi('ok'), 'SCRUM-2': { status: 'unavailable', reason: 'timeout' } });
    const report = await runRadar(config, { fetch, demoAging: false, assess });
    expect(report.ai).toBe('partial');
    expect(report.warnings).toContain('Claude assessment unavailable for some issues: timeout');
  });

  it('reports AI unavailable when nothing could be assessed', async () => {
    const down = { status: 'unavailable', reason: 'ANTHROPIC_API_KEY is not set' };
    const assess = fakeAssess({ 'SCRUM-1': down, 'SCRUM-2': down, 'SCRUM-3': down });
    const report = await runRadar(config, { fetch, demoAging: false, assess });
    expect(report.ai).toBe('unavailable');
    expect(report.results.find((r) => r.issue.key === 'SCRUM-3').level).toBe('critical');
  });
});
