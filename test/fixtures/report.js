// A small report as produced by runRadar, for output tests.

const issue = (key, summary, status, extra = {}) => ({
  key,
  url: `https://example.atlassian.net/browse/${key}`,
  summary,
  status: { name: status, category: 'indeterminate' },
  assignee: { accountId: 'a', name: 'Alex Doe' },
  dueDate: null,
  ...extra,
});

export const report = {
  referenceDate: '2026-10-01',
  timezone: 'Asia/Yerevan',
  jql: 'project = SCRUM AND statusCategory != Done',
  ai: 'partial',
  aiModel: 'claude-sonnet-5-5',
  aiUsage: { inputTokens: 12000, outputTokens: 3000, costUsd: 0.054, calls: 2, issues: 3 },
  demoAging: { applied: true, aged: ['SCRUM-20'] },
  warnings: [],
  summary: {
    total: 3,
    byLevel: { critical: 1, at_risk: 1, ok: 1 },
    byAssignee: [
      { name: 'Alex Doe', critical: 1, at_risk: 0, ok: 1, total: 2 },
      { name: 'Unassigned', critical: 0, at_risk: 1, ok: 0, total: 1 },
    ],
  },
  results: [
    {
      issue: issue('SCRUM-20', 'Refactor <payment> | errors', 'In Review', { dueDate: '2026-09-29' }),
      level: 'critical',
      problems: 2,
      escalated: false,
      flags: [
        { rule: 'overdue', source: 'rule', severity: 'critical', message: 'Past its due date', evidence: 'Due 2026-09-29, 2 days ago' },
        { rule: 'stuck', source: 'rule', severity: 'at_risk', message: 'Stuck in In Review', evidence: 'In Review for 6 business days since 2026-09-23 (threshold 2)' },
      ],
      ai: { status: 'ok', risk_level: 'critical', reason: 'Late & waiting on <review>.', suggested_action: 'Ask the reviewer for a date today.', flags: [] },
    },
    {
      issue: issue('SCRUM-39', 'PCI compliance fixes', 'To Do', { assignee: null }),
      level: 'at_risk',
      problems: 1,
      escalated: false,
      flags: [{ rule: 'unassignedHighPriority', source: 'rule', severity: 'at_risk', message: 'High priority with no owner', evidence: 'Highest priority, unassigned' }],
      ai: { status: 'unavailable', reason: 'Claude declined to assess this batch' },
    },
    { issue: issue('SCRUM-9', 'Saved addresses', 'To Do'), level: 'ok', problems: 0, escalated: false, flags: [] },
  ],
};
