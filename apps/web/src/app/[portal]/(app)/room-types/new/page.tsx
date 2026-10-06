import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RoomTypeForm } from '../../../../../components/hotel/room-type-form';
import { EmptyState, LinkButton, PageHeader } from '../../../../../components/kit';
import { pageFor } from '../../../../../lib/page-guards';
import type { PortalParams } from '../../../../../lib/portal-params';
import { can, getProperties } from '../../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Add room type' };

export default async function NewRoomTypePage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'roomType.manage')) notFound();
  const { current } = await getProperties();
  if (!current) {
    return (
      <EmptyState
        title="Add a property first"
        body="Room types belong to a property."
        action={<LinkButton href="/properties/new">Add property</LinkButton>}
      />
    );
  }
  return (
    <>
      <PageHeader title="Add room type" description={`For ${current.name}`} />
      <RoomTypeForm
        propertyId={current.id}
        currency={current.currency}
        canManage
        canSeeRates={can(session, 'booking.viewFinancials')}
      />
    </>
  );
}
