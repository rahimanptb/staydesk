import type { Metadata } from 'next';
import Link from 'next/link';
import {
  TenantSettingsForm,
  type TenantProfile,
} from '../../../../components/hotel/tenant-settings-form';
import { PageHeader, Section } from '../../../../components/kit';
import { pageFor } from '../../../../lib/page-guards';
import type { PortalParams } from '../../../../lib/portal-params';
import { can, serverGet } from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage({ params }: PortalParams) {
  const session = await pageFor(params, 'hotel');
  const tenant = await serverGet<TenantProfile>('/tenant');
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <TenantSettingsForm tenant={tenant} canManage={can(session, 'tenant.manage')} />
        <Section title="Your sign-in">
          <p className="text-sm text-[var(--text-muted)]">
            {session.mfa === 'NONE'
              ? 'Protect your own account with two-factor authentication. '
              : ''}
            <Link href="/two-factor/setup" className="text-brand-600 hover:underline">
              Set up two-factor authentication
            </Link>
          </p>
        </Section>
      </div>
    </>
  );
}
