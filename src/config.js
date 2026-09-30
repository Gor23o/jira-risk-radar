// Loads config.json, validates it, and resolves the values that depend on
// "now" (referenceDate, timezone). This is the only place the real clock is
// read; everything downstream receives the resolved referenceDate.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { dateInTimezone, isIsoDate, isValidTimezone } from './rules/dates.js';

/** Risk levels, lowest to highest. */
export const LEVELS = ['ok', 'at_risk', 'critical'];

/** Every flag the tool can raise. Rules produce most of them; Claude produces vague + blockedInComments. */
export const FLAG_NAMES = [
  'overdue',
  'dueSoonNotStarted',
  'stuck',
  'blocked',
  'blockedInComments',
  'bouncing',
  'unassignedHighPriority',
  'vague',
];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const text = z.string().trim().min(1);
const textList = z.array(text);
const positiveInt = z.number().int().positive();
const level = z.enum(LEVELS);
const flagName = z.enum(FLAG_NAMES);
const isoDate = z.string().refine(isIsoDate, 'must be a real date in YYYY-MM-DD format');
const timezone = z.string().refine(isValidTimezone, 'must be an IANA time zone, e.g. "Europe/Berlin"');

const configSchema = z
  .strictObject({
    jql: text,
    referenceDate: isoDate.nullable(),
    timezone: timezone.nullable(),
    businessDays: z.strictObject({
      workingDays: z.array(z.number().int().min(1).max(7)).min(1),
    }),
    dueSoonBusinessDays: z.number().int().min(0),
    // Status name -> threshold. "default" applies to statuses not listed.
    stuckThresholdBusinessDays: z.object({ default: positiveInt }).catchall(positiveInt),
    blockedStatuses: textList,
    bounce: z.strictObject({
      fromStatuses: textList.min(1),
      toStatuses: textList.min(1),
      minCount: positiveInt,
    }),
    highPriorities: textList,
    severity: z.strictObject({
      rules: z.strictObject(Object.fromEntries(FLAG_NAMES.map((name) => [name, level]))),
      flagGroups: z.record(text, z.array(flagName).min(1)),
      escalateAtRiskCount: z.number().int().min(2),
    }),
    claude: z.strictObject({
      enabled: z.boolean(),
      model: text,
      batchSize: z.number().int().min(1).max(50),
      effort: z.enum(EFFORT_LEVELS),
    }),
    apply: z.strictObject({
      label: text,
      levels: z.array(z.enum(['critical', 'at_risk'])).min(1),
    }),
    seed: z.strictObject({
      // Jira project keys: uppercase letter first, then uppercase letters/digits/underscores.
      projectKey: z.string().regex(/^[A-Z][A-Z0-9_]+$/, 'must be a Jira project key like "SCRUM"'),
      label: text,
      refreshViaStatus: text,
    }),
  })
  // Rules that involve more than one field.
  .superRefine((cfg, ctx) => {
    const days = cfg.businessDays.workingDays;
    if (new Set(days).size !== days.length) {
      ctx.addIssue({ code: 'custom', path: ['businessDays', 'workingDays'], message: 'contains duplicate days' });
    }

    const groupOf = {};
    for (const [group, members] of Object.entries(cfg.severity.flagGroups)) {
      for (const flag of members) {
        if (groupOf[flag] && groupOf[flag] !== group) {
          ctx.addIssue({
            code: 'custom',
            path: ['severity', 'flagGroups', group],
            message: `flag "${flag}" is already in group "${groupOf[flag]}"; a flag can belong to only one group`,
          });
        }
        groupOf[flag] = group;
      }
    }

    const { fromStatuses, toStatuses } = cfg.bounce;
    for (const status of fromStatuses.filter((s) => toStatuses.includes(s))) {
      ctx.addIssue({
        code: 'custom',
        path: ['bounce'],
        message: `"${status}" is in both fromStatuses and toStatuses`,
      });
    }

    // A demo refresh moves issues out and back via this status. If it were a
    // bounce status, the refresh itself would look like a QA bounce.
    const via = cfg.seed.refreshViaStatus;
    if (fromStatuses.includes(via) || toStatuses.includes(via)) {
      ctx.addIssue({
        code: 'custom',
        path: ['seed', 'refreshViaStatus'],
        message: `"${via}" is a bounce status; refreshing through it would look like a QA bounce`,
      });
    }
  });

function formatIssues(issues) {
  return issues
    .map((issue) => `  - ${issue.path.length ? issue.path.join('.') : '(top level)'}: ${issue.message}`)
    .join('\n');
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validates a raw config object and resolves referenceDate + timezone.
 * Pure apart from its inputs, so tests can pass a fixed `now`.
 *
 * @param {object} raw - parsed config.json
 * @param {object} [options]
 * @param {Date} [options.now] - the current instant
 * @param {string} [options.systemTimezone] - used when config.timezone is null
 * @param {{referenceDate?: string, jql?: string, noAi?: boolean}} [options.overrides] - CLI flags
 * @returns {Readonly<object>} the validated, resolved config
 */
export function parseConfig(raw, options = {}) {
  const {
    now = new Date(),
    systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    overrides = {},
  } = options;

  // Apply CLI overrides before validation so they're validated too.
  const merged = structuredClone(raw);
  if (merged && typeof merged === 'object') {
    if (overrides.referenceDate !== undefined) merged.referenceDate = overrides.referenceDate;
    if (overrides.jql !== undefined) merged.jql = overrides.jql;
    if (overrides.noAi && merged.claude && typeof merged.claude === 'object') merged.claude.enabled = false;
  }

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((issue) =>
      overrides.referenceDate !== undefined && issue.path.join('.') === 'referenceDate'
        ? { ...issue, path: ['--reference-date'] }
        : issue,
    );
    throw new ConfigError(`Invalid config:\n${formatIssues(issues)}`);
  }

  const cfg = result.data;
  cfg.timezone = cfg.timezone ?? systemTimezone;
  cfg.referenceDate = cfg.referenceDate ?? dateInTimezone(now, cfg.timezone);
  return deepFreeze(cfg);
}

/** Reads and parses a config file from disk. See parseConfig for options. */
export async function loadConfig(path = 'config.json', options = {}) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new ConfigError(`Config file not found: ${path}`);
    throw err;
  }

  let raw;
  try {
    raw = JSON.parse(contents);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${err.message}`);
  }

  try {
    return parseConfig(raw, options);
  } catch (err) {
    if (err instanceof ConfigError) throw new ConfigError(err.message.replace('Invalid config', `Invalid ${path}`));
    throw err;
  }
}
