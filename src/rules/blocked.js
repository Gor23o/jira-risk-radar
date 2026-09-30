/**
 * Blocked by status or by Jira's Flag (impediment). The third signal, blocking
 * language in comments, needs judgment and comes from Claude as `blockedInComments`.
 */
export function blocked(issue, { config }) {
  const reasons = [];
  if (config.blockedStatuses.includes(issue.status.name)) reasons.push(`Status is ${issue.status.name}`);
  if (issue.flagged) reasons.push('Flagged as an impediment in Jira');
  if (!reasons.length) return null;
  return { message: 'Blocked', evidence: reasons.join('; ') };
}
