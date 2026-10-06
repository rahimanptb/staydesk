import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { PropertyView, SessionInfo } from '@staydesk/contracts';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function forwardedHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  return {
    cookie: incoming.get('cookie') ?? '',
    'x-forwarded-host': incoming.get('host') ?? '',
    'x-forwarded-proto': incoming.get('x-forwarded-proto') ?? 'http',
  };
}

/**
 * Server-side GET through the API as the signed-in visitor (cookie and original host are
 * forwarded so the API applies the portal's rules). 401 → sign-in; 404 → not-found page.
 */
export async function serverGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API}/api/v1${path}`, {
    cache: 'no-store',
    headers: await forwardedHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) redirect('/login');
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** The current session, or null when signed out. Deduplicated per request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const response = await fetch(`${API}/api/v1/auth/session`, {
    cache: 'no-store',
    headers: await forwardedHeaders(),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Session lookup failed with HTTP ${response.status}`);
  return (await response.json()) as SessionInfo;
});

export const PROPERTY_COOKIE = 'sd_property';

/** Properties the member can see, plus the one chosen in the switcher (default: first). */
export const getProperties = cache(
  async (): Promise<{ properties: PropertyView[]; current: PropertyView | null }> => {
    const properties = await serverGet<PropertyView[]>('/properties');
    const chosen = (await cookies()).get(PROPERTY_COOKIE)?.value;
    return {
      properties,
      current: properties.find((p) => p.id === chosen) ?? properties[0] ?? null,
    };
  },
);

export function can(session: SessionInfo, permission: string): boolean {
  return session.permissions.includes(permission);
}
