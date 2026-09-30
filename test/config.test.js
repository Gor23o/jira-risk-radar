import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../src/config.js';

// The committed config.json is the baseline, so this also checks that the shipped config is valid.
const baseConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));

// 2026-10-01 00:30 UTC: still Sept 30 in New York, already Oct 1 in Berlin.
const NOW = new Date('2026-10-01T00:30:00Z');

/** A fresh copy of the base config with `change` applied to it. */
function configWith(change) {
  const cfg = structuredClone(baseConfig);
  change(cfg);
  return cfg;
}

function parse(raw, options = {}) {
  return parseConfig(raw, { now: NOW, systemTimezone: 'UTC', ...options });
}

function expectInvalid(raw, ...fragments) {
  let error;
  try {
    parse(raw);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(ConfigError);
  for (const fragment of fragments) expect(error.message).toContain(fragment);
}

describe('parseConfig: valid input', () => {
  it('accepts the committed config.json', () => {
    const cfg = parse(baseConfig);
    expect(cfg.jql).toBe(baseConfig.jql);
    expect(cfg.severity.rules.overdue).toBe('critical');
  });

  it('defaults timezone to the system timezone and referenceDate to today there', () => {
    const cfg = parse(baseConfig, { systemTimezone: 'America/New_York' });
    expect(cfg.timezone).toBe('America/New_York');
    expect(cfg.referenceDate).toBe('2026-09-30');
  });

  it('uses the configured timezone to decide what "today" is', () => {
    const cfg = parse(configWith((c) => (c.timezone = 'Europe/Berlin')));
    expect(cfg.referenceDate).toBe('2026-10-01');
  });

  it('keeps an explicit referenceDate from config', () => {
    const cfg = parse(configWith((c) => (c.referenceDate = '2026-10-15')));
    expect(cfg.referenceDate).toBe('2026-10-15');
  });

  it('lets the CLI --reference-date override config', () => {
    const cfg = parse(configWith((c) => (c.referenceDate = '2026-10-15')), {
      overrides: { referenceDate: '2026-11-02' },
    });
    expect(cfg.referenceDate).toBe('2026-11-02');
  });

  it('lets the CLI --jql override config', () => {
    const cfg = parse(baseConfig, { overrides: { jql: 'sprint in openSprints()' } });
    expect(cfg.jql).toBe('sprint in openSprints()');
  });

  it('turns Claude off with --no-ai', () => {
    const cfg = parse(baseConfig, { overrides: { noAi: true } });
    expect(cfg.claude.enabled).toBe(false);
  });

  it('returns a frozen object so rules cannot mutate config', () => {
    const cfg = parse(baseConfig);
    expect(Object.isFrozen(cfg.severity.rules)).toBe(true);
  });

  it('does not modify the raw input', () => {
    const raw = structuredClone(baseConfig);
    parse(raw, { overrides: { referenceDate: '2026-11-02', noAi: true } });
    expect(raw).toEqual(baseConfig);
  });
});

describe('parseConfig: invalid input', () => {
  it('rejects an unknown severity level', () => {
    expectInvalid(configWith((c) => (c.severity.rules.stuck = 'high')), 'severity.rules.stuck');
  });

  it('rejects a missing flag severity', () => {
    expectInvalid(configWith((c) => delete c.severity.rules.vague), 'severity.rules.vague');
  });

  it('rejects unknown keys so typos surface', () => {
    expectInvalid(configWith((c) => (c.dueSoonDays = 3)), 'dueSoonDays');
    expectInvalid(configWith((c) => (c.severity.rules.overdew = 'critical')), 'overdew');
  });

  it('rejects a flag that belongs to two groups', () => {
    expectInvalid(
      configWith((c) => (c.severity.flagGroups.stalled = ['stuck', 'blocked'])),
      'severity.flagGroups.stalled',
      '"blocked" is already in group "blocked"',
    );
  });

  it('rejects an unknown flag name in a group', () => {
    expectInvalid(configWith((c) => (c.severity.flagGroups.blocked = ['blocked', 'flagged'])), 'severity.flagGroups');
  });

  it('rejects an impossible date', () => {
    expectInvalid(configWith((c) => (c.referenceDate = '2026-02-30')), 'referenceDate', 'YYYY-MM-DD');
  });

  it('validates the CLI --reference-date override too', () => {
    expect(() => parse(baseConfig, { overrides: { referenceDate: '10/12/2026' } })).toThrow(/--reference-date/);
  });

  it('rejects an unknown timezone', () => {
    expectInvalid(configWith((c) => (c.timezone = 'Mars/Olympus')), 'timezone');
  });

  it('requires a default stuck threshold', () => {
    expectInvalid(configWith((c) => delete c.stuckThresholdBusinessDays.default), 'stuckThresholdBusinessDays.default');
  });

  it('rejects non-positive stuck thresholds', () => {
    expectInvalid(configWith((c) => (c.stuckThresholdBusinessDays['In Review'] = 0)), 'In Review');
  });

  it('rejects invalid or duplicate working days', () => {
    expectInvalid(configWith((c) => (c.businessDays.workingDays = [0, 1])), 'businessDays.workingDays');
    expectInvalid(configWith((c) => (c.businessDays.workingDays = [1, 1, 2])), 'duplicate');
  });

  it('rejects an escalation count below 2', () => {
    expectInvalid(configWith((c) => (c.severity.escalateAtRiskCount = 1)), 'escalateAtRiskCount');
  });

  it('rejects a status that is both a bounce source and target', () => {
    expectInvalid(configWith((c) => c.bounce.toStatuses.push('In QA')), '"In QA" is in both');
  });

  it('rejects a refresh route through a bounce status', () => {
    expectInvalid(configWith((c) => (c.seed.refreshViaStatus = 'In Progress')), 'seed.refreshViaStatus', 'QA bounce');
  });

  it('rejects a malformed seed project key', () => {
    expectInvalid(configWith((c) => (c.seed.projectKey = 'scrum')), 'seed.projectKey');
  });

  it('rejects "ok" as an --apply level', () => {
    expectInvalid(configWith((c) => (c.apply.levels = ['ok'])), 'apply.levels');
  });

  it('lists every problem at once', () => {
    expectInvalid(
      configWith((c) => {
        c.jql = '';
        c.claude.batchSize = 0;
      }),
      'jql',
      'claude.batchSize',
    );
  });
});

describe('loadConfig', () => {
  it('loads config.json from disk', async () => {
    const cfg = await loadConfig('config.json', { now: NOW, systemTimezone: 'UTC' });
    expect(cfg.referenceDate).toBe('2026-10-01');
  });

  it('gives a clear error for a missing file', async () => {
    await expect(loadConfig('nope.json')).rejects.toThrow('Config file not found: nope.json');
  });
});
