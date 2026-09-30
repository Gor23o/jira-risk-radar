import { daysBetween } from './dates.js';

/** Due date has passed and the work isn't done. Calendar days: a missed date is missed on any day. */
export function overdue(issue, { referenceDate }) {
  if (!issue.dueDate || issue.dueDate >= referenceDate) return null;
  const late = daysBetween(issue.dueDate, referenceDate);
  return {
    message: 'Past its due date',
    evidence: `Due ${issue.dueDate}, ${late} day${late === 1 ? '' : 's'} ago`,
  };
}
