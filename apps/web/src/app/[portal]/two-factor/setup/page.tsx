import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TwoFactorSetup } from '../../../../components/auth-forms';
import { AuthCard } from '../../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../../lib/portal-params';
import { getSession } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Set up two-factor authentication' };

export default async function TwoFactorSetupPage(props: PortalParams) {
  const portal = await portalOf(props);
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mfa === 'VERIFY') redirect('/two-factor');
  return (
    <AuthCard
      portalLabel={PORTAL_COPY[portal].label}
      title="Set up two-factor authentication"
      description="Protect your account with a code from your phone in addition to your password."
    >
      <TwoFactorSetup csrfToken={session.csrfToken} required={session.mfa === 'ENROLL'} />
    </AuthCard>
  );
}
