// Numbers for the top of the report and the email. Pure.

import { LEVEL_RANK } from '../merge/merge.js';

/**
 * @param {{issue: object, level: string}[]} results
 * @returns {{total: number, byLevel: {critical: number, at_risk: number, ok: number},
 *            byAssignee: {name: string, critical: number, at_risk: number, ok: number, total: number}[]}}
 */
export function summarize(results) {
  const byLevel = { critical: 0, at_risk: 0, ok: 0 };
  const people = new Map();
  for (const { issue, level } of results) {
    byLevel[level]++;
    const name = issue.assignee?.name ?? 'Unassigned';
    const row = people.get(name) ?? { name, critical: 0, at_risk: 0, ok: 0, total: 0 };
    row[level]++;
    row.total++;
    people.set(name, row);
  }
  const byAssignee = [...people.values()].sort(
    (a, b) => b.critical - a.critical || b.at_risk - a.at_risk || a.name.localeCompare(b.name),
  );
  return { total: results.length, byLevel, byAssignee };
}

/** "3 critical, 12 at risk, 20 ok", skipping zero counts except when everything is zero. */
export function levelCountsText({ byLevel }) {
  const parts = Object.keys(LEVEL_RANK)
    .reverse()
    .filter((level) => byLevel[level])
    .map((level) => `${byLevel[level]} ${level.replace('_', ' ')}`);
  return parts.join(', ') || 'no issues';
}
