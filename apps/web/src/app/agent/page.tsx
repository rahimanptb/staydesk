import type { Metadata } from 'next';
import { PortalLanding } from '../../components/portal-landing';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agents' };

export default function AgentHome() {
  return <PortalLanding portal="agent" />;
}
