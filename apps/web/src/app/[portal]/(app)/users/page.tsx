import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { MembershipView, RoleView } from '@staydesk/contracts';
import { UsersManager } from '../../../../components/hotel/users-manager';
import { PageHeader } from '../../../../components/kit';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'user.view')) notFound();
  const [members, roles, { properties }] = await Promise.all([
    serverGet<MembershipView[]>('/users'),
    serverGet<RoleView[]>('/roles'),
    can(session, 'property.view') ? getProperties() : Promise.resolve({ properties: [] }),
  ]);
  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in to this account, and what they may do."
      />
      <UsersManager
        members={members}
        roles={roles}
        properties={properties}
        currentUserId={session.user.id}
        canManage={can(session, 'user.manage')}
      />
    </>
  );
}
