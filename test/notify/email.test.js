import { describe, expect, it } from 'vitest';
import { buildEmail } from '../../src/notify/email.js';

const issue = (overrides = {}) => ({
  key: 'SCRUM-5',
  url: 'https://example.atlassian.net/browse/SCRUM-5',
  summary: 'Build Jira read layer',
  status: { name: 'In Progress' },
  assignee: { name: 'Alex Doe' },
  dueDate: '2026-10-02',
  sprint: { name: 'SCRUM Sprint 0' },
  flagged: false,
  ...overrides,
});

const base = {
  status: 'success',
  date: '2026-10-01',
  jql: 'project = SCRUM AND statusCategory != Done',
  runUrl: 'https://github.com/o/r/actions/runs/1',
};

describe('buildEmail: successful run', () => {
  it('puts the date and issue count in the subject', () => {
    expect(buildEmail({ ...base, issues: [issue(), issue({ key: 'SCRUM-6' })] }).subject).toBe('Risk Radar 2026-10-01: 2 issues');
    expect(buildEmail({ ...base, issues: [issue()] }).subject).toBe('Risk Radar 2026-10-01: 1 issue');
  });

  it('lists every issue with a link in both the HTML and plain-text parts', () => {
    const { html, text } = buildEmail({ ...base, issues: [issue(), issue({ key: 'SCRUM-8', assignee: null, flagged: true })] });
    expect(html).toContain('<a href="https://example.atlassian.net/browse/SCRUM-5">SCRUM-5</a>');
    expect(html).toContain('Unassigned');
    expect(text).toContain('SCRUM-8  Build Jira read layer  [In Progress]  Unassigned  due 2026-10-02  FLAGGED');
    expect(text).toContain(base.runUrl);
  });

  it('escapes HTML in ticket text so a summary cannot inject markup', () => {
    const { html } = buildEmail({ ...base, issues: [issue({ summary: '<script>alert(1)</script> & co' })] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  });

  it('explains an empty result instead of sending an empty table', () => {
    const { subject, html } = buildEmail({ ...base, issues: [] });
    expect(subject).toBe('Risk Radar 2026-10-01: 0 issues');
    expect(html).toContain('No issues matched the JQL');
    expect(html).not.toContain('<table');
  });
});

describe('buildEmail: failed run', () => {
  it('says which step failed and links to the run', () => {
    const { subject, text, html } = buildEmail({ ...base, status: 'failure', issues: null, failedStep: 'Run Risk Radar' });
    expect(subject).toBe('Risk Radar 2026-10-01: run FAILED');
    expect(text).toContain('The "Run Risk Radar" step failed.');
    expect(html).toContain(`<a href="${base.runUrl}">`);
  });

  it('treats a success without results as a failure', () => {
    expect(buildEmail({ ...base, issues: null }).subject).toBe('Risk Radar 2026-10-01: run FAILED');
  });
});
