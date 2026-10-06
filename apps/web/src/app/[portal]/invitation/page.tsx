import type { Metadata } from 'next';
import { InvitationForm } from '../../../components/auth-forms';
import { AuthCard } from '../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';

export const metadata: Metadata = { title: 'Accept invitation' };

export default async function InvitationPage(props: PortalParams) {
  const portal = await portalOf(props);
  return (
    <AuthCard portalLabel={PORTAL_COPY[portal].label} title="Accept your invitation">
      <InvitationForm />
    </AuthCard>
  );
}
