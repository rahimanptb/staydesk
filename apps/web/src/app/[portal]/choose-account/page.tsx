import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ChooseAccount } from '../../../components/auth-forms';
import { AuthCard } from '../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';
import { getSession } from '../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Choose an account' };

export default async function ChooseAccountPage(props: PortalParams) {
  const portal = await portalOf(props);
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mfa === 'VERIFY') redirect('/two-factor');
  if (portal === 'admin') redirect('/');
  return (
    <AuthCard
      portalLabel={PORTAL_COPY[portal].label}
      title={portal === 'hotel' ? 'Choose a hotel account' : 'Choose an agency'}
      description="You have access to more than one. You can switch later."
    >
      <ChooseAccount
        options={session.options}
        csrfToken={session.csrfToken}
        kind={portal === 'hotel' ? 'tenant' : 'agency'}
      />
    </AuthCard>
  );
}
