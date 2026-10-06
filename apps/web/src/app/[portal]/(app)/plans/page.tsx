import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlansManager, type PlanSummary } from '../../../../components/admin/admin-forms';
import { PageHeader } from '../../../../components/kit';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Plans' };

export default async function PlansPage({ params }: PortalParams) {
  const session = await pageFor(params, 'admin');
  if (!can(session, 'platform.plan.manage')) notFound();
  const plans = await serverGet<PlanSummary[]>('/platform/plans');
  return (
    <>
      <PageHeader
        title="Plans"
        description="Subscription plans and their limits. Changes apply to every tenant on the plan."
      />
      <PlansManager plans={plans} />
    </>
  );
}
