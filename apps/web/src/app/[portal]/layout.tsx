import type { ReactNode } from 'react';
import { PORTALS } from '@staydesk/contracts';
import { portalOf, type PortalParams } from '../../lib/portal-params';

/** Only the three portals exist; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return PORTALS.map((portal) => ({ portal }));
}

export default async function PortalLayout({
  children,
  params,
}: PortalParams & { children: ReactNode }) {
  await portalOf({ params });
  return children;
}
