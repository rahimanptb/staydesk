import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BLOCK_REASON_LABELS, type BlockView } from '@staydesk/contracts';
import { BlockRelease } from '../../../../components/hotel/block-release';
import { EmptyState, LinkButton, PageHeader, Table, Td } from '../../../../components/kit';
import { formatDate, formatRange } from '../../../../lib/dates';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Blocks and out of service' };

const KIND_LABEL = { BLOCK: 'Block', OUT_OF_SERVICE: 'Out of service' } as const;

export default async function BlocksPage({
  params,
  searchParams,
}: PortalParams & { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'block.view')) notFound();
  const { current } = await getProperties();
  if (!current) {
    return (
      <EmptyState
        title="Add a property first"
        body="Blocks belong to a property."
        action={<LinkButton href="/properties/new">Add property</LinkButton>}
      />
    );
  }
  const query = await searchParams;
  const status = query.status === 'released' ? 'released' : 'active';
  const kind = query.kind === 'BLOCK' || query.kind === 'OUT_OF_SERVICE' ? query.kind : undefined;
  const blocks = await serverGet<BlockView[]>(
    `/properties/${current.id}/blocks?status=${status}${kind ? `&kind=${kind}` : ''}`,
  );
  const canCreate = can(session, 'block.create') || can(session, 'room.outOfService');
  const canRelease = (b: BlockView) =>
    status === 'active' &&
    can(session, b.kind === 'OUT_OF_SERVICE' ? 'room.outOfService' : 'block.release');
  const tab = (active: boolean) =>
    `border-b-2 px-1 pb-2 text-sm ${
      active
        ? 'border-brand-600 font-medium text-brand-600'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
    }`;
  const link = (s: string, k?: string) => `/blocks?status=${s}${k ? `&kind=${k}` : ''}`;

  return (
    <>
      <PageHeader
        title="Blocks and out of service"
        description={`Rooms held back from sale at ${current.name}. Releasing gives them back from the date you choose.`}
        actions={canCreate ? <LinkButton href="/blocks/new">New block</LinkButton> : null}
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)]">
        <nav aria-label="Block status" className="flex gap-6">
          <Link
            href={link('active', kind)}
            className={tab(status === 'active')}
            aria-current={status === 'active' ? 'page' : undefined}
          >
            Current and upcoming
          </Link>
          <Link
            href={link('released', kind)}
            className={tab(status === 'released')}
            aria-current={status === 'released' ? 'page' : undefined}
          >
            Released and past
          </Link>
        </nav>
        <nav aria-label="Kind" className="flex gap-4 pb-2 text-sm">
          {[undefined, 'BLOCK', 'OUT_OF_SERVICE'].map((k) => (
            <Link
              key={k ?? 'all'}
              href={link(status, k)}
              className={
                k === kind
                  ? 'font-medium text-brand-600'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }
            >
              {k ? KIND_LABEL[k as keyof typeof KIND_LABEL] : 'All'}
            </Link>
          ))}
        </nav>
      </div>

      {blocks.length === 0 ? (
        <EmptyState
          title={status === 'active' ? 'Nothing blocked' : 'No released or past blocks'}
          body={
            status === 'active'
              ? 'Block rooms for groups or owner use, or take rooms out of service for maintenance.'
              : 'Blocks appear here once released or over.'
          }
          action={
            canCreate && status === 'active' ? (
              <LinkButton href="/blocks/new">New block</LinkButton>
            ) : undefined
          }
        />
      ) : (
        <Table head={['Rooms', 'Kind', 'Dates', 'Reason', 'Created', '']}>
          {blocks.map((b) => (
            <tr key={b.id}>
              <Td>
                <div className="font-medium">
                  {b.roomNumber ? `Room ${b.roomNumber}` : `${b.quantity} × ${b.roomTypeName}`}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {[
                    b.roomNumber ? b.roomTypeName : null,
                    b.quantity !== b.originalQuantity ? `originally ${b.originalQuantity}` : null,
                    b.splitFromId ? 'continues an earlier block' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </Td>
              <Td>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    b.kind === 'BLOCK'
                      ? 'bg-status-blocked/10 text-status-blocked'
                      : 'bg-status-oos/10 text-status-oos'
                  }`}
                >
                  {KIND_LABEL[b.kind]}
                </span>
                {b.overrideUsed ? (
                  <span className="ml-1 inline-flex rounded-full bg-status-full/10 px-2 py-0.5 text-xs font-medium text-status-full">
                    Override
                  </span>
                ) : null}
              </Td>
              <Td>
                {b.endDate > b.startDate
                  ? formatRange(b.startDate, b.endDate)
                  : `Released before ${formatDate(b.startDate)}`}
                {b.endDate !== b.originalEndDate ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    originally until {formatDate(b.originalEndDate)}
                  </div>
                ) : null}
              </Td>
              <Td>
                {BLOCK_REASON_LABELS[b.reason]}
                {b.notes ? (
                  <div className="max-w-xs truncate text-xs text-[var(--text-muted)]">
                    {b.notes}
                  </div>
                ) : null}
                {b.releaseReason ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    Released: {b.releaseReason}
                  </div>
                ) : null}
              </Td>
              <Td className="text-xs text-[var(--text-muted)]">
                {b.createdBy?.name ?? 'Unknown'}
                <div>{formatDate(b.createdAt.slice(0, 10))}</div>
              </Td>
              <Td className="text-right">
                {canRelease(b) ? (
                  <BlockRelease
                    propertyId={current.id}
                    block={b}
                    businessDate={current.businessDate}
                  />
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
