import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/kit';
import { PropertyForm } from '../../../../../components/hotel/property-form';
import { pageFor } from '../../../../../lib/page-guards';
import type { PortalParams } from '../../../../../lib/portal-params';
import { can } from '../../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Add property' };

export default async function NewPropertyPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'property.manage')) notFound();
  return (
    <>
      <PageHeader
        title="Add property"
        description="You can change everything except the code later."
      />
      <PropertyForm canManage />
    </>
  );
}
