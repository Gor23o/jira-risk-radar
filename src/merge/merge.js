// The severity model (CLAUDE.md → "Severity model"): combines rule flags and
// Claude's judgment into one risk level per issue. Pure.

export const LEVEL_RANK = { ok: 0, at_risk: 1, critical: 2 };
const maxLevel = (a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

/** Maps each flag to its problem group; a flag not listed in any group is its own group. */
function groupOf(rule, flagGroups) {
  for (const [group, members] of Object.entries(flagGroups)) {
    if (members.includes(rule)) return group;
  }
  return rule;
}

/**
 * @param {import('../rules/index.js').Flag[]} ruleFlags
 * @param {null | {status: 'unavailable', reason: string} | {status: 'ok', risk_level: string, flags: object[], reason?: string, suggested_action?: string}} ai
 *   null when Claude is off; Claude's flags (vague, blockedInComments) arrive already shaped as Flags
 * @param {object} config
 * @returns {{level: string, flags: object[], problems: number, escalated: boolean, ai: object|null}}
 */
export function assessIssue(ruleFlags, ai, config) {
  const aiFlags = ai?.status === 'ok' ? ai.flags : [];
  const flags = [...ruleFlags, ...aiFlags];

  // 1. Highest flag severity.
  let level = flags.reduce((acc, f) => maxLevel(acc, f.severity), 'ok');

  // 2. Escalation counts distinct problems: collapse flags into groups first.
  const groups = new Map();
  for (const f of flags) {
    const group = groupOf(f.rule, config.severity.flagGroups);
    groups.set(group, maxLevel(groups.get(group) ?? 'ok', f.severity));
  }
  const atRiskProblems = [...groups.values()].filter((s) => s === 'at_risk').length;
  const escalated = level !== 'critical' && atRiskProblems >= config.severity.escalateAtRiskCount;
  if (escalated) level = 'critical';

  // 3. Claude can raise the level, never lower it.
  if (ai?.status === 'ok') level = maxLevel(level, ai.risk_level);

  const problems = [...groups.values()].filter((s) => s !== 'ok').length;
  return { level, flags, problems, escalated, ai };
}

/** Level desc → distinct problems desc → due date asc (none last) → issue key. */
export function sortResults(results) {
  return [...results].sort(
    (a, b) =>
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
      b.problems - a.problems ||
      (a.issue.dueDate ?? '9999').localeCompare(b.issue.dueDate ?? '9999') ||
      a.issue.key.localeCompare(b.issue.key, 'en', { numeric: true }),
  );
}
