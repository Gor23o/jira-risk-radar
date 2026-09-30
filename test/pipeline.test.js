import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { runRadar } from '../src/pipeline.js';
import { makeIssue } from './helpers/makeIssue.js';

const raw = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const config = parseConfig(raw, { overrides: { referenceDate: '2026-09-30' }, systemTimezone: 'UTC' });

const scenarios = [{ summary: 'Stuck demo', refresh: false, expect: ['stuck'] }];
const issues = [
  makeIssue({ key: 'SCRUM-1', summary: 'Healthy', path: ['In Progress'] }),
  makeIssue({ key: 'SCRUM-2', summary: 'Stuck demo', path: ['In Progress', 'In Review'], labels: ['seed-demo'] }),
  makeIssue({ key: 'SCRUM-3', summary: 'Late', path: ['In Progress'], dueDate: '2026-09-25', assignee: null }),
];
const fetch = async () => ({ issues, warnings: ['a warning'] });

describe('runRadar', () => {
  it('produces sorted results, level counts and per-assignee numbers', async () => {
    const report = await runRadar(config, { fetch, demoAging: false });
    expect(report.results.map((r) => [r.issue.key, r.level])).toEqual([
      ['SCRUM-3', 'critical'],
      ['SCRUM-1', 'ok'],
      ['SCRUM-2', 'ok'],
    ]);
    expect(report.summary.byLevel).toEqual({ critical: 1, at_risk: 0, ok: 2 });
    expect(report).toMatchObject({ referenceDate: '2026-09-30', ai: 'off', warnings: ['a warning'], demoAging: { applied: false, aged: [] } });
  });

  it('applies demo aging to seeded stuck scenarios only, and reports it', async () => {
    const report = await runRadar(config, { fetch, demoAging: true, scenarios });
    expect(report.demoAging).toEqual({ applied: true, aged: ['SCRUM-2'] });
    expect(report.results.find((r) => r.issue.key === 'SCRUM-2')).toMatchObject({ level: 'at_risk' });
    expect(report.results.find((r) => r.issue.key === 'SCRUM-1').level).toBe('ok');
  });

  it('follows config.seed.demoAging when no option is given', async () => {
    const report = await runRadar(config, { fetch, scenarios });
    expect(report.demoAging.applied).toBe(config.seed.demoAging);
  });
});
