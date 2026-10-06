/**
 * Calendar-date helpers for `YYYY-MM-DD` strings. Stay dates are property-local calendar
 * dates, so all arithmetic happens at UTC midnight and is never shifted by the viewer's zone.
 */

const DAY_MS = 86_400_000;

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function isIsoDate(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    utc(value).toISOString().startsWith(value)
  );
}

export function addDays(iso: string, days: number): string {
  return new Date(utc(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function nightsBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);
}

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });
const dayMonth = fmt({ day: 'numeric', month: 'short' });
const dayMonthYear = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const weekdayShort = fmt({ weekday: 'short' });
const monthYear = fmt({ month: 'long', year: 'numeric' });

/** "12 Oct" */
export const formatDayMonth = (iso: string) => dayMonth.format(utc(iso));
/** "12 Oct 2026" */
export const formatDate = (iso: string) => dayMonthYear.format(utc(iso));
/** "Mon" */
export const formatWeekday = (iso: string) => weekdayShort.format(utc(iso));
/** "October 2026" */
export const formatMonth = (iso: string) => monthYear.format(utc(iso));

export function isWeekend(iso: string): boolean {
  const day = utc(iso).getUTCDay();
  return day === 0 || day === 6;
}

/** "12 Oct – 15 Oct 2026 · 3 nights" for the half-open range [from, to). */
export function formatRange(from: string, to: string): string {
  const nights = nightsBetween(from, to);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? formatDayMonth(from) : formatDate(from)} – ${formatDate(to)} · ${nights} night${
    nights === 1 ? '' : 's'
  }`;
}
