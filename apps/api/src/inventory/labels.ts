import type { LocalDate } from '@staydesk/domain';

/** Wording for audit summaries; dates are property-local calendar dates. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10 Oct 2026" */
export function describeDay(date: LocalDate): string {
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** "10 Oct – 12 Oct 2026 (2 nights)" for the half-open range [start, end). */
export function describeRange(start: LocalDate, end: LocalDate): string {
  const nights = start.daysUntil(end);
  const first =
    start.year === end.year ? `${start.day} ${MONTHS[start.month - 1]}` : describeDay(start);
  return `${first} – ${describeDay(end)} (${nights} night${nights === 1 ? '' : 's'})`;
}
