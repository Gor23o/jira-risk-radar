import { describe, expect, it } from 'vitest';
import { searchIssues } from '../../src/jira/search.js';

const customFieldIds = { sprint: 'customfield_10020', flagged: 'customfield_10021' };

function rawIssue(key, { histories = [], historyTotal = histories.length, comments = [], commentTotal = comments.length } = {}) {
  return {
    key,
    fields: { summary: key, comment: { comments, total: commentTotal } },
    changelog: { histories, total: historyTotal },
  };
}

/** A fake client that serves canned responses and records every call. */
function fakeClient({ searchPages, gets = {} }) {
  const calls = [];
  let page = 0;
  return {
    calls,
    post: async (path, body) => {
      calls.push({ method: 'POST', path, body });
      return searchPages[page++];
    },
    get: async (path, query) => {
      calls.push({ method: 'GET', path, query });
      const pages = gets[path];
      return pages.shift();
    },
  };
}

describe('searchIssues', () => {
  it('sends the JQL, needed fields, custom field ids and changelog expansion', async () => {
    const client = fakeClient({ searchPages: [{ issues: [], isLast: true }] });
    await searchIssues(client, { jql: 'sprint in openSprints()', customFieldIds });

    const { path, body } = client.calls[0];
    expect(path).toBe('/rest/api/3/search/jql');
    expect(body.jql).toBe('sprint in openSprints()');
    expect(body.expand).toBe('changelog');
    expect(body.fields).toEqual(expect.arrayContaining(['status', 'duedate', 'description', 'comment', 'customfield_10020', 'customfield_10021']));
    expect(body.nextPageToken).toBeUndefined();
  });

  it('omits custom fields the site does not have', async () => {
    const client = fakeClient({ searchPages: [{ issues: [], isLast: true }] });
    await searchIssues(client, { jql: 'x', customFieldIds: { sprint: null, flagged: null } });
    expect(client.calls[0].body.fields).not.toContain(null);
  });

  it('follows nextPageToken until isLast', async () => {
    const client = fakeClient({
      searchPages: [
        { issues: [rawIssue('RAD-1'), rawIssue('RAD-2')], nextPageToken: 'page-2', isLast: false },
        { issues: [rawIssue('RAD-3')], isLast: true },
      ],
    });
    const issues = await searchIssues(client, { jql: 'x', customFieldIds });

    expect(issues.map((i) => i.key)).toEqual(['RAD-1', 'RAD-2', 'RAD-3']);
    expect(client.calls.filter((c) => c.method === 'POST').map((c) => c.body.nextPageToken)).toEqual([undefined, 'page-2']);
  });

  it('fetches the full changelog when the embedded one is truncated', async () => {
    const h = (id) => ({ id, created: '2026-09-28T10:00:00.000+0000', items: [] });
    const client = fakeClient({
      searchPages: [{ issues: [rawIssue('RAD-1', { histories: [h('1')], historyTotal: 3 })], isLast: true }],
      gets: {
        '/rest/api/3/issue/RAD-1/changelog': [
          { values: [h('1'), h('2')], isLast: false, total: 3 },
          { values: [h('3')], isLast: true, total: 3 },
        ],
      },
    });
    const [issue] = await searchIssues(client, { jql: 'x', customFieldIds });

    expect(issue.changelog.histories.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(client.calls.filter((c) => c.method === 'GET').map((c) => c.query.startAt)).toEqual([0, 2]);
  });

  it('fetches all comments when the embedded list is truncated', async () => {
    const c = (text) => ({ body: text });
    const client = fakeClient({
      searchPages: [{ issues: [rawIssue('RAD-1', { comments: [c('a')], commentTotal: 2 })], isLast: true }],
      gets: { '/rest/api/3/issue/RAD-1/comment': [{ comments: [c('a'), c('b')], total: 2 }] },
    });
    const [issue] = await searchIssues(client, { jql: 'x', customFieldIds });
    expect(issue.fields.comment.comments.map((x) => x.body)).toEqual(['a', 'b']);
  });

  it('makes no extra calls when changelog and comments are complete', async () => {
    const client = fakeClient({ searchPages: [{ issues: [rawIssue('RAD-1')], isLast: true }] });
    await searchIssues(client, { jql: 'x', customFieldIds });
    expect(client.calls).toHaveLength(1);
  });
});
