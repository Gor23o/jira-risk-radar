// Runs every rule on an issue and returns its flags. Pure: the reference date
// comes from config, never from the clock.

import { blocked } from './blocked.js';
import { bouncing } from './bouncing.js';
import { dueSoonNotStarted } from './dueSoonNotStarted.js';
import { overdue } from './overdue.js';
import { effectiveCategory } from './statusHistory.js';
import { stuck } from './stuck.js';
import { unassignedHighPriority } from './unassignedHighPriority.js';

const RULES = { overdue, dueSoonNotStarted, stuck, blocked, bouncing, unassignedHighPriority };

/**
 * @typedef {object} Flag
 * @property {string} rule - e.g. "stuck"
 * @property {'rule'|'ai'} source
 * @property {'ok'|'at_risk'|'critical'} severity - from config.severity.rules
 * @property {string} message - short label, e.g. "Stuck in In Review"
 * @property {string} evidence - why, e.g. "In In Review for 4 business days (threshold 2)"
 */

/**
 * @param {import('../jira/normalize.js').Issue} issue
 * @param {object} config - resolved config (referenceDate included)
 * @returns {Flag[]}
 */
export function runRules(issue, config) {
  const category = effectiveCategory(issue, config);
  if (category === 'done') return []; // finished work carries no delivery risk
  const context = { config, referenceDate: config.referenceDate, category };

  const flags = [];
  for (const [rule, check] of Object.entries(RULES)) {
    const hit = check(issue, context);
    if (hit) flags.push({ rule, source: 'rule', severity: config.severity.rules[rule], ...hit });
  }
  return flags;
}
