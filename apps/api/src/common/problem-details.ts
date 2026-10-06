import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import { DomainError } from '@staydesk/domain';
import { Prisma } from '@staydesk/db';
import {
  ERROR_STATUS,
  errorTypeUri,
  type ErrorCode,
  type FieldIssue,
  type ProblemDetails,
} from '@staydesk/contracts';
import { ApiError } from './api-error.js';

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'The request is not valid',
  NO_AVAILABILITY: 'Not enough rooms available',
  NOT_FOUND: 'Not found',
  UNAUTHENTICATED: 'Please sign in',
  FORBIDDEN: 'You do not have permission to do this',
  RATE_LIMITED: 'Too many requests',
  CONFLICT_RETRY: 'The system is busy, please try again',
  INTERNAL_ERROR: 'Something went wrong',
};

function titleFor(code: ErrorCode): string {
  const title = TITLES[code];
  if (title) return title;
  const words = code.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ProblemResult {
  status: number;
  body: ProblemDetails;
  /** Unexpected errors are logged at error level with the original error. */
  unexpected: boolean;
}

function problem(
  code: ErrorCode,
  requestId: string,
  detail?: string,
  extras: { errors?: FieldIssue[]; meta?: Record<string, unknown> } = {},
): ProblemDetails {
  return {
    type: errorTypeUri(code),
    title: titleFor(code),
    status: ERROR_STATUS[code],
    code,
    ...(detail === undefined ? {} : { detail }),
    requestId,
    errors: extras.errors ?? [],
    ...(extras.meta === undefined ? {} : { meta: extras.meta }),
  };
}

const zodIssues = (error: ZodError): FieldIssue[] =>
  error.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    code: i.code,
    message: i.message,
  }));

function codeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
    case 405:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
  }
}

/**
 * Maps any thrown value to an RFC 9457 problem (docs/06 §2). Messages of unexpected errors are
 * never exposed: clients get a generic message and the request id to quote to support.
 */
export function toProblem(error: unknown, requestId: string): ProblemResult {
  if (error instanceof ApiError) {
    return {
      status: ERROR_STATUS[error.code],
      body: problem(error.code, requestId, error.message, error.details),
      unexpected: false,
    };
  }
  if (error instanceof DomainError) {
    const meta = error.meta === undefined ? undefined : { ...error.meta };
    return {
      status: ERROR_STATUS[error.code],
      body: problem(error.code, requestId, error.message, meta ? { meta } : {}),
      unexpected: false,
    };
  }
  // A unique constraint caught a race the service-level pre-check could not (two concurrent
  // creates). Reported generically: constraint names must not leak.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return {
      status: 409,
      body: problem('ALREADY_EXISTS', requestId, 'This already exists; refresh and try again'),
      unexpected: false,
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 422,
      body: problem('VALIDATION_FAILED', requestId, undefined, { errors: zodIssues(error) }),
      unexpected: false,
    };
  }

  // Framework errors: Nest HttpExceptions and Fastify errors carrying a statusCode.
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

  if (status >= 400 && status < 500) {
    const code = codeForHttpStatus(status);
    const detail =
      status === 413
        ? 'The request body is too large'
        : status === 404
          ? 'No such resource'
          : undefined;
    return {
      status: ERROR_STATUS[code],
      body: problem(code, requestId, detail),
      unexpected: false,
    };
  }
  return { status: 500, body: problem('INTERNAL_ERROR', requestId), unexpected: true };
}
