import type { Portal } from '@staydesk/contracts';

export { PORTALS, portalForHost, type Portal } from '@staydesk/contracts';

/**
 * Internal path for a public path on a portal host. Public URLs never contain the portal
 * segment, so `/agent/...` requested on the hotel host maps to `/hotel/agent/...` (a 404) —
 * one portal's pages are unreachable from another portal's host.
 */
export function internalPath(portal: Portal, pathname: string): string {
  return pathname === '/' ? `/${portal}` : `/${portal}${pathname}`;
}
