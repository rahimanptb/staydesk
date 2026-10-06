import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { AuditLogView } from '@staydesk/contracts';
import { AuditLogList } from '../../../../components/hotel/audit-log-list';
import { PageHeader } from '../../../../components/kit';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditLogPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  if (!can(session, 'auditLog.view')) notFound();
  const page = await serverGet<{ data: AuditLogView[]; nextCursor: string | null }>(
    '/audit-logs?limit=50',
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, who made it and when. Entries cannot be edited."
      />
      <AuditLogList initial={page} />
    </>
  );
}
