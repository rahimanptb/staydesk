import type { Metadata } from 'next';
import { PortalLanding } from '../../components/portal-landing';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Hotel' };

export default function HotelHome() {
  return <PortalLanding portal="hotel" />;
}
