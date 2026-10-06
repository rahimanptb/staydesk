import 'server-only';
import { headers } from 'next/headers';
import type { SessionInfo } from '@staydesk/contracts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * The current session, read server-side by calling the API with the visitor's cookie. The
 * original host is forwarded so the API applies the right portal's rules. Null when signed out.
 */
export async function getSession(): Promise<SessionInfo | null> {
  const incoming = await headers();
  const response = await fetch(`${API}/api/v1/auth/session`, {
    cache: 'no-store',
    headers: {
      cookie: incoming.get('cookie') ?? '',
      'x-forwarded-host': incoming.get('host') ?? '',
      'x-forwarded-proto': incoming.get('x-forwarded-proto') ?? 'http',
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Session lookup failed with HTTP ${response.status}`);
  return (await response.json()) as SessionInfo;
}
