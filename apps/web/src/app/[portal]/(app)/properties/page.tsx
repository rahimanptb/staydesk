import type { Metadata } from 'next';
import Link from 'next/link';
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
import { can, getProperties } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Properties' };

export default async function PropertiesPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  const { properties } = await getProperties();
  const canManage = can(session, 'property.manage');
  return (
    <>
      <PageHeader
        title="Properties"
        description="Hotels and resorts in this account."
        actions={canManage ? <LinkButton href="/properties/new">Add property</LinkButton> : null}
      />
      {properties.length === 0 ? (
        <EmptyState
          title="No properties yet"
          body="Add your first hotel or resort to start setting up rooms."
          action={canManage ? <LinkButton href="/properties/new">Add property</LinkButton> : null}
        />
      ) : (
        <Table head={['Property', 'Status', 'Time zone', 'Currency', 'Booking prefix']}>
          {properties.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link
                  href={`/properties/${p.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {p.name}
                </Link>
                <div className="text-xs text-[var(--text-muted)]">
                  {p.code}
                  {p.city ? ` · ${p.city}` : ''}
                </div>
              </Td>
              <Td>
                <StatusBadge status={p.status} />
              </Td>
              <Td>{p.timezone}</Td>
              <Td>{p.currency}</Td>
              <Td className="font-mono text-xs">{p.bookingRefPrefix}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
