import { DomainError } from '../errors.js';
import { LocalDate } from './local-date.js';

/**
 * A stay is the half-open interval [checkIn, checkOut) (BR-01).
 * Check-in 10 Oct, check-out 12 Oct occupies the nights of 10 and 11 Oct; 12 Oct is free.
 */
export class Stay {
  private constructor(
    readonly checkIn: LocalDate,
    readonly checkOut: LocalDate,
  ) {}

  static of(checkIn: LocalDate, checkOut: LocalDate): Stay {
    if (!checkOut.isAfter(checkIn)) {
      throw new DomainError(
        'INVALID_DATE_RANGE',
        `Check-out (${checkOut}) must be after check-in (${checkIn})`,
        { checkIn: checkIn.toString(), checkOut: checkOut.toString() },
      );
    }
    return new Stay(checkIn, checkOut);
  }

  static parse(checkIn: string, checkOut: string): Stay {
    return Stay.of(LocalDate.parse(checkIn), LocalDate.parse(checkOut));
  }

  get nights(): number {
    return this.checkIn.daysUntil(this.checkOut);
  }

  /** Last occupied night (checkOut − 1). */
  get lastNight(): LocalDate {
    return this.checkOut.minusDays(1);
  }

  nightDates(): LocalDate[] {
    return eachNight(this.checkIn, this.checkOut);
  }

  includesNight(date: LocalDate): boolean {
    return !date.isBefore(this.checkIn) && date.isBefore(this.checkOut);
  }

  overlaps(other: Stay): boolean {
    return this.checkIn.isBefore(other.checkOut) && other.checkIn.isBefore(this.checkOut);
  }

  toJSON(): { checkIn: string; checkOut: string; nights: number } {
    return {
      checkIn: this.checkIn.toString(),
      checkOut: this.checkOut.toString(),
      nights: this.nights,
    };
  }
}

/** Every night in [from, to). Empty when from ≥ to. */
export function eachNight(from: LocalDate, to: LocalDate): LocalDate[] {
  const nights: LocalDate[] = [];
  for (let d = from; d.isBefore(to); d = d.plusDays(1)) nights.push(d);
  return nights;
}

export interface StayPolicy {
  /** Nights must fall before businessDate + horizonDays (BR-05). */
  horizonDays: number;
  maxStayNights: number;
}

export interface StayRequestContext {
  businessDate: LocalDate;
  /** Holder of `booking.backdate` (BR-04). */
  allowBackdate: boolean;
}

export interface StayViolation {
  code: 'DATE_IN_PAST' | 'BEYOND_HORIZON' | 'STAY_TOO_LONG';
  message: string;
}

/** Property-policy checks for a new or modified stay (BR-04, BR-05). */
export function stayPolicyViolations(
  stay: Stay,
  policy: StayPolicy,
  context: StayRequestContext,
): StayViolation[] {
  const violations: StayViolation[] = [];
  if (stay.checkIn.isBefore(context.businessDate) && !context.allowBackdate) {
    violations.push({
      code: 'DATE_IN_PAST',
      message: `Check-in ${stay.checkIn} is before today's business date ${context.businessDate}`,
    });
  }
  const horizonEnd = context.businessDate.plusDays(policy.horizonDays);
  if (stay.checkOut.isAfter(horizonEnd)) {
    violations.push({
      code: 'BEYOND_HORIZON',
      message: `Bookings can be made up to ${policy.horizonDays} days ahead (check-out by ${horizonEnd})`,
    });
  }
  if (stay.nights > policy.maxStayNights) {
    violations.push({
      code: 'STAY_TOO_LONG',
      message: `Maximum stay is ${policy.maxStayNights} nights`,
    });
  }
  return violations;
}
