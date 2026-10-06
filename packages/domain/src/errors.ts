/**
 * Business-rule failures. Codes are stable and map 1:1 to the API error catalogue
 * (docs/06-api-architecture.md §5), so callers can translate without string matching.
 */
export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_DATE_RANGE'
  | 'DATE_IN_PAST'
  | 'BEYOND_HORIZON'
  | 'STAY_TOO_LONG'
  | 'OCCUPANCY_EXCEEDED'
  | 'NO_AVAILABILITY'
  | 'INVENTORY_CONFLICT'
  | 'CLOSED_FOR_SALE'
  | 'INVALID_STATUS_TRANSITION'
  | 'CHECK_IN_NOT_ALLOWED'
  | 'NO_SHOW_NOT_ALLOWED'
  | 'OVERSTAY_REQUIRES_EXTENSION';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly meta?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/**
 * A programming error: the caller broke a precondition the domain relies on
 * (e.g. releasing inventory that was never consumed). Never shown to end users.
 */
export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolationError';
  }
}
