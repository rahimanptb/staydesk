import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CreateTenantForm, type PlanSummary } from '../../../../../components/admin/admin-forms';
import { PageHeader } from '../../../../../components/kit';
import { pageFor } from '../../../../../lib/page-guards';
import type { PortalParams } from '../../../../../lib/portal-params';
import { can, serverGet } from '../../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New tenant' };

export default async function NewTenantPage({ params }: PortalParams) {
  const session = await pageFor(params, 'admin');
  if (!can(session, 'platform.tenant.manage')) notFound();
  const plans = can(session, 'platform.plan.manage')
    ? await serverGet<PlanSummary[]>('/platform/plans')
    : [];
  return (
    <>
      <PageHeader
        title="New tenant"
        description="Creates the account with its roles and emails the owner an invitation."
      />
      <CreateTenantForm plans={plans} />
    </>
  );
}
