import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapSuperAdmin } from '../src/platform/bootstrap-super-admin.js';
import { base32Decode, hotp, timeStep } from '../src/security/totp.js';
import { Browser, HOSTS, startHarness, tokenFromMail, type Harness } from './support/harness.js';

/**
 * Milestone M1 end to end: identity, tenancy, RBAC and audit through the real HTTP API, guard,
 * row-level security and database roles (docs/11 §2: AZ-*, XT-01, PE rules).
 */

const PASSWORD = 'correct horse battery staple';
let h: Harness;

// Shared state, built up step by step.
const admin: { email: string; totpSecret: Buffer } = {
  email: 'root@platform.test',
  totpSecret: Buffer.alloc(0),
};
let planId = '';
let tenantA = '';
let tenantB = '';
let staffMembershipA = '';
let managerMembershipA = '';
let ownerA: Browser;
let ownerB: Browser;
let staffA: Browser;
let adminBrowser: Browser;

/** Creates a tenant through the platform API and returns its id. */
async function createTenant(name: string, slug: string, ownerEmail: string): Promise<string> {
  const res = await adminBrowser.post('/platform/tenants', {
    name,
    slug,
    country: 'IN',
    planId,
    owner: { name: `${name} Owner`, email: ownerEmail },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function acceptFromMail(email: string, name?: string): Promise<void> {
  const token = tokenFromMail(h.mailer, email);
  const visitor = new Browser(h, HOSTS.hotel);
  const res = await visitor.post('/auth/invitations/accept', {
    token,
    password: PASSWORD,
    ...(name ? { name } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
}

async function signedIn(host: string, email: string): Promise<Browser> {
  const browser = new Browser(h, host);
  const res = await browser.login(email, PASSWORD);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return browser;
}

beforeAll(async () => {
  h = await startHarness();
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('platform bootstrap and two-factor enrolment', () => {
  it('invites the first Super Admin and enforces the password policy on acceptance', async () => {
    const token = await bootstrapSuperAdmin(h.platformDb, {
      email: admin.email,
      name: 'Root Admin',
    });
    const visitor = new Browser(h, HOSTS.admin);

    const preview = await visitor.post('/auth/invitations/preview', { token });
    expect(preview.body).toMatchObject({
      email: admin.email,
      kind: 'PLATFORM',
      existingAccount: false,
    });

    const weak = await visitor.post('/auth/invitations/accept', { token, password: 'rootadmin1' });
    expect(weak.status).toBe(422);

    const ok = await visitor.post('/auth/invitations/accept', { token, password: PASSWORD });
    expect(ok.status).toBe(204);
    const reused = await visitor.post('/auth/invitations/accept', { token, password: PASSWORD });
    expect(reused.status).toBe(404);
  });

  it('requires two-factor enrolment before any platform action', async () => {
    adminBrowser = new Browser(h, HOSTS.admin);
    const login = await adminBrowser.login(admin.email, PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ context: 'PLATFORM', mfa: 'ENROLL' });

    const blocked = await adminBrowser.get('/platform/tenants');
    expect(blocked.status).toBe(401);
    expect(blocked.body).toMatchObject({ code: 'MFA_REQUIRED', meta: { mfa: 'ENROLL' } });

    const setup = await adminBrowser.post('/auth/mfa/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/StayDesk/);
    admin.totpSecret = base32Decode(setup.body.secret);

    const wrong = await adminBrowser.post('/auth/mfa/totp/enable', { code: '000000' });
    expect(wrong.status).toBe(422);
    const enabled = await adminBrowser.post('/auth/mfa/totp/enable', {
      code: hotp(admin.totpSecret, timeStep(Date.now())),
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body.mfa).toBe('NONE');
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    expect((await adminBrowser.get('/platform/tenants')).status).toBe(200);
  });

  it('asks for a code at the next sign-in and rejects a replayed code', async () => {
    const second = new Browser(h, HOSTS.admin);
    const login = await second.login(admin.email, PASSWORD);
    expect(login.body.mfa).toBe('VERIFY');
    const replay = await second.post('/auth/mfa/verify', {
      code: hotp(admin.totpSecret, timeStep(Date.now())),
    });
    expect(replay.status).toBe(401);
    const next = await second.post('/auth/mfa/verify', {
      code: hotp(admin.totpSecret, timeStep(Date.now()) + 1),
    });
    expect(next.status).toBe(200);
    expect(next.body.mfa).toBe('NONE');
  });
});

describe('tenant onboarding (F1)', () => {
  it('creates plans with configurable limits', async () => {
    const plan = await adminBrowser.post('/platform/plans', { code: 'starter', name: 'Starter' });
    expect(plan.status).toBe(201);
    expect(plan.body.code).toBe('STARTER');
    planId = plan.body.id;
    const limits = await adminBrowser.put(`/platform/plans/${planId}/entitlements`, {
      entitlements: [
        { key: 'limit.rooms', intValue: 50 },
        { key: 'feature.agentRequests', boolValue: false },
      ],
    });
    expect(limits.body.entitlements).toEqual([
      { key: 'feature.agentRequests', intValue: null, boolValue: false },
      { key: 'limit.rooms', intValue: 50, boolValue: null },
    ]);
  });

  it('creates tenants with invited owners, and rejects duplicate slugs', async () => {
    tenantA = await createTenant('Seaview Resorts', 'seaview', 'owner@seaview.test');
    tenantB = await createTenant('Hillside Hotels', 'hillside', 'owner@hillside.test');
    const duplicate = await adminBrowser.post('/platform/tenants', {
      name: 'Copy',
      slug: 'seaview',
      country: 'IN',
      planId,
      owner: { name: 'X', email: 'x@copy.test' },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ALREADY_EXISTS');
    expect(h.mailer.lastTo('owner@seaview.test')?.subject).toContain('Seaview Resorts');
  });

  it('lets owners accept and sign in to their own tenant only', async () => {
    await acceptFromMail('owner@seaview.test');
    await acceptFromMail('owner@hillside.test');
    ownerA = await signedIn(HOSTS.hotel, 'owner@seaview.test');
    ownerB = await signedIn(HOSTS.hotel, 'owner@hillside.test');

    const session = await ownerA.get('/auth/session');
    expect(session.body).toMatchObject({
      context: 'TENANT',
      current: { id: tenantA, name: 'Seaview Resorts', isOwner: true },
      mfa: 'NONE',
    });
    expect(session.body.permissions).toContain('user.manage');
    expect(session.body.permissions).toContain('supportAccess.manage');
  });
});

describe('staff management and privilege escalation (PE-1…PE-4)', () => {
  let staffRoleA = '';
  let managerRoleA = '';
  let adminRoleA = '';

  it('lists the system roles of the tenant', async () => {
    const roles = await ownerA.get('/roles');
    expect(roles.body.map((r: { key: string }) => r.key)).toEqual([
      'HOTEL_ADMIN',
      'HOTEL_MANAGER',
      'HOTEL_STAFF',
    ]);
    staffRoleA = roles.body.find((r: { key: string }) => r.key === 'HOTEL_STAFF').id;
    managerRoleA = roles.body.find((r: { key: string }) => r.key === 'HOTEL_MANAGER').id;
    adminRoleA = roles.body.find((r: { key: string }) => r.key === 'HOTEL_ADMIN').id;
  });

  it('invites staff who then sign in with only their permissions', async () => {
    const invite = await ownerA.post('/users/invitations', {
      email: 'priya@seaview.test',
      name: 'Priya Front Desk',
      roleId: staffRoleA,
    });
    expect(invite.status).toBe(201);
    expect(invite.body).toMatchObject({ status: 'INVITED', role: { key: 'HOTEL_STAFF' } });
    staffMembershipA = invite.body.id;

    await acceptFromMail('priya@seaview.test');
    staffA = await signedIn(HOSTS.hotel, 'priya@seaview.test');
    expect((await staffA.get('/tenant')).status).toBe(200);
    const forbidden = await staffA.get('/users');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
  });

  it('refuses inviting an existing member twice', async () => {
    const again = await ownerA.post('/users/invitations', {
      email: 'priya@seaview.test',
      name: 'Priya',
      roleId: staffRoleA,
    });
    expect(again.status).toBe(409);
  });

  it('PE-2: nobody can change their own access', async () => {
    const me = (await ownerA.get('/users')).body.find(
      (m: { user: { email: string } }) => m.user.email === 'owner@seaview.test',
    );
    const res = await ownerA.patch(`/users/${me.id}`, { roleId: staffRoleA });
    expect(res.status).toBe(403);
  });

  it('PE-3: only owners grant Hotel Admin; non-owner admins cannot touch owners', async () => {
    const manager = await ownerA.post('/users/invitations', {
      email: 'meera@seaview.test',
      name: 'Meera Manager',
      roleId: managerRoleA,
    });
    managerMembershipA = manager.body.id;
    await acceptFromMail('meera@seaview.test');
    const managerBrowser = await signedIn(HOSTS.hotel, 'meera@seaview.test');
    // Managers do not hold user.manage by default.
    const managerInvite = await managerBrowser.post('/users/invitations', {
      email: 'x@seaview.test',
      name: 'X',
      roleId: adminRoleA,
    });
    expect(managerInvite.status).toBe(403);

    const secondAdmin = await ownerA.post('/users/invitations', {
      email: 'arjun@seaview.test',
      name: 'Arjun Admin',
      roleId: adminRoleA,
    });
    expect(secondAdmin.status).toBe(201);
    await acceptFromMail('arjun@seaview.test');
    const arjun = await signedIn(HOSTS.hotel, 'arjun@seaview.test');
    const ownerMembership = (await arjun.get('/users')).body.find(
      (m: { isOwner: boolean }) => m.isOwner,
    );
    const demote = await arjun.patch(`/users/${ownerMembership.id}`, { roleId: staffRoleA });
    expect(demote.status).toBe(403);
    const grantAdmin = await arjun.patch(`/users/${staffMembershipA}`, { roleId: adminRoleA });
    expect(grantAdmin.status).toBe(403);
  });

  it('PE-1: role permissions are validated and editable roles only', async () => {
    const unknown = await ownerA.put(`/roles/${staffRoleA}/permissions`, {
      permissions: ['booking.view', 'nope.nope'],
    });
    expect(unknown.status).toBe(422);
    const platformPerm = await ownerA.put(`/roles/${staffRoleA}/permissions`, {
      permissions: ['platform.stats.view'],
    });
    expect(platformPerm.status).toBe(422);
    const adminRole = await ownerA.put(`/roles/${adminRoleA}/permissions`, { permissions: [] });
    expect(adminRole.status).toBe(403);

    const updated = await ownerA.put(`/roles/${staffRoleA}/permissions`, {
      permissions: ['booking.view', 'user.view'],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.permissions).toEqual(['booking.view', 'user.view']);
    // Takes effect on the staff member's very next request (permissions load per request).
    expect((await staffA.get('/users')).status).toBe(200);
  });

  it('PE-4: suspending a member signs them out at once; reactivation lets them back', async () => {
    expect((await ownerA.post(`/users/${staffMembershipA}/suspend`)).status).toBe(204);
    const after = await staffA.get('/tenant');
    expect(after.status).toBe(401);
    expect((await new Browser(h, HOSTS.hotel).login('priya@seaview.test', PASSWORD)).status).toBe(
      403,
    );

    expect((await ownerA.post(`/users/${staffMembershipA}/reactivate`)).status).toBe(204);
    staffA = await signedIn(HOSTS.hotel, 'priya@seaview.test');
  });

  it('restricts members to properties that exist in the tenant', async () => {
    const res = await ownerA.patch(`/users/${managerMembershipA}`, {
      allProperties: false,
      propertyIds: ['01900000-0000-7000-8000-000000000999'],
    });
    expect(res.status).toBe(422);
  });
});

describe('tenant isolation (XT-01)', () => {
  it("returns 404 for another tenant's members and never leaks data", async () => {
    const read = await ownerB.get(`/users/${staffMembershipA}`);
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain('priya');
    expect((await ownerB.patch(`/users/${staffMembershipA}`, { allProperties: true })).status).toBe(
      404,
    );
    expect((await ownerB.post(`/users/${staffMembershipA}/suspend`)).status).toBe(404);

    const usersB = await ownerB.get('/users');
    expect(usersB.body.map((m: { user: { email: string } }) => m.user.email)).toEqual([
      'owner@hillside.test',
    ]);
  });

  it("cannot edit another tenant's roles", async () => {
    const roleA = (await ownerA.get('/roles')).body.find(
      (r: { key: string }) => r.key === 'HOTEL_STAFF',
    ).id;
    expect((await ownerB.put(`/roles/${roleA}/permissions`, { permissions: [] })).status).toBe(404);
  });

  it('shows each tenant only its own audit log', async () => {
    const logA = await ownerA.get('/audit-logs?limit=100');
    const actionsA = logA.body.data.map((e: { action: string }) => e.action);
    expect(actionsA).toEqual(
      expect.arrayContaining([
        'tenant.create',
        'user.invited',
        'user.joined',
        'user.suspended',
        'user.reactivated',
        'role.permissions_changed',
      ]),
    );
    const logB = await ownerB.get('/audit-logs?limit=100');
    expect(JSON.stringify(logB.body)).not.toContain('seaview');
    expect(JSON.stringify(logB.body)).not.toContain('priya');
  });

  it('paginates the audit log with a stable cursor', async () => {
    const first = await ownerA.get('/audit-logs?limit=2');
    expect(first.body.data).toHaveLength(2);
    const second = await ownerA.get(`/audit-logs?limit=2&cursor=${first.body.nextCursor}`);
    const ids = [...first.body.data, ...second.body.data].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('sessions, CSRF and portal separation (AZ-03)', () => {
  it('rejects unsafe requests without the CSRF token or from another origin', async () => {
    const noToken = await staffA.raw('POST', '/auth/logout', {
      headers: { origin: `http://${HOSTS.hotel}` },
    });
    expect(noToken.status).toBe(403);
    expect(noToken.body.code).toBe('CSRF_FAILED');
    const evil = await staffA.raw('POST', '/auth/logout', {
      headers: { origin: 'https://evil.example', 'x-csrf-token': staffA.csrfToken! },
    });
    expect(evil.status).toBe(403);
    const noOrigin = await staffA.raw('POST', '/auth/logout', {
      headers: { 'x-csrf-token': staffA.csrfToken! },
    });
    expect(noOrigin.status).toBe(403);
  });

  it("does not accept one portal's session on another portal's host", async () => {
    const onAdmin = await new Browser(h, HOSTS.admin).raw('GET', '/platform/tenants', {
      cookie: ownerA.sessionCookie!,
    });
    expect(onAdmin.status).toBe(401);
    const onAgent = await new Browser(h, HOSTS.agent).raw('GET', '/auth/session', {
      cookie: ownerA.sessionCookie!,
    });
    expect(onAgent.status).toBe(401);
  });

  it('hides platform routes from hotel sessions and hotel routes from platform sessions', async () => {
    expect((await ownerA.get('/platform/tenants')).status).toBe(404);
    expect((await adminBrowser.get('/users')).status).toBe(404);
  });

  it('answers unknown hosts with 404 and unauthenticated requests with 401', async () => {
    expect((await new Browser(h, 'www.localhost:3000').get('/auth/session')).status).toBe(404);
    expect((await new Browser(h, HOSTS.hotel).get('/users')).status).toBe(401);
  });

  it('signs out', async () => {
    const browser = await signedIn(HOSTS.hotel, 'meera@seaview.test');
    expect((await browser.post('/auth/logout')).status).toBe(204);
    expect((await browser.get('/auth/session')).status).toBe(401);
  });
});

describe('credentials (F16, lockout, rate limits)', () => {
  it('resets a password by email and signs out every session', async () => {
    const unknown = await new Browser(h, HOSTS.hotel).post('/auth/password/forgot', {
      email: 'nobody@seaview.test',
    });
    expect(unknown.status).toBe(202);
    expect(h.mailer.lastTo('nobody@seaview.test')).toBeUndefined();

    expect(
      (await staffA.post('/auth/password/forgot', { email: 'priya@seaview.test' })).status,
    ).toBe(202);
    const token = tokenFromMail(h.mailer, 'priya@seaview.test');
    const reset = await new Browser(h, HOSTS.hotel).post('/auth/password/reset', {
      token,
      password: 'a brand new passphrase',
    });
    expect(reset.status).toBe(204);
    expect(h.mailer.lastTo('priya@seaview.test')?.subject).toMatch(/password was changed/);
    expect((await staffA.get('/tenant')).status).toBe(401);
    expect((await new Browser(h, HOSTS.hotel).login('priya@seaview.test', PASSWORD)).status).toBe(
      401,
    );
    expect(
      (await new Browser(h, HOSTS.hotel).login('priya@seaview.test', 'a brand new passphrase'))
        .status,
    ).toBe(200);
    const reuse = await new Browser(h, HOSTS.hotel).post('/auth/password/reset', {
      token,
      password: 'another passphrase 1',
    });
    expect(reuse.status).toBe(404);
  });

  it('rate-limits sign-in attempts per account', async () => {
    // Earlier tests signed this account in; start a fresh one-minute window (every attempt counts).
    h.clock.now += 61_000;
    const browser = new Browser(h, HOSTS.hotel);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await browser.login('meera@seaview.test', 'wrong password!')).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    h.clock.now += 61_000;
  });

  it('locks an account after 10 failures, even with the right password', async () => {
    const browser = new Browser(h, HOSTS.hotel);
    for (let i = 0; i < 5; i++) await browser.login('meera@seaview.test', 'wrong password!');
    h.clock.now += 61_000;
    const locked = await browser.login('meera@seaview.test', PASSWORD);
    expect(locked.status).toBe(401);
    expect(locked.body.detail).toBe('Email or password is incorrect');
    h.clock.now += 61_000;
  });

  it('uses one generic message for unknown accounts and wrong passwords', async () => {
    const unknown = await new Browser(h, HOSTS.hotel).login('ghost@nowhere.test', PASSWORD);
    const wrong = await new Browser(h, HOSTS.hotel).login('owner@hillside.test', 'wrong password!');
    expect(unknown.body.detail).toBe(wrong.body.detail);
  });
});

describe('tenant lifecycle (BR-24)', () => {
  it('a suspended tenant can read but not write', async () => {
    const suspend = await adminBrowser.post(`/platform/tenants/${tenantB}/suspend`, {
      reason: 'Payment overdue',
    });
    expect(suspend.body.status).toBe('SUSPENDED');
    expect((await ownerB.get('/tenant')).status).toBe(200);
    const write = await ownerB.patch('/tenant', { name: 'Renamed' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('TENANT_SUSPENDED');
  });

  it('a deactivated tenant is signed out', async () => {
    await adminBrowser.post(`/platform/tenants/${tenantB}/deactivate`, {
      reason: 'Closed account',
    });
    expect((await ownerB.get('/tenant')).status).toBe(401);
    expect((await new Browser(h, HOSTS.hotel).login('owner@hillside.test', PASSWORD)).status).toBe(
      403,
    );
  });

  it('platform admins see tenants but the platform role cannot read guests', async () => {
    const list = await adminBrowser.get('/platform/tenants');
    expect(list.body.map((t: { slug: string }) => t.slug).sort()).toEqual(['hillside', 'seaview']);
    await expect(h.platformDb.guest.findMany()).rejects.toThrow(/permission denied/i);
  });
});
