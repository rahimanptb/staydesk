import { describe, expect, it } from 'vitest';
import { LocalDate } from '../dates/local-date.js';
import { Stay } from '../dates/stay.js';
import {
  BOOKING_STATUSES,
  assertCanCheckIn,
  assertCanMarkNoShow,
  assertWalkInDates,
  canApply,
  inventoryBucketFor,
  isTerminal,
  nextStatus,
  planCheckOut,
  releaseFrom,
} from './state-machine.js';

const d = LocalDate.parse;
const stay = Stay.parse('2026-10-10', '2026-10-13');

describe('booking state machine (BR-13)', () => {
  it('follows the documented transitions', () => {
    expect(nextStatus('INQUIRY', 'HOLD')).toBe('TENTATIVE');
    expect(nextStatus('TENTATIVE', 'CONFIRM')).toBe('CONFIRMED');
    expect(nextStatus('INQUIRY', 'CONFIRM')).toBe('CONFIRMED');
    expect(nextStatus('TENTATIVE', 'EXPIRE')).toBe('EXPIRED');
    expect(nextStatus('CONFIRMED', 'CHECK_IN')).toBe('CHECKED_IN');
    expect(nextStatus('CHECKED_IN', 'CHECK_OUT')).toBe('CHECKED_OUT');
    expect(nextStatus('CONFIRMED', 'NO_SHOW')).toBe('NO_SHOW');
    expect(nextStatus('CONFIRMED', 'CANCEL')).toBe('CANCELLED');
  });

  it('rejects invalid transitions with a stable code (CN-03)', () => {
    expect(() => nextStatus('CANCELLED', 'CANCEL')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
    expect(() => nextStatus('CHECKED_IN', 'CANCEL')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
    expect(() => nextStatus('TENTATIVE', 'CHECK_IN')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
  });

  it('allows no action out of terminal states', () => {
    for (const status of BOOKING_STATUSES.filter(isTerminal)) {
      for (const action of [
        'HOLD',
        'CONFIRM',
        'CANCEL',
        'EXPIRE',
        'CHECK_IN',
        'CHECK_OUT',
        'NO_SHOW',
      ] as const) {
        expect(canApply(status, action)).toBe(false);
      }
    }
  });

  it('maps statuses to inventory buckets (BR-06)', () => {
    expect(inventoryBucketFor('INQUIRY')).toBe('NONE');
    expect(inventoryBucketFor('TENTATIVE')).toBe('HELD');
    expect(inventoryBucketFor('CONFIRMED')).toBe('BOOKED');
    expect(inventoryBucketFor('CHECKED_IN')).toBe('BOOKED');
    for (const s of ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as const) {
      expect(inventoryBucketFor(s)).toBe('NONE');
    }
  });
});

describe('releaseFrom (BR-14, BR-15, CN-01)', () => {
  it('never releases past nights', () => {
    expect(releaseFrom(d('2026-10-10'), d('2026-10-13'), d('2026-10-05')).toString()).toBe(
      '2026-10-10',
    );
    expect(releaseFrom(d('2026-10-10'), d('2026-10-13'), d('2026-10-11')).toString()).toBe(
      '2026-10-11',
    );
    expect(releaseFrom(d('2026-10-10'), d('2026-10-13'), d('2026-10-20')).toString()).toBe(
      '2026-10-13',
    );
  });
});

describe('front desk (FD-01, FD-02)', () => {
  it('allows check-in from arrival until the last night', () => {
    expect(() => assertCanCheckIn('CONFIRMED', stay, d('2026-10-09'))).toThrow(
      expect.objectContaining({ code: 'CHECK_IN_NOT_ALLOWED' }),
    );
    expect(() => assertCanCheckIn('CONFIRMED', stay, d('2026-10-10'))).not.toThrow();
    expect(() => assertCanCheckIn('CONFIRMED', stay, d('2026-10-12'))).not.toThrow();
    expect(() => assertCanCheckIn('CONFIRMED', stay, d('2026-10-13'))).toThrow(
      expect.objectContaining({ code: 'CHECK_IN_NOT_ALLOWED' }),
    );
    expect(() => assertCanCheckIn('TENTATIVE', stay, d('2026-10-10'))).toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
  });

  it('requires walk-ins to start today', () => {
    expect(() => assertWalkInDates(stay, d('2026-10-10'))).not.toThrow();
    expect(() => assertWalkInDates(stay, d('2026-10-09'))).toThrow(
      expect.objectContaining({ code: 'CHECK_IN_NOT_ALLOWED' }),
    );
  });

  it('plans early, on-time and overstay check-outs', () => {
    expect(planCheckOut('CHECKED_IN', stay, d('2026-10-11')).releaseFrom?.toString()).toBe(
      '2026-10-11',
    );
    expect(planCheckOut('CHECKED_IN', stay, d('2026-10-13')).releaseFrom).toBeNull();
    expect(() => planCheckOut('CHECKED_IN', stay, d('2026-10-14'))).toThrow(
      expect.objectContaining({ code: 'OVERSTAY_REQUIRES_EXTENSION' }),
    );
  });

  it('allows no-show only from the arrival date', () => {
    expect(() => assertCanMarkNoShow('CONFIRMED', stay, d('2026-10-09'))).toThrow(
      expect.objectContaining({ code: 'NO_SHOW_NOT_ALLOWED' }),
    );
    expect(() => assertCanMarkNoShow('CONFIRMED', stay, d('2026-10-10'))).not.toThrow();
  });
});
