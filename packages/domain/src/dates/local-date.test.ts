import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { LocalDate, isValidTimeZone } from './local-date.js';

describe('LocalDate', () => {
  it('round-trips ISO strings', () => {
    for (const s of ['1970-01-01', '2026-10-05', '2000-02-29', '9999-12-31', '1900-01-01']) {
      expect(LocalDate.parse(s).toString()).toBe(s);
    }
  });

  it('anchors epoch day 0 at 1970-01-01', () => {
    expect(LocalDate.parse('1970-01-01').epochDay).toBe(0);
    expect(LocalDate.fromEpochDay(-1).toString()).toBe('1969-12-31');
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '26-01-01',
    '2026-1-1',
    '',
    '2026-10-05T00:00',
    '1899-12-31',
  ])('rejects invalid date %j', (s) => {
    expect(LocalDate.tryParse(s)).toBeNull();
    expect(() => LocalDate.parse(s)).toThrow(DomainError);
  });

  it('handles leap years including century rules (DT-04)', () => {
    expect(LocalDate.isValid('2028-02-29')).toBe(true);
    expect(LocalDate.isValid('2027-02-29')).toBe(false);
    expect(LocalDate.isValid('2000-02-29')).toBe(true);
    expect(LocalDate.isValid('2100-02-29')).toBe(false);
    expect(LocalDate.parse('2028-02-28').plusDays(1).toString()).toBe('2028-02-29');
    expect(LocalDate.parse('2028-02-28').daysUntil(LocalDate.parse('2028-03-01'))).toBe(2);
  });

  it('crosses month and year boundaries', () => {
    expect(LocalDate.parse('2026-12-31').plusDays(1).toString()).toBe('2027-01-01');
    expect(LocalDate.parse('2026-03-01').minusDays(1).toString()).toBe('2026-02-28');
    expect(LocalDate.parse('2026-01-01').plusDays(365).toString()).toBe('2027-01-01');
  });

  it('exposes parts and ISO day of week', () => {
    const d = LocalDate.parse('2026-10-05');
    expect([d.year, d.month, d.day]).toEqual([2026, 10, 5]);
    expect(d.dayOfWeek).toBe(1); // Monday
    expect(LocalDate.parse('1970-01-01').dayOfWeek).toBe(4); // Thursday
    expect(LocalDate.parse('1969-12-28').dayOfWeek).toBe(7); // Sunday
  });

  it('compares dates', () => {
    const a = LocalDate.parse('2026-10-10');
    const b = LocalDate.parse('2026-10-12');
    expect(a.isBefore(b)).toBe(true);
    expect(b.isAfter(a)).toBe(true);
    expect(a.equals(LocalDate.parse('2026-10-10'))).toBe(true);
    expect(LocalDate.max(a, b)).toBe(b);
    expect(LocalDate.min(a, b)).toBe(a);
    expect(Math.sign(a.compareTo(b))).toBe(-1);
  });

  it('serialises to JSON as an ISO date', () => {
    expect(JSON.stringify({ d: LocalDate.parse('2026-10-05') })).toBe('{"d":"2026-10-05"}');
  });

  describe('todayIn (business date, DT-03)', () => {
    const instant = new Date('2026-10-05T23:30:00Z');

    it('uses the property timezone, not UTC', () => {
      expect(LocalDate.todayIn('UTC', instant).toString()).toBe('2026-10-05');
      expect(LocalDate.todayIn('Asia/Kolkata', instant).toString()).toBe('2026-10-06');
      expect(LocalDate.todayIn('America/New_York', instant).toString()).toBe('2026-10-05');
    });

    it('handles timezone extremes around UTC midnight', () => {
      const t = new Date('2026-10-05T10:30:00Z');
      expect(LocalDate.todayIn('Pacific/Kiritimati', t).toString()).toBe('2026-10-06'); // UTC+14
      expect(LocalDate.todayIn('Pacific/Pago_Pago', t).toString()).toBe('2026-10-04'); // UTC−11
    });

    it('rejects unknown timezones', () => {
      expect(() => LocalDate.todayIn('Mars/Olympus_Mons', instant)).toThrow(RangeError);
      expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
      expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    });
  });
});
