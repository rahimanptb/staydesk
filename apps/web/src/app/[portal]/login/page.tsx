import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '../../../components/auth-forms';
import { AuthCard } from '../../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../../lib/portal-params';
import { nextStepFor } from '../../../lib/routes';
import { getSession } from '../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage(props: PortalParams) {
  const portal = await portalOf(props);
  const session = await getSession();
  if (session) redirect(nextStepFor(session));
  const copy = PORTAL_COPY[portal];
  return (
    <AuthCard portalLabel={copy.label} title={copy.signInTitle} description={copy.signInBody}>
      <LoginForm />
    </AuthCard>
  );
}
