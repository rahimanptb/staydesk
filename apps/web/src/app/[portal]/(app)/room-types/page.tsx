import type { Metadata } from 'next';
import Link from 'next/link';
import type { RoomTypeView } from '@staydesk/contracts';
import {
  EmptyState,
  LinkButton,
  PageHeader,
  StatusBadge,
  Table,
  Td,
} from '../../../../components/kit';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Room types' };

export default async function RoomTypesPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  const { current } = await getProperties();
  if (!current) {
    return (
      <>
        <PageHeader title="Room types" />
        <EmptyState
          title="Add a property first"
          body="Room types belong to a property."
          action={<LinkButton href="/properties/new">Add property</LinkButton>}
        />
      </>
    );
  }
  const roomTypes = await serverGet<RoomTypeView[]>(`/properties/${current.id}/room-types`);
  const canManage = can(session, 'roomType.manage');
  return (
    <>
      <PageHeader
        title="Room types"
        description={`What ${current.name} sells. Availability is counted per room type.`}
        actions={canManage ? <LinkButton href="/room-types/new">Add room type</LinkButton> : null}
      />
      {roomTypes.length === 0 ? (
        <EmptyState
          title="No room types yet"
          body="Create Deluxe, Suite, Villa… with their occupancy and number of rooms."
          action={canManage ? <LinkButton href="/room-types/new">Add room type</LinkButton> : null}
        />
      ) : (
        <Table head={['Room type', 'Occupancy', 'Rooms', 'Inventory', 'Status']}>
          {roomTypes.map((t) => (
            <tr key={t.id}>
              <Td>
                <Link
                  href={`/room-types/${t.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {t.name}
                </Link>
                <div className="text-xs text-[var(--text-muted)]">{t.code}</div>
              </Td>
              <Td className="text-xs">
                Up to {t.maxOccupancy} guests ({t.maxAdults} adults, {t.maxChildren} children)
              </Td>
              <Td className="tabular-nums">{t.totalInventory}</Td>
              <Td className="text-xs text-[var(--text-muted)]">
                {t.trackRooms ? `Individual rooms (${t.roomCount})` : 'Counted'}
              </Td>
              <Td>
                <StatusBadge status={t.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
