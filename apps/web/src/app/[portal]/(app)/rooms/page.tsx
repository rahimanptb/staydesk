import type { Metadata } from 'next';
import type { RoomTypeView, RoomView } from '@staydesk/contracts';
import { RoomsManager } from '../../../../components/hotel/rooms-manager';
import { EmptyState, LinkButton, PageHeader } from '../../../../components/kit';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rooms' };

export default async function RoomsPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  const { current } = await getProperties();
  if (!current) {
    return (
      <EmptyState
        title="Add a property first"
        body="Rooms belong to a property."
        action={<LinkButton href="/properties/new">Add property</LinkButton>}
      />
    );
  }
  const [roomTypes, rooms] = await Promise.all([
    serverGet<RoomTypeView[]>(`/properties/${current.id}/room-types`),
    serverGet<RoomView[]>(`/properties/${current.id}/rooms`),
  ]);
  const tracked = roomTypes.filter((t) => t.trackRooms);
  return (
    <>
      <PageHeader title="Rooms" description={`Physical rooms at ${current.name}`} />
      {tracked.length === 0 ? (
        <EmptyState
          title="No room types track individual rooms"
          body='Room numbers are optional. To use them, open a room type and turn on "Track individual rooms".'
          action={
            <LinkButton href="/room-types" variant="secondary">
              Go to room types
            </LinkButton>
          }
        />
      ) : (
        <RoomsManager
          propertyId={current.id}
          roomTypes={roomTypes}
          rooms={rooms}
          canManage={can(session, 'room.manage')}
        />
      )}
    </>
  );
}
