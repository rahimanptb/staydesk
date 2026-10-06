import { brand } from '@staydesk/config/brand';
import type { Portal } from '../portals';
import { getApiStatus, type ApiStatus } from '../server/api-health';

const PORTAL_COPY: Record<Portal, { label: string; heading: string; body: string }> = {
  hotel: {
    label: brand.portals.hotel,
    heading: 'Hotel & resort operations',
    body: 'Room inventory, availability, bookings, blocks and travel-agent access for your properties.',
  },
  agent: {
    label: brand.portals.agent,
    heading: 'Availability for travel partners',
    body: 'Check live room availability at the hotels and resorts that have approved your agency.',
  },
  admin: {
    label: brand.portals.admin,
    heading: 'Platform administration',
    body: 'Tenants, plans, subscriptions, agencies and system health.',
  },
};

const STATUS: Record<ApiStatus, { text: string; dot: string }> = {
  ok: { text: 'API and database are reachable', dot: 'bg-status-available' },
  degraded: { text: 'API is up, database is unreachable', dot: 'bg-status-low' },
  unreachable: { text: 'API is not reachable', dot: 'bg-status-full' },
};

/** Placeholder entry page for each portal until sign-in is built (milestone M1). */
export async function PortalLanding({ portal }: { portal: Portal }) {
  const copy = PORTAL_COPY[portal];
  const status = STATUS[await getApiStatus()];

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-brand-900 text-base font-semibold text-white"
          >
            {brand.productName.charAt(0)}
          </span>
          <span className="text-lg font-semibold tracking-tight">{brand.productName}</span>
          <span className="ml-auto rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-muted)]">
            {copy.label}
          </span>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">{copy.heading}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{copy.body}</p>

        <p className="mt-8 rounded-lg bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
          Sign-in is not available yet.
        </p>

        <p className="mt-6 flex items-center gap-2 text-xs text-[var(--text-muted)]" role="status">
          <span aria-hidden="true" className={`size-2 rounded-full ${status.dot}`} />
          {status.text}
        </p>
      </div>
    </main>
  );
}
