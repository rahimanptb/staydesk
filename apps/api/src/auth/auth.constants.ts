import type { PortalContext } from '@staydesk/contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Session lifetimes per portal (docs/10 §2). */
export const SESSION_POLICY: Record<PortalContext, { idleMs: number; absoluteMs: number }> = {
  TENANT: { idleMs: 8 * HOUR, absoluteMs: 7 * DAY },
  AGENCY: { idleMs: 2 * HOUR, absoluteMs: 7 * DAY },
  PLATFORM: { idleMs: 30 * MINUTE, absoluteMs: 12 * HOUR },
};

/** last_seen/idle expiry are refreshed at most this often, to avoid a write per request. */
export const SESSION_TOUCH_INTERVAL_MS = MINUTE;

export const INVITATION_TTL_MS = 72 * HOUR;
export const PASSWORD_RESET_TTL_MS = 30 * MINUTE;

export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_DURATION_MS = 15 * MINUTE;

export const RECOVERY_CODE_COUNT = 10;

/** Rate limits for unauthenticated or credential-checking endpoints (docs/06 §4). */
export const AUTH_RATE_LIMITS = {
  loginPerIp: { limit: 20, windowSeconds: 60 },
  loginPerAccount: { limit: 5, windowSeconds: 60 },
  forgotPerEmail: { limit: 3, windowSeconds: 3600 },
  forgotPerIp: { limit: 20, windowSeconds: 3600 },
  tokenPerIp: { limit: 20, windowSeconds: 3600 },
  mfaPerSession: { limit: 5, windowSeconds: 300 },
} as const;

export function sessionCookieName(secure: boolean): string {
  // The __Host- prefix requires Secure and forbids Domain: the cookie stays on one portal host.
  return secure ? '__Host-sd_session' : 'sd_session';
}

export const CSRF_HEADER = 'x-csrf-token';
