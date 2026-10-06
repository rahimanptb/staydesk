import { describe, expect, it } from 'vitest';
import { LocalDate } from './local-date.js';
import { Stay, eachNight, stayPolicyViolations } from './stay.js';

const d = LocalDate.parse;

describe('Stay (BR-01 half-open interval)', () => {
  it('occupies check-in up to but not including check-out', () => {
    const stay = Stay.parse('2026-10-10', '2026-10-12');
    expect(stay.nights).toBe(2);
    expect(stay.nightDates().map(String)).toEqual(['2026-10-10', '2026-10-11']);
    expect(stay.includesNight(d('2026-10-12'))).toBe(false);
    expect(stay.lastNight.toString()).toBe('2026-10-11');
  });

  it('rejects zero-night and reversed stays (DT-02)', () => {
    expect(() => Stay.parse('2026-10-10', '2026-10-10')).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
    );
    expect(() => Stay.parse('2026-10-12', '2026-10-10')).toThrow(
      expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
    );
  });

  it('back-to-back stays do not overlap (DT-01)', () => {
    const a = Stay.parse('2026-10-10', '2026-10-12');
    const b = Stay.parse('2026-10-12', '2026-10-14');
    expect(a.overlaps(b)).toBe(false);
    expect(b.overlaps(a)).toBe(false);
    expect(a.overlaps(Stay.parse('2026-10-11', '2026-10-13'))).toBe(true);
    expect(a.overlaps(Stay.parse('2026-10-01', '2026-10-30'))).toBe(true);
  });

  it('counts nights across leap day and year end (DT-04)', () => {
    expect(Stay.parse('2028-02-28', '2028-03-01').nights).toBe(2);
    expect(Stay.parse('2026-12-30', '2027-01-02').nights).toBe(3);
  });

  it('serialises with night count', () => {
    expect(JSON.parse(JSON.stringify(Stay.parse('2026-10-10', '2026-10-12')))).toEqual({
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      nights: 2,
    });
  });

  it('eachNight is empty for empty ranges', () => {
    expect(eachNight(d('2026-10-10'), d('2026-10-10'))).toEqual([]);
    expect(eachNight(d('2026-10-11'), d('2026-10-10'))).toEqual([]);
  });
});

describe('stayPolicyViolations (BR-04, BR-05, DT-05)', () => {
  const policy = { horizonDays: 730, maxStayNights: 90 };
  const businessDate = d('2026-10-05');
  const codes = (stay: Stay, allowBackdate = false) =>
    stayPolicyViolations(stay, policy, { businessDate, allowBackdate }).map((v) => v.code);

  it('accepts a normal future stay and a walk-in starting today', () => {
    expect(codes(Stay.parse('2026-10-10', '2026-10-12'))).toEqual([]);
    expect(codes(Stay.parse('2026-10-05', '2026-10-06'))).toEqual([]);
  });

  it('rejects stays starting in the past unless back-dating is allowed', () => {
    const stay = Stay.parse('2026-10-04', '2026-10-06');
    expect(codes(stay)).toEqual(['DATE_IN_PAST']);
    expect(codes(stay, true)).toEqual([]);
  });

  it('enforces the booking horizon on check-out', () => {
    const horizonEnd = businessDate.plusDays(730);
    expect(codes(Stay.of(horizonEnd.minusDays(1), horizonEnd))).toEqual([]);
    expect(codes(Stay.of(horizonEnd, horizonEnd.plusDays(1)))).toEqual(['BEYOND_HORIZON']);
  });

  it('enforces maximum stay length', () => {
    const start = d('2026-11-01');
    expect(codes(Stay.of(start, start.plusDays(90)))).toEqual([]);
    expect(codes(Stay.of(start, start.plusDays(91)))).toEqual(['STAY_TOO_LONG']);
  });
});
