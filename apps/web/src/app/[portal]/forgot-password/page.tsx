import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '../../../components/auth-forms';
import { AuthCard } from '../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';

export const metadata: Metadata = { title: 'Reset your password' };

export default async function ForgotPasswordPage(props: PortalParams) {
  const portal = await portalOf(props);
  return (
    <AuthCard
      portalLabel={PORTAL_COPY[portal].label}
      title="Reset your password"
      description="Enter the email you sign in with and we will send you a reset link."
      footer={
        <Link href="/login" className="text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
