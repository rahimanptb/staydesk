import { expect } from 'vitest';
import { bootstrapSuperAdmin } from '../../src/platform/bootstrap-super-admin.js';
import { base32Decode, hotp, timeStep } from '../../src/security/totp.js';
import { Browser, HOSTS, tokenFromMail, type Harness } from './harness.js';

/** Shared test password (test databases only). */
export const PASSWORD = 'correct horse battery staple';

export async function acceptInvitation(
  h: Harness,
  email: string,
  host: string = HOSTS.hotel,
): Promise<void> {
  const token = tokenFromMail(h.mailer, email);
  const res = await new Browser(h, host).post('/auth/invitations/accept', {
    token,
    password: PASSWORD,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
}

export async function signIn(h: Harness, host: string, email: string): Promise<Browser> {
  const browser = new Browser(h, host);
  const res = await browser.login(email, PASSWORD);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return browser;
}

/** A Super Admin with two-factor enrolled, plus one active plan. */
export async function platformAdmin(h: Harness): Promise<{ admin: Browser; planId: string }> {
  const email = 'root@platform.test';
  const token = await bootstrapSuperAdmin(h.platformDb, { email, name: 'Root Admin' });
  const visitor = new Browser(h, HOSTS.admin);
  expect(
    (await visitor.post('/auth/invitations/accept', { token, password: PASSWORD })).status,
  ).toBe(204);
  const admin = await signIn(h, HOSTS.admin, email);
  const setup = await admin.post('/auth/mfa/totp/setup');
  const enabled = await admin.post('/auth/mfa/totp/enable', {
    code: hotp(base32Decode(setup.body.secret), timeStep(Date.now())),
  });
  expect(enabled.body.mfa).toBe('NONE');
  const plan = await admin.post('/platform/plans', { code: 'standard', name: 'Standard' });
  expect(plan.status).toBe(201);
  return { admin, planId: plan.body.id };
}

/** Creates a tenant through the platform API and signs its owner in on the hotel portal. */
export async function tenantWithOwner(
  h: Harness,
  admin: Browser,
  planId: string,
  input: { name: string; slug: string; ownerEmail: string },
): Promise<{ tenantId: string; owner: Browser }> {
  const res = await admin.post('/platform/tenants', {
    name: input.name,
    slug: input.slug,
    country: 'IN',
    planId,
    owner: { name: `${input.name} Owner`, email: input.ownerEmail },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await acceptInvitation(h, input.ownerEmail);
  return { tenantId: res.body.id, owner: await signIn(h, HOSTS.hotel, input.ownerEmail) };
}

export async function setPlanLimits(
  admin: Browser,
  planId: string,
  limits: Record<string, number>,
): Promise<void> {
  const res = await admin.put(`/platform/plans/${planId}/entitlements`, {
    entitlements: Object.entries(limits).map(([key, intValue]) => ({ key, intValue })),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
