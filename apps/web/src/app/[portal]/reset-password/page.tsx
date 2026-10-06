import type { Metadata } from 'next';
import { ResetPasswordForm } from '../../../components/auth-forms';
import { AuthCard } from '../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage(props: PortalParams) {
  const portal = await portalOf(props);
  return (
    <AuthCard portalLabel={PORTAL_COPY[portal].label} title="Choose a new password">
      <ResetPasswordForm />
    </AuthCard>
  );
}
