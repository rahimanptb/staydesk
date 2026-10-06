import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { RoomTypeView } from '@staydesk/contracts';
import { ActionButton } from '../../../../../components/actions';
import { RoomTypeForm } from '../../../../../components/hotel/room-type-form';
import { PageHeader, StatusBadge } from '../../../../../components/kit';
import { pageFor } from '../../../../../lib/page-guards';
import { can, getProperties, serverGet } from '../../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Room type' };

export default async function RoomTypePage({
  params,
}: {
  params: Promise<{ portal: string; roomTypeId: string }>;
}) {
  const session = await pageFor(params, 'hotel');
  const { roomTypeId } = await params;
  const { current } = await getProperties();
  if (!current) notFound();
  const roomType = await serverGet<RoomTypeView>(
    `/properties/${current.id}/room-types/${roomTypeId}`,
  );
  const canManage = can(session, 'roomType.manage');
  return (
    <>
      <PageHeader
        title={roomType.name}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={roomType.status} /> {current.name}
          </span>
        }
        actions={
          canManage ? (
            <ActionButton
              label="Archive room type"
              tone="danger"
              path={`/properties/${current.id}/room-types/${roomType.id}/archive`}
              confirm={`Archive ${roomType.name}? Its rooms are archived too; past bookings keep their history.`}
              redirectTo="/room-types"
            />
          ) : null
        }
      />
      {/* key: remount after saves so the form edits the latest version */}
      <RoomTypeForm
        key={roomType.version}
        propertyId={current.id}
        currency={current.currency}
        roomType={roomType}
        canManage={canManage}
        canSeeRates={can(session, 'booking.viewFinancials')}
      />
    </>
  );
}
