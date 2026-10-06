import { z } from 'zod';

/** API error catalogue (docs/06-api-architecture.md §5): code → HTTP status. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 422,
  INVALID_DATE_RANGE: 422,
  DATE_IN_PAST: 422,
  BEYOND_HORIZON: 422,
  STAY_TOO_LONG: 422,
  OCCUPANCY_EXCEEDED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  NO_AVAILABILITY: 409,
  INVENTORY_CONFLICT: 409,
  CLOSED_FOR_SALE: 409,
  DUPLICATE_BOOKING_SUSPECTED: 409,
  INVALID_STATUS_TRANSITION: 409,
  CHECK_IN_NOT_ALLOWED: 409,
  NO_SHOW_NOT_ALLOWED: 409,
  OVERSTAY_REQUIRES_EXTENSION: 409,
  ROOM_ASSIGNMENT_REQUIRED: 409,
  ROOM_UNAVAILABLE: 409,
  ROOM_UNAVAILABLE_FOR_NEW_DATES: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PRECONDITION_FAILED: 412,
  PRECONDITION_REQUIRED: 428,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  TENANT_SUSPENDED: 403,
  ACCOUNT_DISABLED: 403,
  AGENCY_ACCESS_PENDING: 403,
  AGENCY_ACCESS_SUSPENDED: 403,
  AGENCY_ACCESS_EXPIRED: 403,
  AGENCY_ACCESS_REJECTED: 403,
  PLAN_LIMIT_REACHED: 403,
  FEATURE_NOT_IN_PLAN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT_RETRY: 503,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_STATUS, value);
}

export const fieldIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

/** RFC 9457 problem details with StayDesk extensions. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
  detail: z.string().optional(),
  requestId: z.string(),
  errors: z.array(fieldIssueSchema).default([]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type FieldIssue = z.infer<typeof fieldIssueSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const ERROR_TYPE_BASE = 'https://docs.staydesk.app/errors/';

export function errorTypeUri(code: ErrorCode): string {
  return ERROR_TYPE_BASE + code.toLowerCase().replaceAll('_', '-');
}
