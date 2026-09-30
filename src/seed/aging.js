// Demo aging: simulates the waiting period Jira can't backdate, so seeded
// "stuck" scenarios can be checked the moment they're created.
//
// Deliberately narrow:
//   - only issues carrying the seed label AND matching a scenario with refresh: false
//   - only the date they entered their current status is moved back (and any
//     earlier history entries later than that, to keep the timeline ordered)
//   - never makes an issue younger; if real time has already aged it, it's untouched
//   - aged entries are marked `simulated: true`, and the caller reports the count
// Everything else (due dates, flags, bounces, owners) stays live Jira data.

import { addBusinessDays } from '../rules/dates.js';

/**
 * @param {import('../jira/normalize.js').Issue[]} issues
 * @param {{scenarios: object[], config: object}} options
 * @returns {{issues: object[], aged: string[]}} new issue list, and keys that were aged
 */
export function applyDemoAging(issues, { scenarios, config }) {
  const bySummary = new Map(scenarios.map((s) => [s.summary, s]));
  const longest = Math.max(...Object.values(config.stuckThresholdBusinessDays));
  const agedDate = addBusinessDays(config.referenceDate, -(longest + 1), config.businessDays.workingDays);
  const aged = [];

  const result = issues.map((issue) => {
    const scenario = bySummary.get(issue.summary);
    if (!issue.labels.includes(config.seed.label) || !scenario || scenario.refresh) return issue;

    const entry = issue.statusHistory.findLastIndex((t) => t.to === issue.status.name);
    if (entry === -1 || issue.statusHistory[entry].date <= agedDate) return issue;

    aged.push(issue.key);
    const statusHistory = issue.statusHistory.map((t, i) =>
      i <= entry && t.date > agedDate ? { ...t, date: agedDate, simulated: true } : t,
    );
    return { ...issue, statusHistory };
  });

  return { issues: result, aged };
}
