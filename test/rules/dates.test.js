import { describe, expect, it } from 'vitest';
import { dateInTimezone, isIsoDate, isValidTimezone } from '../../src/rules/dates.js';

describe('isIsoDate', () => {
  it('accepts real dates, including leap days', () => {
    expect(isIsoDate('2026-09-30')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects impossible dates and other formats', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-9-30')).toBe(false);
    expect(isIsoDate('30.09.2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('isValidTimezone', () => {
  it('knows IANA names and rejects made-up ones', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('dateInTimezone', () => {
  it('returns the local calendar date for an instant', () => {
    const instant = '2026-10-01T00:30:00Z';
    expect(dateInTimezone(instant, 'UTC')).toBe('2026-10-01');
    expect(dateInTimezone(instant, 'America/New_York')).toBe('2026-09-30');
    expect(dateInTimezone(instant, 'Asia/Tokyo')).toBe('2026-10-01');
  });

  it('handles Jira-style timestamps with an offset', () => {
    expect(dateInTimezone('2026-09-29T23:15:00.000+0200', 'UTC')).toBe('2026-09-29');
    expect(dateInTimezone('2026-09-29T23:15:00.000+0200', 'Europe/Berlin')).toBe('2026-09-29');
  });
});
