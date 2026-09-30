import { describe, expect, it } from 'vitest';
import { renderSummary } from '../../scripts/ci-summary.js';

const issue = {
  key: 'SCRUM-5',
  url: 'https://example.atlassian.net/browse/SCRUM-5',
  summary: 'Build | read layer',
  status: { name: 'In Progress' },
  assignee: null,
  dueDate: '2026-10-02',
  sprint: { name: 'SCRUM Sprint 0' },
  flagged: true,
};

describe('renderSummary', () => {
  it('renders one table row per issue, escaping pipes', () => {
    const md = renderSummary([issue]);
    expect(md).toContain('## Risk Radar: 1 issue(s)');
    expect(md).toContain(
      '| [SCRUM-5](https://example.atlassian.net/browse/SCRUM-5) | Build \\| read layer | In Progress | Unassigned | 2026-10-02 | SCRUM Sprint 0 | yes |',
    );
  });

  it('explains an empty result instead of printing an empty table', () => {
    expect(renderSummary([])).toContain('No issues matched the JQL');
  });
});
