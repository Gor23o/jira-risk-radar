import { businessDaysBetween } from './dates.js';
import { statusEnteredOn } from './statusHistory.js';

/**
 * In an active status (In Progress, In Review, In QA...) longer than that status allows.
 * Waiting statuses have stricter thresholds in config. "To Do" isn't checked:
 * sitting in the backlog is normal.
 */
export function stuck(issue, { config, referenceDate, category }) {
  if (category !== 'indeterminate') return null;
  const thresholds = config.stuckThresholdBusinessDays;
  const threshold = thresholds[issue.status.name] ?? thresholds.default;
  const since = statusEnteredOn(issue);
  const days = businessDaysBetween(since, referenceDate, config.businessDays.workingDays);
  if (days <= threshold) return null;
  return {
    message: `Stuck in ${issue.status.name}`,
    evidence: `${issue.status.name} for ${days} business days since ${since} (threshold ${threshold})`,
  };
}
