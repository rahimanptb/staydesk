/**
 * Browser-side API client. All calls go to the same origin (`/api/v1`), so the session cookie
 * travels automatically; unsafe requests carry the session's CSRF token (docs/10 §5).
 */

export interface FieldErrors {
  [field: string]: string;
}

/** An RFC 9457 problem returned by the API, with field errors keyed by path. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldErrors = {},
    readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

let csrfToken: string | null = null;

/** Seeds the CSRF token from server-rendered session data. */
export function setCsrfToken(token: string | null | undefined): void {
  if (token) csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface ProblemBody {
  code?: string;
  detail?: string;
  title?: string;
  errors?: Array<{ path: string; message: string }>;
  meta?: Record<string, unknown>;
}

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: { headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiProblem(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problem = (data ?? {}) as ProblemBody;
    const fieldErrors: FieldErrors = {};
    for (const issue of problem.errors ?? []) {
      if (issue.path && !fieldErrors[issue.path]) fieldErrors[issue.path] = issue.message;
    }
    throw new ApiProblem(
      response.status,
      problem.code ?? 'INTERNAL_ERROR',
      problem.detail ?? problem.title ?? 'Something went wrong. Please try again.',
      fieldErrors,
      problem.meta ?? {},
    );
  }

  if (
    data &&
    typeof data === 'object' &&
    'csrfToken' in data &&
    typeof data.csrfToken === 'string'
  ) {
    csrfToken = data.csrfToken;
  }
  return data as T;
}

/** A user-facing message for any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.code === 'RATE_LIMITED')
      return 'Too many attempts. Please wait a minute and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
