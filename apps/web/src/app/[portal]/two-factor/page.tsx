import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TwoFactorForm } from '../../../components/auth-forms';
import { AuthCard } from '../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';
import { nextStepFor } from '../../../lib/routes';
import { getSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Two-factor authentication' };

export default async function TwoFactorPage(props: PortalParams) {
  const portal = await portalOf(props);
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mfa !== 'VERIFY') redirect(nextStepFor(session));
  return (
    <AuthCard
      portalLabel={PORTAL_COPY[portal].label}
      title="Two-factor authentication"
      description="Enter the code from your authenticator app to finish signing in."
    >
      <TwoFactorForm csrfToken={session.csrfToken} />
    </AuthCard>
  );
}
