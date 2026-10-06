export const PORTALS = ['hotel', 'agent', 'admin'] as const;
export type Portal = (typeof PORTALS)[number];

/** First host label → portal (docs/05 §2). */
const SUBDOMAIN_PORTAL: Record<string, Portal> = {
  app: 'hotel',
  agent: 'agent',
  admin: 'admin',
};

/**
 * Resolves the portal for a Host header. Bare localhost serves the hotel portal for convenience
 * in development; any unknown host gets no portal (404).
 */
export function portalForHost(host: string | null): Portal | null {
  if (!host) return null;
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'hotel';
  const label = hostname.split('.')[0] ?? '';
  return SUBDOMAIN_PORTAL[label] ?? null;
}

/**
 * Internal path for a public path on a portal host. Public URLs never contain the portal
 * segment, so `/agent/...` requested on the hotel host maps to `/hotel/agent/...` (a 404) —
 * one portal's pages are unreachable from another portal's host.
 */
export function internalPath(portal: Portal, pathname: string): string {
  return pathname === '/' ? `/${portal}` : `/${portal}${pathname}`;
}
