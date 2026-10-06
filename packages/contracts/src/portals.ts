/** The three authenticated portals, each on its own host (docs/05 §2). */
export const PORTALS = ['hotel', 'agent', 'admin'] as const;
export type Portal = (typeof PORTALS)[number];

export type PortalContext = 'TENANT' | 'AGENCY' | 'PLATFORM';

/** Which session context each portal serves (docs/02 §1). */
export const PORTAL_CONTEXT: Record<Portal, PortalContext> = {
  hotel: 'TENANT',
  agent: 'AGENCY',
  admin: 'PLATFORM',
};

/** First host label → portal. */
const SUBDOMAIN_PORTAL: Record<string, Portal> = {
  app: 'hotel',
  agent: 'agent',
  admin: 'admin',
};

/**
 * Resolves the portal for a Host header. Bare localhost serves the hotel portal for convenience
 * in development; any unknown host gets no portal.
 */
export function portalForHost(host: string | null | undefined): Portal | null {
  if (!host) return null;
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'hotel';
  const label = hostname.split('.')[0] ?? '';
  return SUBDOMAIN_PORTAL[label] ?? null;
}
