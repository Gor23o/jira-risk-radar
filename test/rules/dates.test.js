import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addDays,
  businessDaysBetween,
  dateInTimezone,
  daysBetween,
  isIsoDate,
  isoWeekday,
  isValidTimezone,
} from '../../src/rules/dates.js';

const MON_FRI = [1, 2, 3, 4, 5];

describe('isoWeekday / addDays', () => {
  it('numbers weekdays Monday=1 to Sunday=7', () => {
    expect(isoWeekday('2026-09-28')).toBe(1); // Monday
    expect(isoWeekday('2026-10-04')).toBe(7); // Sunday
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('businessDaysBetween', () => {
  it('is 0 for the same day, in either direction, and within a weekend', () => {
    expect(businessDaysBetween('2026-10-01', '2026-10-01', MON_FRI)).toBe(0);
    expect(businessDaysBetween('2026-10-05', '2026-10-01', MON_FRI)).toBe(0);
    expect(businessDaysBetween('2026-10-03', '2026-10-04', MON_FRI)).toBe(0); // Sat -> Sun
  });

  it('skips weekend spans', () => {
    expect(businessDaysBetween('2026-10-02', '2026-10-05', MON_FRI)).toBe(1); // Fri -> Mon
    expect(businessDaysBetween('2026-09-30', '2026-10-08', MON_FRI)).toBe(6); // Wed -> next Thu
  });

  it('counts from a Saturday start and to a Sunday end', () => {
    expect(businessDaysBetween('2026-10-03', '2026-10-06', MON_FRI)).toBe(2); // Sat -> Tue: Mon, Tue
    expect(businessDaysBetween('2026-10-01', '2026-10-04', MON_FRI)).toBe(1); // Thu -> Sun: Fri
  });

  it('is the inverse of addBusinessDays', () => {
    for (const n of [1, 3, 6, 11]) {
      expect(businessDaysBetween('2026-09-30', addBusinessDays('2026-09-30', n, MON_FRI), MON_FRI)).toBe(n);
    }
  });
});

describe('daysBetween', () => {
  it('counts calendar days, negative when going back', () => {
    expect(daysBetween('2026-09-28', '2026-09-30')).toBe(2);
    expect(daysBetween('2026-09-30', '2026-09-28')).toBe(-2);
  });
});

describe('addBusinessDays', () => {
  it('skips weekends going forward', () => {
    expect(addBusinessDays('2026-10-01', 1, MON_FRI)).toBe('2026-10-02'); // Thu -> Fri
    expect(addBusinessDays('2026-10-02', 1, MON_FRI)).toBe('2026-10-05'); // Fri -> Mon
    expect(addBusinessDays('2026-09-30', 6, MON_FRI)).toBe('2026-10-08'); // Wed + 6 = next Thu
  });

  it('skips weekends going back', () => {
    expect(addBusinessDays('2026-10-05', -1, MON_FRI)).toBe('2026-10-02'); // Mon -> Fri
    expect(addBusinessDays('2026-10-01', -3, MON_FRI)).toBe('2026-09-28');
  });

  it('starting on a weekend, lands on the next working day', () => {
    expect(addBusinessDays('2026-10-03', 1, MON_FRI)).toBe('2026-10-05'); // Sat -> Mon
  });

  it('returns the same date for 0', () => {
    expect(addBusinessDays('2026-10-03', 0, MON_FRI)).toBe('2026-10-03');
  });

  it('respects a custom working week', () => {
    expect(addBusinessDays('2026-10-01', 1, [7, 1, 2, 3, 4])).toBe('2026-10-04'); // Thu -> Sun (Sun–Thu week)
  });
});

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
