// Facts derived from an issue's status history. Pure.

/**
 * The status category the rules should use: Jira's, unless config corrects it
 * (some boards file "In QA" under To Do, which would make it look "not started").
 */
export function effectiveCategory(issue, config) {
  return config.statusCategoryOverrides[issue.status.name] ?? issue.status.category;
}

/** Date (YYYY-MM-DD) the issue last moved into its current status; created date if it never moved. */
export function statusEnteredOn(issue) {
  const history = issue.statusHistory;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].to === issue.status.name) return history[i].date;
  }
  return issue.created;
}

/** Number of transitions straight from a QA-side status back to an active one. */
export function countBounces(issue, { fromStatuses, toStatuses }) {
  return issue.statusHistory.filter((t) => fromStatuses.includes(t.from) && toStatuses.includes(t.to)).length;
}
