import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';
import { fetchIssues } from '../../src/jira/index.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const fields = read('../fixtures/jira/fields.json');
const page = read('../fixtures/jira/search-page.json');
const config = parseConfig(read('../../config.json'), { now: new Date('2026-09-30T12:00:00Z'), systemTimezone: 'UTC' });
const workflow = ['To Do', 'In Progress', 'In Review', 'Ready for QA', 'In QA', 'Done', 'Blocked'].map((name) => ({ name }));

function fakeClient({ searchResult = page, statuses = workflow } = {}) {
  return {
    baseUrl: 'https://example.atlassian.net',
    get: async (path) => (path === '/rest/api/3/field' ? fields : statuses),
    post: async () => structuredClone(searchResult),
  };
}

describe('fetchIssues', () => {
  it('returns normalized issues and no warnings for a healthy setup', async () => {
    const { issues, warnings } = await fetchIssues(config, { client: fakeClient() });
    expect(issues.map((i) => i.key)).toEqual(['RAD-1', 'RAD-4']);
    expect(issues[0].sprint.name).toBe('RAD Sprint 2');
    expect(warnings).toEqual([]);
  });

  it('warns when nothing matches, since Jira returns no error for an unknown project key', async () => {
    const { warnings } = await fetchIssues(config, { client: fakeClient({ searchResult: { issues: [], isLast: true } }) });
    expect(warnings).toEqual([expect.stringContaining('No issues matched the JQL')]);
  });

  it('warns about configured statuses missing from the workflow', async () => {
    const { warnings } = await fetchIssues(config, { client: fakeClient({ statuses: workflow.filter((s) => s.name !== 'Blocked') }) });
    expect(warnings).toEqual([expect.stringContaining('Blocked')]);
  });
});
