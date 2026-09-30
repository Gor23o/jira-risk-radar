import { countBounces } from './statusHistory.js';

/** Sent back from QA to development repeatedly: a sign of unclear requirements or quality problems. */
export function bouncing(issue, { config }) {
  const count = countBounces(issue, config.bounce);
  if (count < config.bounce.minCount) return null;
  return {
    message: 'Keeps bouncing back from QA',
    evidence: `Sent back from ${config.bounce.fromStatuses.join('/')} to ${config.bounce.toStatuses.join('/')} ${count} times (threshold ${config.bounce.minCount})`,
  };
}
