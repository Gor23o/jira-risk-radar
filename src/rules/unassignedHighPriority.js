/** High-priority work that nobody owns. */
export function unassignedHighPriority(issue, { config }) {
  if (issue.assignee || !config.highPriorities.includes(issue.priority)) return null;
  return { message: 'High priority with no owner', evidence: `${issue.priority} priority, unassigned` };
}
