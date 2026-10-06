import type { Metadata } from 'next';
import { PortalLanding } from '../../components/portal-landing';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin' };

export default function AdminHome() {
  return <PortalLanding portal="admin" />;
}
