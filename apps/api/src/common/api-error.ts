import type { ErrorCode, FieldIssue } from '@staydesk/contracts';

/**
 * An expected failure with a stable public code (docs/06 §5). Throw this from application code;
 * the problem-details filter turns it into the HTTP response.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: { meta?: Record<string, unknown>; errors?: FieldIssue[] } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
