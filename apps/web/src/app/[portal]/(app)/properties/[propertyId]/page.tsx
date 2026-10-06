import type { Metadata } from 'next';
import type { HolidayView, PropertyView } from '@staydesk/contracts';
import { ActionButton } from '../../../../../components/actions';
import { HolidaysPanel, PropertyForm } from '../../../../../components/hotel/property-form';
import { PageHeader, StatusBadge } from '../../../../../components/kit';
import { pageFor } from '../../../../../lib/page-guards';
import { can, serverGet } from '../../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Property settings' };

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ portal: string; propertyId: string }>;
}) {
  const session = await pageFor(params, 'hotel');
  const { propertyId } = await params;
  const property = await serverGet<PropertyView>(`/properties/${propertyId}`);
  const year = Number(property.businessDate.slice(0, 4));
  const holidays = await serverGet<HolidayView[]>(
    `/properties/${propertyId}/holidays?year=${year}`,
  );
  const canManage = can(session, 'property.manage');
  return (
    <>
      <PageHeader
        title={property.name}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={property.status} /> Today at this property: {property.businessDate}
          </span>
        }
        actions={
          canManage ? (
            <ActionButton
              label="Archive property"
              tone="danger"
              path={`/properties/${property.id}/archive`}
              confirm={`Archive ${property.name}? It disappears from lists; history is kept.`}
              redirectTo="/properties"
            />
          ) : null
        }
      />
      <div className="space-y-6">
        <PropertyForm property={property} canManage={canManage} />
        <HolidaysPanel propertyId={property.id} holidays={holidays} canManage={canManage} />
      </div>
    </>
  );
}
