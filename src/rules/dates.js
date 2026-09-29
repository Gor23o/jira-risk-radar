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
