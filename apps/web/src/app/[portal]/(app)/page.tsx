import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { MembershipView, RoomTypeView } from '@staydesk/contracts';
import { TenantsTable, type PlanSummary } from '../../../components/admin/admin-forms';
import { EmptyState, LinkButton, PageHeader, Section } from '../../../components/kit';
import { portalOf, type PortalParams } from '../../../lib/portal-params';
import { can, getProperties, getSession, serverGet } from '../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Home' };

interface Step {
  done: boolean;
  title: string;
  body: string;
  href: string;
  action: string;
  optional?: boolean;
}

async function HotelDashboard() {
  const session = (await getSession())!;
  const { properties, current } = can(session, 'property.view')
    ? await getProperties()
    : { properties: [], current: null };
  const roomTypes =
    current && can(session, 'roomType.view')
      ? await serverGet<RoomTypeView[]>(`/properties/${current.id}/room-types`)
      : [];
  const members = can(session, 'user.view') ? await serverGet<MembershipView[]>('/users') : [];

  const tracked = roomTypes.filter((t) => t.trackRooms);
  const totalRooms = roomTypes
    .filter((t) => t.status === 'ACTIVE')
    .reduce((sum, t) => sum + t.totalInventory, 0);
  const steps: Step[] = [
    {
      done: properties.length > 0,
      title: 'Add your property',
      body: 'Name, time zone, currency and stay rules.',
      href: '/properties/new',
      action: 'Add property',
    },
    {
      done: roomTypes.length > 0,
      title: 'Create room types',
      body: 'Deluxe, Suite, Villa… with occupancy and how many rooms you have.',
      href: '/room-types/new',
      action: 'Add room type',
    },
    {
      done: tracked.length > 0 && tracked.every((t) => t.roomCount > 0),
      optional: tracked.length === 0,
      title: 'Add individual rooms',
      body:
        tracked.length === 0
          ? 'Optional: only for room types that track physical rooms.'
          : 'Add room numbers to the room types that track rooms.',
      href: '/rooms',
      action: 'Add rooms',
    },
    {
      done: members.length > 1,
      title: 'Invite your team',
      body: 'Front desk, managers and other staff, each with their own role.',
      href: '/users',
      action: 'Invite',
    },
    {
      done: current?.status === 'ACTIVE',
      title: 'Open the property',
      body: 'Set the property to Active once its setup is complete.',
      href: current ? `/properties/${current.id}` : '/properties',
      action: 'Review settings',
    },
  ];
  const remaining = steps.filter((s) => !s.done && !s.optional);

  return (
    <>
      <PageHeader
        title={`Welcome, ${session.user.name.split(' ')[0]}`}
        description={
          current
            ? `${current.name} · today is ${current.businessDate} (${current.timezone})`
            : session.current?.name
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Properties', value: properties.length },
          { label: 'Room types', value: roomTypes.length, note: current?.name },
          { label: 'Rooms', value: totalRooms, note: current?.name },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
          >
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              {tile.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</div>
            {tile.note ? <div className="text-xs text-[var(--text-muted)]">{tile.note}</div> : null}
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Section
          title={remaining.length === 0 ? 'Setup complete' : 'Set up your account'}
          description={
            remaining.length === 0
              ? 'Bookings and availability arrive in the next release.'
              : `${remaining.length} step(s) left`
          }
        >
          <ol className="divide-y divide-[var(--border)]">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  aria-hidden="true"
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.done
                      ? 'bg-status-available/15 text-status-available'
                      : 'bg-[var(--surface)] text-[var(--text-muted)]'
                  }`}
                >
                  {step.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {step.title}
                    <span className="sr-only">
                      {step.done ? ' (done)' : step.optional ? ' (optional)' : ' (to do)'}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{step.body}</div>
                </div>
                {!step.done ? (
                  <Link
                    href={step.href}
                    className="text-sm font-medium text-brand-600 hover:underline"
                  >
                    {step.action}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}

async function AdminHome() {
  const session = (await getSession())!;
  const tenants = await serverGet<
    Array<{
      id: string;
      name: string;
      slug: string;
      status: string;
      plan: { name: string } | null;
      createdAt: string;
    }>
  >('/platform/tenants');
  const canManage = can(session, 'platform.tenant.manage');
  const plans = can(session, 'platform.plan.manage')
    ? await serverGet<PlanSummary[]>('/platform/plans')
    : [];
  return (
    <>
      <PageHeader
        title="Tenants"
        description="Hotel and resort accounts on the platform."
        actions={canManage ? <LinkButton href="/tenants/new">New tenant</LinkButton> : null}
      />
      {tenants.length === 0 ? (
        <EmptyState
          title="No tenants yet"
          body={
            plans.length === 0
              ? 'Create a plan first, then add the first hotel account.'
              : 'Create the first hotel account and invite its owner.'
          }
          action={
            canManage ? (
              <LinkButton href={plans.length === 0 ? '/plans' : '/tenants/new'}>
                {plans.length === 0 ? 'Create a plan' : 'New tenant'}
              </LinkButton>
            ) : null
          }
        />
      ) : (
        <TenantsTable tenants={tenants} canManage={canManage} />
      )}
    </>
  );
}

export default async function Home(props: PortalParams) {
  const portal = await portalOf(props);
  if (!(await getSession())) redirect('/login');
  if (portal === 'hotel') return <HotelDashboard />;
  if (portal === 'admin') return <AdminHome />;
  return (
    <EmptyState
      title="Welcome"
      body="Availability search at the hotels and resorts that approve your agency is coming soon."
    />
  );
}
