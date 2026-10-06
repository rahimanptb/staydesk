import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell, type NavItem } from '../../../components/shell';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';
import { nextStepFor } from '../../../lib/routes';
import { can, getProperties, getSession } from '../../../lib/server-api';

/** Every signed-in page: requires a complete session (MFA done, account chosen). */
export default async function AppLayout({
  children,
  params,
}: PortalParams & { children: ReactNode }) {
  const portal = await portalOf({ params });
  const session = await getSession();
  if (!session) redirect('/login');
  const next = nextStepFor(session);
  if (next !== '/') redirect(next);

  if (portal === 'hotel') {
    const nav: NavItem[] = [
      { href: '/', label: 'Dashboard' },
      ...(can(session, 'property.view') ? [{ href: '/properties', label: 'Properties' }] : []),
      ...(can(session, 'roomType.view') ? [{ href: '/room-types', label: 'Room types' }] : []),
      ...(can(session, 'room.view') ? [{ href: '/rooms', label: 'Rooms' }] : []),
      ...(can(session, 'availability.view')
        ? [{ href: '/availability', label: 'Availability' }]
        : []),
      ...(can(session, 'block.view')
        ? [{ href: '/blocks', label: 'Blocks & out of service' }]
        : []),
      ...(can(session, 'availability.view') ? [{ href: '/stop-sells', label: 'Stop-sell' }] : []),
      ...(can(session, 'user.view') ? [{ href: '/users', label: 'Users' }] : []),
      ...(can(session, 'auditLog.view') ? [{ href: '/audit-log', label: 'Audit log' }] : []),
      { href: '/settings', label: 'Settings' },
    ];
    const { properties, current } = can(session, 'property.view')
      ? await getProperties()
      : { properties: [], current: null };
    return (
      <AppShell
        session={session}
        nav={nav}
        portalLabel={PORTAL_COPY.hotel.label}
        properties={properties}
        currentPropertyId={current?.id ?? null}
      >
        {children}
      </AppShell>
    );
  }

  if (portal === 'admin') {
    const nav: NavItem[] = [
      { href: '/', label: 'Tenants' },
      ...(can(session, 'platform.plan.manage') ? [{ href: '/plans', label: 'Plans' }] : []),
    ];
    return (
      <AppShell session={session} nav={nav} portalLabel={PORTAL_COPY.admin.label}>
        {children}
      </AppShell>
    );
  }

  return (
    <AppShell
      session={session}
      nav={[{ href: '/', label: 'Home' }]}
      portalLabel={PORTAL_COPY.agent.label}
    >
      {children}
    </AppShell>
  );
}
