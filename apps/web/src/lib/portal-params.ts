import { notFound } from 'next/navigation';
import { PORTALS, type Portal } from '@staydesk/contracts';

export interface PortalParams {
  params: Promise<{ portal: string }>;
}

/** The portal of the current route (set by the host-based proxy); 404 for anything else. */
export async function portalOf({ params }: PortalParams): Promise<Portal> {
  const { portal } = await params;
  if (!(PORTALS as readonly string[]).includes(portal)) notFound();
  return portal as Portal;
}

export const PORTAL_COPY: Record<
  Portal,
  { label: string; signInTitle: string; signInBody: string }
> = {
  hotel: {
    label: 'Hotel',
    signInTitle: 'Sign in to your hotel account',
    signInBody: 'Room inventory, availability, bookings and travel-agent access.',
  },
  agent: {
    label: 'Agents',
    signInTitle: 'Sign in to the agent portal',
    signInBody: 'Live availability at the hotels and resorts that have approved your agency.',
  },
  admin: {
    label: 'Admin',
    signInTitle: 'Platform administration',
    signInBody: 'Tenants, plans, agencies and system health.',
  },
};
