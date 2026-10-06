import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { RoomTypeView, StopSellView } from '@staydesk/contracts';
import { ActionButton } from '../../../../components/actions';
import { StopSellForm } from '../../../../components/hotel/stop-sell-form';
import { EmptyState, LinkButton, PageHeader, Table, Td } from '../../../../components/kit';
import { formatDate, formatRange } from '../../../../lib/dates';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Stop-sell' };

export default async function StopSellsPage({
  params,
  searchParams,
}: PortalParams & { searchParams: Promise<{ status?: string }> }) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'availability.view')) notFound();
  const { current } = await getProperties();
  if (!current) {
    return (
      <EmptyState
        title="Add a property first"
        body="Stop-sells apply to a property."
        action={<LinkButton href="/properties/new">Add property</LinkButton>}
      />
    );
  }
  const status = (await searchParams).status === 'all' ? 'all' : 'active';
  const canManage = can(session, 'stopSell.manage');
  const [stopSells, roomTypes] = await Promise.all([
    serverGet<StopSellView[]>(`/properties/${current.id}/stop-sells?status=${status}`),
    canManage
      ? serverGet<RoomTypeView[]>(`/properties/${current.id}/room-types`)
      : Promise.resolve([] as RoomTypeView[]),
  ]);
  const isOpen = (s: StopSellView) => !s.liftedAt && s.endDate > current.businessDate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stop-sell"
        description={`Close dates at ${current.name} to all sales or to travel agents, without changing room counts.`}
        actions={
          <LinkButton href="/availability" variant="secondary">
            View calendar
          </LinkButton>
        }
      />
      {canManage ? (
        <StopSellForm
          propertyId={current.id}
          businessDate={current.businessDate}
          roomTypes={roomTypes.filter((t) => t.status !== 'ARCHIVED')}
        />
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {status === 'active' ? 'Current and upcoming' : 'All stop-sells'}
        </h2>
        <Link
          href={status === 'active' ? '/stop-sells?status=all' : '/stop-sells'}
          className="text-sm text-brand-600 hover:underline"
        >
          {status === 'active' ? 'Show lifted and past' : 'Show current only'}
        </Link>
      </div>
      {stopSells.length === 0 ? (
        <EmptyState title="Nothing closed" body="Every night is open for sale." />
      ) : (
        <Table head={['Room type', 'Dates', 'Closed to', 'Reason', 'Created', '']}>
          {stopSells.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.roomTypeName ?? 'All room types'}</Td>
              <Td>{formatRange(s.startDate, s.endDate)}</Td>
              <Td>{s.scope === 'ALL_CHANNELS' ? 'Everyone' : 'Travel agents'}</Td>
              <Td className="text-sm">{s.reason ?? '—'}</Td>
              <Td className="text-xs text-[var(--text-muted)]">
                {s.createdBy?.name ?? 'Unknown'}
                <div>{formatDate(s.createdAt.slice(0, 10))}</div>
                {s.liftedAt ? (
                  <div>
                    Lifted by {s.liftedBy?.name ?? 'Unknown'} on{' '}
                    {formatDate(s.liftedAt.slice(0, 10))}
                  </div>
                ) : null}
              </Td>
              <Td className="text-right">
                {canManage && isOpen(s) ? (
                  <ActionButton
                    label="Lift"
                    path={`/properties/${current.id}/stop-sells/${s.id}/lift`}
                    confirm="Open these dates for sale again?"
                  />
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
