import { businessDaysBetween } from './dates.js';

/** Due within the next N business days (today included) and still in a "not started" status. */
export function dueSoonNotStarted(issue, { config, referenceDate, category }) {
  if (category !== 'new' || !issue.dueDate || issue.dueDate < referenceDate) return null;
  const left = businessDaysBetween(referenceDate, issue.dueDate, config.businessDays.workingDays);
  if (left > config.dueSoonBusinessDays) return null;
  const when = left === 0 ? 'today' : `in ${left} business day${left === 1 ? '' : 's'}`;
  return {
    message: 'Due soon and not started',
    evidence: `Due ${issue.dueDate} (${when}), still in ${issue.status.name}`,
  };
}
