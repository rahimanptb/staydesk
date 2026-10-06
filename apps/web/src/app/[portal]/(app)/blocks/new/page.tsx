import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { RoomTypeView, RoomView } from '@staydesk/contracts';
import { BlockForm } from '../../../../../components/hotel/block-form';
import { EmptyState, LinkButton, PageHeader } from '../../../../../components/kit';
import { pageFor } from '../../../../../lib/page-guards';
import type { PortalParams } from '../../../../../lib/portal-params';
import { can, getProperties, serverGet } from '../../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New block' };

export default async function NewBlockPage({
  params,
  searchParams,
}: PortalParams & { searchParams: Promise<{ roomTypeId?: string }> }) {
  const session = await pageFor(params, 'hotel');
  const canBlock = can(session, 'block.create');
  const canOutOfService = can(session, 'room.outOfService');
  if (!canBlock && !canOutOfService) notFound();
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
  const [roomTypes, rooms] = await Promise.all([
    serverGet<RoomTypeView[]>(`/properties/${current.id}/room-types`),
    can(session, 'room.view')
      ? serverGet<RoomView[]>(`/properties/${current.id}/rooms`)
      : Promise.resolve([] as RoomView[]),
  ]);
  return (
    <>
      <PageHeader
        title="New block"
        description={`Hold rooms back from sale at ${current.name}, or take them out of service.`}
      />
      <BlockForm
        propertyId={current.id}
        businessDate={current.businessDate}
        roomTypes={roomTypes.filter((t) => t.status !== 'ARCHIVED')}
        rooms={rooms}
        canBlock={canBlock}
        canOutOfService={canOutOfService}
        canOverride={can(session, 'inventory.override')}
        initialRoomTypeId={(await searchParams).roomTypeId}
      />
    </>
  );
}
