import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type { Portal, SessionInfo } from '@staydesk/contracts';
import { getSession } from './server-api';

/** For pages that exist on one portal only: 404 elsewhere, sign-in when signed out. */
export async function pageFor(
  params: Promise<{ portal: string }>,
  portal: Portal,
): Promise<SessionInfo> {
  const { portal: actual } = await params;
  if (actual !== portal) notFound();
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
