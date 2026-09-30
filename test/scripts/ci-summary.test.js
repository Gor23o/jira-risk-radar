import { describe, expect, it } from 'vitest';
import { renderSummary } from '../../scripts/ci-summary.js';
import { report } from '../fixtures/report.js';

describe('renderSummary', () => {
  const md = renderSummary(report);

  it('headlines the date and counts per level', () => {
    expect(md).toContain('## Risk Radar 2026-10-01: 1 critical, 1 at risk, 1 ok');
  });

  it('states that demo aging was simulated, and for which issues', () => {
    expect(md).toContain('Demo aging: the waiting period was simulated for 1 seeded demo issue(s) (SCRUM-20)');
  });

  it('shows the per-assignee table including Unassigned', () => {
    expect(md).toContain('| Alex Doe | 1 | 0 | 1 | 2 |');
    expect(md).toContain('| Unassigned | 0 | 1 | 0 | 1 |');
  });

  it('lists issues needing attention with the evidence, escaping pipes', () => {
    expect(md).toContain('### Needs attention (2)');
    expect(md).toContain('[SCRUM-20](https://example.atlassian.net/browse/SCRUM-20) | Refactor <payment> \\| errors');
    expect(md).toContain('**Stuck in In Review**: In Review for 6 business days');
  });

  it("adds Claude's reason and next step, or says Claude was unavailable", () => {
    expect(md).toContain('🤖 Late & waiting on <review>.<br>➡️ **Next:** Ask the reviewer for a date today.');
    expect(md).toContain('_Claude unavailable: Claude declined to assess this batch_');
  });

  it('shows Claude status, model and cost', () => {
    expect(md).toContain('Claude: partial (claude-sonnet-5-5, about $0.054)');
    expect(renderSummary({ ...report, ai: 'off' })).toContain('Claude: off');
  });

  it('collapses OK issues', () => {
    expect(md).toContain('<details><summary>1 issue(s) OK</summary>');
  });

  it('has no aging note when aging is off', () => {
    expect(renderSummary({ ...report, demoAging: { applied: false, aged: [] } })).not.toContain('Demo aging');
  });

  it('explains an empty result', () => {
    const empty = { ...report, summary: { total: 0, byLevel: { critical: 0, at_risk: 0, ok: 0 }, byAssignee: [] }, results: [] };
    expect(renderSummary(empty)).toContain('No issues matched the JQL');
  });
});
