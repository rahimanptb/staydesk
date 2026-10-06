import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignOutButton } from '../../components/auth-forms';
import { AuthCard } from '../../components/ui';
import { PORTAL_COPY, portalOf, type PortalParams } from '../../lib/portal-params';
import { nextStepFor } from '../../lib/routes';
import { getSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

const WORKSPACE_NOTE = {
  hotel: 'Properties, room inventory, availability and bookings will appear here.',
  agent: 'Availability search at your approved hotels will appear here.',
  admin: 'Tenant, plan and agency management will appear here.',
} as const;

export default async function PortalHome(props: PortalParams) {
  const portal = await portalOf(props);
  const session = await getSession();
  if (!session) redirect('/login');
  const next = nextStepFor(session);
  if (next !== '/') redirect(next);

  return (
    <AuthCard
      portalLabel={PORTAL_COPY[portal].label}
      title={`Welcome, ${session.user.name}`}
      description={
        <>
          Signed in as {session.user.email}
          {session.current ? (
            <>
              {' '}
              · <span className="font-medium text-[var(--text)]">{session.current.name}</span>
            </>
          ) : null}
        </>
      }
      footer={
        session.options.length > 1 ? (
          <Link href="/choose-account" className="text-brand-600 hover:underline">
            Switch account
          </Link>
        ) : null
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
          {WORKSPACE_NOTE[portal]}
        </p>
        <SignOutButton csrfToken={session.csrfToken} />
      </div>
    </AuthCard>
  );
}
