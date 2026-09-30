import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeIssue } from '../../src/jira/normalize.js';

const page = JSON.parse(readFileSync(new URL('../fixtures/jira/search-page.json', import.meta.url), 'utf8'));
const context = {
  baseUrl: 'https://example.atlassian.net',
  timezone: 'Asia/Yerevan',
  customFieldIds: { sprint: 'customfield_10020', flagged: 'customfield_10021' },
};
const [inProgress, demoPrep] = page.issues.map((raw) => normalizeIssue(raw, context));

describe('normalizeIssue', () => {
  it('maps the core fields', () => {
    expect(inProgress).toMatchObject({
      key: 'RAD-1',
      url: 'https://example.atlassian.net/browse/RAD-1',
      summary: 'Build Jira read layer',
      type: 'Task',
      status: { name: 'In Progress', category: 'indeterminate' },
      priority: 'High',
      assignee: { accountId: 'acc-alex', name: 'Alex Doe' },
      dueDate: '2026-10-02',
      created: '2026-09-28',
      labels: ['backend'],
      flagged: false,
    });
  });

  it('converts the ADF description to text, keeping bullets', () => {
    expect(inProgress.description).toBe('Goal: fetch issues via JQL.\n- Pagination with nextPageToken\n- Full changelog');
  });

  it('dates comments in the configured timezone', () => {
    // 21:30 UTC on Sep 29 is already Sep 30 in Yerevan (UTC+4).
    expect(inProgress.comments).toEqual([
      { author: 'Sam Lee', createdAt: '2026-09-29T21:30:00.000+0000', created: '2026-09-30', text: 'Started on the client.' },
    ]);
  });

  it('extracts status transitions from the changelog', () => {
    expect(inProgress.statusHistory).toEqual([
      { at: '2026-09-28T10:00:00.000+0400', date: '2026-09-28', from: 'To Do', to: 'In Progress' },
    ]);
  });

  it('picks the active sprint as current and keeps the sprint history', () => {
    expect(inProgress.sprint).toEqual({
      id: 3,
      name: 'RAD Sprint 2',
      state: 'active',
      startDate: '2026-09-28',
      endDate: '2026-10-09',
    });
    expect(inProgress.sprints.map((s) => s.name)).toEqual(['RAD Sprint 1', 'RAD Sprint 2']);
  });

  it('handles an unassigned, unprioritised, flagged issue outside any sprint', () => {
    expect(demoPrep).toMatchObject({
      key: 'RAD-4',
      status: { name: 'To Do', category: 'new' },
      priority: null,
      assignee: null,
      dueDate: null,
      flagged: true,
      sprint: null,
      sprints: [],
      comments: [],
      statusHistory: [],
    });
  });

  it('prefers a future sprint when the issue is not in an active one', () => {
    const raw = structuredClone(page.issues[1]);
    raw.fields.customfield_10020 = [{ id: 9, name: 'RAD Sprint 3', state: 'future' }];
    expect(normalizeIssue(raw, context).sprint).toMatchObject({ name: 'RAD Sprint 3', state: 'future', startDate: null });
  });

  it('works when the site has no Sprint or Flagged field', () => {
    const issue = normalizeIssue(page.issues[1], { ...context, customFieldIds: { sprint: null, flagged: null } });
    expect(issue.sprint).toBeNull();
    expect(issue.flagged).toBe(false);
  });

  it('sorts status history oldest first even if Jira returns it newest first', () => {
    const raw = structuredClone(page.issues[0]);
    const move = (id, created, from, to) => ({ id, created, items: [{ field: 'status', fieldId: 'status', fromString: from, toString: to }] });
    raw.changelog.histories = [
      move('3', '2026-09-29T10:00:00.000+0400', 'In Progress', 'In Review'),
      move('2', '2026-09-28T10:00:00.000+0400', 'To Do', 'In Progress'),
      { id: '1', created: '2026-09-28T09:30:00.000+0400', items: [{ field: 'assignee', fieldId: 'assignee' }] },
    ];
    expect(normalizeIssue(raw, context).statusHistory.map((t) => t.to)).toEqual(['In Progress', 'In Review']);
  });
});
