import { DomainError } from '../errors.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 9999;

/** Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's algorithm). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12; // March = 0
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(epochDay: number): [year: number, month: number, day: number] {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return [year, month, day];
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * A calendar date with no time and no timezone: the type of every stay date (BR-02).
 * Stay dates must never be represented with JavaScript `Date`, whose instant semantics
 * shift dates across timezones.
 */
export class LocalDate {
  private constructor(readonly epochDay: number) {}

  static fromEpochDay(epochDay: number): LocalDate {
    if (!Number.isSafeInteger(epochDay)) {
      throw new DomainError('VALIDATION_FAILED', `Invalid epoch day: ${epochDay}`);
    }
    return new LocalDate(epochDay);
  }

  static of(year: number, month: number, day: number): LocalDate {
    const date = LocalDate.tryOf(year, month, day);
    if (!date) {
      throw new DomainError('VALIDATION_FAILED', `Invalid date: ${year}-${month}-${day}`);
    }
    return date;
  }

  static tryOf(year: number, month: number, day: number): LocalDate | null {
    if (![year, month, day].every(Number.isInteger)) return null;
    if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const epochDay = daysFromCivil(year, month, day);
    const [y, m, d] = civilFromDays(epochDay);
    // Round-trip rejects impossible dates such as 2026-02-30 (which would normalise to March).
    return y === year && m === month && d === day ? new LocalDate(epochDay) : null;
  }

  /** Parses strict ISO `YYYY-MM-DD`. */
  static parse(value: string): LocalDate {
    const date = LocalDate.tryParse(value);
    if (!date) {
      throw new DomainError('VALIDATION_FAILED', `Invalid date "${value}", expected YYYY-MM-DD`);
    }
    return date;
  }

  static tryParse(value: string): LocalDate | null {
    const match = ISO_DATE.exec(value);
    if (!match) return null;
    return LocalDate.tryOf(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  static isValid(value: string): boolean {
    return LocalDate.tryParse(value) !== null;
  }

  /**
   * The calendar date at `instant` in an IANA timezone, i.e. a property's business date (BR-03).
   * Throws for unknown timezones.
   */
  static todayIn(timeZone: string, instant: Date = new Date()): LocalDate {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    return LocalDate.of(get('year'), get('month'), get('day'));
  }

  get year(): number {
    return civilFromDays(this.epochDay)[0];
  }

  get month(): number {
    return civilFromDays(this.epochDay)[1];
  }

  get day(): number {
    return civilFromDays(this.epochDay)[2];
  }

  /** ISO day of week: 1 = Monday … 7 = Sunday. */
  get dayOfWeek(): number {
    // 1970-01-01 was a Thursday (4).
    return ((((this.epochDay + 3) % 7) + 7) % 7) + 1;
  }

  plusDays(days: number): LocalDate {
    return LocalDate.fromEpochDay(this.epochDay + days);
  }

  minusDays(days: number): LocalDate {
    return LocalDate.fromEpochDay(this.epochDay - days);
  }

  /** Number of days from this date to `other` (positive if `other` is later). */
  daysUntil(other: LocalDate): number {
    return other.epochDay - this.epochDay;
  }

  compareTo(other: LocalDate): number {
    return this.epochDay - other.epochDay;
  }

  equals(other: LocalDate): boolean {
    return this.epochDay === other.epochDay;
  }

  isBefore(other: LocalDate): boolean {
    return this.epochDay < other.epochDay;
  }

  isAfter(other: LocalDate): boolean {
    return this.epochDay > other.epochDay;
  }

  static max(a: LocalDate, b: LocalDate): LocalDate {
    return a.epochDay >= b.epochDay ? a : b;
  }

  static min(a: LocalDate, b: LocalDate): LocalDate {
    return a.epochDay <= b.epochDay ? a : b;
  }

  toString(): string {
    const [y, m, d] = civilFromDays(this.epochDay);
    return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
