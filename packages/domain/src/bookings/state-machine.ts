import { DomainError } from '../errors.js';
import { LocalDate } from '../dates/local-date.js';
import type { Stay } from '../dates/stay.js';

/** Booking lifecycle (docs/09-booking-engine.md §2). */
export const BOOKING_STATUSES = [
  'INQUIRY',
  'TENTATIVE',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses a booking may be created in. CHECKED_IN is a walk-in. */
export const INITIAL_BOOKING_STATUSES = [
  'INQUIRY',
  'TENTATIVE',
  'CONFIRMED',
  'CHECKED_IN',
] as const;
export type InitialBookingStatus = (typeof INITIAL_BOOKING_STATUSES)[number];

export type BookingAction =
  'HOLD' | 'CONFIRM' | 'CANCEL' | 'EXPIRE' | 'CHECK_IN' | 'CHECK_OUT' | 'NO_SHOW';

const TRANSITIONS: Record<BookingAction, { from: readonly BookingStatus[]; to: BookingStatus }> = {
  HOLD: { from: ['INQUIRY'], to: 'TENTATIVE' },
  CONFIRM: { from: ['INQUIRY', 'TENTATIVE'], to: 'CONFIRMED' },
  CANCEL: { from: ['INQUIRY', 'TENTATIVE', 'CONFIRMED'], to: 'CANCELLED' },
  EXPIRE: { from: ['TENTATIVE'], to: 'EXPIRED' },
  CHECK_IN: { from: ['CONFIRMED'], to: 'CHECKED_IN' },
  CHECK_OUT: { from: ['CHECKED_IN'], to: 'CHECKED_OUT' },
  NO_SHOW: { from: ['CONFIRMED'], to: 'NO_SHOW' },
};

const TERMINAL: ReadonlySet<BookingStatus> = new Set([
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL.has(status);
}

export function canApply(status: BookingStatus, action: BookingAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

/** The status after `action`, or INVALID_STATUS_TRANSITION (BR-13). */
export function nextStatus(status: BookingStatus, action: BookingAction): BookingStatus {
  if (!canApply(status, action)) {
    throw new DomainError(
      'INVALID_STATUS_TRANSITION',
      `Cannot ${action.toLowerCase().replace('_', '-')} a booking that is ${status.toLowerCase().replace('_', '-')}`,
      { status, action },
    );
  }
  return TRANSITIONS[action].to;
}

export type LineInventoryBucket = 'BOOKED' | 'HELD' | 'NONE';

/** Which bucket the active lines of a booking in `status` consume for future nights (BR-06). */
export function inventoryBucketFor(status: BookingStatus): LineInventoryBucket {
  switch (status) {
    case 'TENTATIVE':
      return 'HELD';
    case 'CONFIRMED':
    case 'CHECKED_IN':
      return 'BOOKED';
    default:
      return 'NONE';
  }
}

/**
 * First night to release when a line stops consuming inventory (cancel, no-show, expiry,
 * early departure): past nights stay recorded as history (BR-14, BR-15).
 * Returns `invTo` when nothing is left to release.
 */
export function releaseFrom(
  invFrom: LocalDate,
  invTo: LocalDate,
  businessDate: LocalDate,
): LocalDate {
  return LocalDate.min(LocalDate.max(invFrom, businessDate), invTo);
}

/** Check-in is allowed on any business date within the stay (late arrivals included). */
export function assertCanCheckIn(status: BookingStatus, stay: Stay, businessDate: LocalDate): void {
  nextStatus(status, 'CHECK_IN');
  if (businessDate.isBefore(stay.checkIn) || !businessDate.isBefore(stay.checkOut)) {
    throw new DomainError(
      'CHECK_IN_NOT_ALLOWED',
      `Check-in is possible from ${stay.checkIn} until ${stay.lastNight}; today is ${businessDate}`,
    );
  }
}

/** A walk-in is created checked-in and must arrive today. */
export function assertWalkInDates(stay: Stay, businessDate: LocalDate): void {
  if (!stay.checkIn.equals(businessDate)) {
    throw new DomainError('CHECK_IN_NOT_ALLOWED', `A walk-in must start today (${businessDate})`);
  }
}

export interface CheckOutPlan {
  /** Nights from this date are released (early departure); null when leaving on schedule. */
  releaseFrom: LocalDate | null;
}

export function planCheckOut(
  status: BookingStatus,
  stay: Stay,
  businessDate: LocalDate,
): CheckOutPlan {
  nextStatus(status, 'CHECK_OUT');
  if (businessDate.isAfter(stay.checkOut)) {
    throw new DomainError(
      'OVERSTAY_REQUIRES_EXTENSION',
      `The stay ended on ${stay.checkOut}; extend it before checking out`,
    );
  }
  return { releaseFrom: businessDate.isBefore(stay.checkOut) ? businessDate : null };
}

export function assertCanMarkNoShow(
  status: BookingStatus,
  stay: Stay,
  businessDate: LocalDate,
): void {
  nextStatus(status, 'NO_SHOW');
  if (businessDate.isBefore(stay.checkIn)) {
    throw new DomainError(
      'NO_SHOW_NOT_ALLOWED',
      `A no-show can be recorded from the arrival date (${stay.checkIn})`,
    );
  }
}
