// Date helpers shared by config and rules. Everything here is pure: dates are
// "YYYY-MM-DD" strings, and nothing reads the system clock.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True if `value` is a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** True if `timeZone` is an IANA time zone name the runtime knows, e.g. "Europe/Berlin". */
export function isValidTimezone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Shifts a YYYY-MM-DD date by whole calendar days. */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Moves `days` working days forward (positive) or back (negative) from `date`.
 * 0 returns `date` unchanged, even on a weekend.
 * @param {string} date - YYYY-MM-DD
 * @param {number} days
 * @param {number[]} workingDays - ISO weekdays, e.g. [1,2,3,4,5]
 */
export function addBusinessDays(date, days, workingDays) {
  if (!workingDays.length) throw new Error('workingDays must not be empty');
  const step = Math.sign(days);
  let result = date;
  for (let remaining = Math.abs(days); remaining > 0; ) {
    result = addDays(result, step);
    if (workingDays.includes(isoWeekday(result))) remaining--;
  }
  return result;
}

/** The calendar date (YYYY-MM-DD) that `instant` falls on in `timeZone`. */
export function dateInTimezone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
