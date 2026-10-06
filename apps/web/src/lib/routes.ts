import type { SessionInfo } from '@staydesk/contracts';

/** Where a session must go next: finish two-factor, pick an account, or the app home. */
export function nextStepFor(session: SessionInfo): string {
  if (session.mfa === 'VERIFY') return '/two-factor';
  if (session.mfa === 'ENROLL') return '/two-factor/setup';
  if (session.context !== 'PLATFORM' && !session.current) return '/choose-account';
  return '/';
}
