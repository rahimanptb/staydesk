import { describe, expect, it } from 'vitest';
import { InvariantViolationError } from '../errors.js';
import { formatBookingReference, isValidBookingPrefix } from './reference.js';

describe('formatBookingReference (BR-19)', () => {
  it('formats prefix, two-digit year and padded sequence', () => {
    expect(formatBookingReference('GOA', 2026, 4217)).toBe('GOA-26-004217');
    expect(formatBookingReference('SV1', 2100, 1)).toBe('SV1-00-000001');
    expect(formatBookingReference('AB', 2026, 1234567)).toBe('AB-26-1234567');
  });

  it('rejects bad prefixes and sequences', () => {
    expect(() => formatBookingReference('goa', 2026, 1)).toThrow(InvariantViolationError);
    expect(() => formatBookingReference('G', 2026, 1)).toThrow(InvariantViolationError);
    expect(() => formatBookingReference('GOA', 2026, 0)).toThrow(InvariantViolationError);
    expect(isValidBookingPrefix('SEAVIEW')).toBe(true);
    expect(isValidBookingPrefix('SEA-VIEW')).toBe(false);
  });
});
