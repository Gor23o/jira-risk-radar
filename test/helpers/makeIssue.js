// Builds a normalized Issue for tests. Override only what a test cares about.

const CATEGORY = {
  'To Do': 'new',
  'In Progress': 'indeterminate',
  'In Review': 'indeterminate',
  'Ready for QA': 'indeterminate',
  // As reported by the real SCRUM board: config.statusCategoryOverrides corrects these.
  'In QA': 'new',
  Blocked: 'new',
  Done: 'done',
};

/**
 * @param {object} [overrides]
 * @param {string} [overrides.statusName] - shorthand; sets status with its category
 * @param {string[]} [overrides.path] - statuses walked from To Do on `movedOn`; sets statusHistory
 * @param {string} [overrides.movedOn] - date the path transitions happened
 */
export function makeIssue({ statusName, path, movedOn = '2026-09-30', ...overrides } = {}) {
  const status = statusName ?? path?.at(-1) ?? 'To Do';
  const statusHistory = [];
  let from = 'To Do';
  for (const to of path ?? []) {
    statusHistory.push({ at: `${movedOn}T10:00:00.000+0000`, date: movedOn, from, to });
    from = to;
  }
  return {
    key: 'SCRUM-1',
    url: 'https://example.atlassian.net/browse/SCRUM-1',
    summary: 'Test issue',
    type: 'Task',
    status: { name: status, category: CATEGORY[status] ?? 'indeterminate' },
    priority: 'Medium',
    assignee: { accountId: 'acc-1', name: 'Alex Doe' },
    dueDate: null,
    created: '2026-09-30',
    createdAt: '2026-09-30T09:00:00.000+0000',
    labels: [],
    flagged: false,
    sprint: null,
    sprints: [],
    description: '',
    comments: [],
    statusHistory,
    ...overrides,
  };
}
