import { InvariantViolationError } from '../errors.js';

const PREFIX = /^[A-Z0-9]{2,8}$/;

/**
 * Human booking reference: `{PREFIX}-{YY}-{sequence:06}`, e.g. `GOA-26-004217` (BR-19).
 * The sequence is per property and never reused; the year is the property's business year.
 */
export function formatBookingReference(prefix: string, year: number, sequence: number): string {
  if (!PREFIX.test(prefix)) {
    throw new InvariantViolationError(
      `Booking prefix must be 2–8 uppercase letters/digits, got "${prefix}"`,
    );
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new InvariantViolationError(
      `Booking sequence must be a positive integer, got ${sequence}`,
    );
  }
  const yy = String(year % 100).padStart(2, '0');
  return `${prefix}-${yy}-${String(sequence).padStart(6, '0')}`;
}

export function isValidBookingPrefix(prefix: string): boolean {
  return PREFIX.test(prefix);
}
