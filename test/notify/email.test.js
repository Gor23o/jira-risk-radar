import { describe, expect, it } from 'vitest';
import { buildEmail, parseRecipients } from '../../src/notify/email.js';
import { report } from '../fixtures/report.js';

describe('parseRecipients', () => {
  it('splits on commas or semicolons, trims, and drops duplicates and blanks', () => {
    expect(parseRecipients(' a@x.com, b@y.org;a@x.com ,, ')).toEqual({ valid: ['a@x.com', 'b@y.org'], invalid: [] });
  });

  it('reports entries that are not email addresses', () => {
    expect(parseRecipients('a@x.com, bob, c@nodot, d@e.io')).toEqual({ valid: ['a@x.com', 'd@e.io'], invalid: ['bob', 'c@nodot'] });
  });

  it('returns nothing for an empty or missing list', () => {
    expect(parseRecipients('')).toEqual({ valid: [], invalid: [] });
    expect(parseRecipients(undefined)).toEqual({ valid: [], invalid: [] });
  });
});

const runUrl = 'https://github.com/o/r/actions/runs/1';

describe('buildEmail: successful run', () => {
  const email = buildEmail({ status: 'success', report, date: '2026-10-01', runUrl });

  it('puts the risk counts in the subject', () => {
    expect(email.subject).toBe('Risk Radar 2026-10-01: 1 critical, 1 at risk, 1 ok');
  });

  it('lists issues needing attention with their evidence, in both parts', () => {
    expect(email.text).toContain('- [Critical] SCRUM-20 Refactor <payment> | errors (In Review, Alex Doe)');
    expect(email.text).toContain('    Stuck in In Review: In Review for 6 business days');
    expect(email.html).toContain('<a href="https://example.atlassian.net/browse/SCRUM-39">SCRUM-39</a>');
    expect(email.html).toContain('<strong>High priority with no owner</strong>: Highest priority, unassigned');
  });

  it('includes the per-assignee counts', () => {
    expect(email.text).toContain('Unassigned: 0 critical, 1 at risk, 0 ok');
    expect(email.html).toContain('>Unassigned</td>');
  });

  it('states that demo aging was simulated', () => {
    expect(email.text).toContain('Demo aging: the waiting period was simulated for 1 seeded demo issue(s) (SCRUM-20)');
    expect(email.html).toContain('Demo aging');
    const noAging = buildEmail({ status: 'success', report: { ...report, demoAging: { applied: false, aged: [] } }, runUrl });
    expect(noAging.text).not.toContain('Demo aging');
  });

  it('escapes HTML in ticket text so a summary cannot inject markup', () => {
    expect(email.html).not.toContain('<payment>');
    expect(email.html).toContain('Refactor &lt;payment&gt; | errors');
  });

  it('explains an empty result', () => {
    const empty = { ...report, summary: { total: 0, byLevel: { critical: 0, at_risk: 0, ok: 0 }, byAssignee: [] }, results: [] };
    const { subject, html } = buildEmail({ status: 'success', report: empty, runUrl });
    expect(subject).toBe('Risk Radar 2026-10-01: no issues');
    expect(html).toContain('No issues matched the JQL');
  });
});

describe('buildEmail: failed run', () => {
  it('says which step failed and links to the run', () => {
    const { subject, text, html } = buildEmail({ status: 'failure', report: null, date: '2026-10-01', runUrl, failedStep: 'Run Risk Radar' });
    expect(subject).toBe('Risk Radar 2026-10-01: run FAILED');
    expect(text).toContain('The "Run Risk Radar" step failed.');
    expect(html).toContain(`<a href="${runUrl}">`);
  });

  it('treats a success without a report as a failure', () => {
    expect(buildEmail({ status: 'success', report: null, date: '2026-10-01', runUrl }).subject).toBe('Risk Radar 2026-10-01: run FAILED');
  });
});
