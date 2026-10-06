import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AvailabilityGrid } from '@staydesk/contracts';
import {
  AvailabilityGridView,
  AvailabilityLegend,
} from '../../../../components/hotel/availability-grid';
import { StayCheck } from '../../../../components/hotel/stay-check';
import { EmptyState, LinkButton, PageHeader } from '../../../../components/kit';
import { addDays, formatRange, isIsoDate } from '../../../../lib/dates';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Availability' };

const SPANS = [7, 14, 30] as const;

export default async function AvailabilityPage({
  params,
  searchParams,
}: PortalParams & { searchParams: Promise<{ from?: string; days?: string }> }) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'availability.view')) notFound();
  const { current } = await getProperties();
  if (!current) {
    return (
      <EmptyState
        title="Add a property first"
        body="Availability is shown per property."
        action={<LinkButton href="/properties/new">Add property</LinkButton>}
      />
    );
  }

  const query = await searchParams;
  const days = SPANS.find((s) => String(s) === query.days) ?? 14;
  const from = isIsoDate(query.from) ? query.from : current.businessDate;
  const to = addDays(from, days);
  const grid = await serverGet<AvailabilityGrid>(
    `/properties/${current.id}/availability?from=${from}&to=${to}`,
  );
  const href = (f: string, d: number = days) => `/availability?from=${f}&days=${d}`;
  const pill = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${
      active ? 'bg-brand-600 text-white' : 'border border-[var(--border)] hover:bg-[var(--surface)]'
    }`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Availability"
        description={`Rooms left to sell at ${current.name}, night by night.`}
        actions={
          <>
            {can(session, 'block.view') ? (
              <LinkButton href="/blocks" variant="secondary">
                Blocks & out of service
              </LinkButton>
            ) : null}
            <LinkButton href="/stop-sells" variant="secondary">
              Stop-sell
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Dates" className="flex flex-wrap items-center gap-2">
          <Link
            href={href(addDays(from, -days))}
            className={pill(false)}
            aria-label="Earlier dates"
          >
            ←
          </Link>
          <Link href={href(current.businessDate)} className={pill(from === current.businessDate)}>
            Today
          </Link>
          <Link href={href(addDays(from, days))} className={pill(false)} aria-label="Later dates">
            →
          </Link>
          <form action="/availability" className="flex items-center gap-2">
            <input type="hidden" name="days" value={days} />
            <label className="sr-only" htmlFor="grid-from">
              Start date
            </label>
            <input
              id="grid-from"
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-sm"
            />
            <button type="submit" className={pill(false)}>
              Go
            </button>
          </form>
        </nav>
        <div className="flex items-center gap-2" role="group" aria-label="Number of nights">
          {SPANS.map((s) => (
            <Link key={s} href={href(from, s)} className={pill(s === days)}>
              {s} nights
            </Link>
          ))}
        </div>
      </div>

      {grid.roomTypes.length === 0 ? (
        <EmptyState
          title="No active room types"
          body="Add a room type, or activate one, to see its availability."
          action={<LinkButton href="/room-types/new">Add room type</LinkButton>}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-muted)]">{formatRange(from, to)}</p>
          <AvailabilityGridView grid={grid} />
          <AvailabilityLegend />
        </div>
      )}

      <StayCheck propertyId={current.id} businessDate={current.businessDate} />
    </div>
  );
}
