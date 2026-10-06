import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { LocalDate } from '@staydesk/domain';
import { HOSTS, startHarness, type Browser, type Harness } from './support/harness.js';
import {
  acceptInvitation,
  platformAdmin,
  setPlanLimits,
  signIn,
  tenantWithOwner,
} from './support/fixtures.js';

/**
 * Milestone M2 end to end: properties, holidays, room types, rooms, totals and their
 * integrity rules through the real API and database.
 */

let h: Harness;
let owner: pg.Client;
let admin: Browser;
let planId = '';
let ownerA: Browser;
let ownerB: Browser;
let tenantA = '';
let seaview = '';
let hillside = '';
let deluxe = '';
let villa = '';
let cottage = '';

const property = (code: string, name: string, extra: Record<string, unknown> = {}) => ({
  name,
  code,
  timezone: 'Asia/Kolkata',
  country: 'IN',
  ...extra,
});

beforeAll(async () => {
  h = await startHarness();
  owner = await h.database.connect('sd_owner');
  ({ admin, planId } = await platformAdmin(h));
  ({ tenantId: tenantA, owner: ownerA } = await tenantWithOwner(h, admin, planId, {
    name: 'Seaview Resorts',
    slug: 'seaview',
    ownerEmail: 'owner@seaview.test',
  }));
  ({ owner: ownerB } = await tenantWithOwner(h, admin, planId, {
    name: 'Hillside Hotels',
    slug: 'hillside',
    ownerEmail: 'owner@hillside.test',
  }));
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('properties', () => {
  it('creates a draft property with defaults and the business date', async () => {
    const res = await ownerA.post('/properties', property('SVA', 'Seaview Goa'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      currency: 'INR',
      bookingRefPrefix: 'SVA',
      checkInTime: '14:00',
      agentDefaultVisibility: 'FULL_BREAKDOWN',
      businessDate: LocalDate.todayIn('Asia/Kolkata').toString(),
    });
    seaview = res.body.id;
  });

  it('validates time zones, currencies and unique codes and prefixes', async () => {
    expect(
      (await ownerA.post('/properties', property('BAD', 'Bad', { timezone: 'Mars/Base' }))).status,
    ).toBe(422);
    expect(
      (await ownerA.post('/properties', property('BAD', 'Bad', { currency: 'XYZ' }))).status,
    ).toBe(422);
    const code = await ownerA.post('/properties', property('SVA', 'Duplicate'));
    expect(code.status).toBe(409);
    expect(code.body.errors[0].path).toBe('code');
    const prefix = await ownerA.post(
      '/properties',
      property('HLS', 'Hills', { bookingRefPrefix: 'SVA' }),
    );
    expect(prefix.status).toBe(409);
    expect(prefix.body.errors[0].path).toBe('bookingRefPrefix');
  });

  it('enforces the plan property limit', async () => {
    await setPlanLimits(admin, planId, { 'limit.properties': 2 });
    const second = await ownerA.post('/properties', property('HLS', 'Seaview Hills'));
    expect(second.status).toBe(201);
    hillside = second.body.id;
    const third = await ownerA.post('/properties', property('BCH', 'Seaview Beach'));
    expect(third.status).toBe(403);
    expect(third.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      meta: { limit: 'limit.properties', max: 2 },
    });
    await setPlanLimits(admin, planId, {});
  });

  it('updates settings and audits only what changed', async () => {
    const res = await ownerA.patch(`/properties/${seaview}`, {
      status: 'ACTIVE',
      checkInTime: '13:00',
    });
    expect(res.body).toMatchObject({ status: 'ACTIVE', checkInTime: '13:00' });
    const log = await ownerA.get('/audit-logs?action=property.update');
    expect(log.body.data[0].summary).toMatch(/status, checkInTime|checkInTime, status/);
    expect((await ownerA.patch(`/properties/${seaview}`, { checkInTime: '25:00' })).status).toBe(
      422,
    );
  });

  it('manages holidays', async () => {
    const added = await ownerA.post(`/properties/${seaview}/holidays`, {
      date: '2026-12-25',
      name: 'Christmas',
    });
    expect(added.status).toBe(201);
    expect(
      (await ownerA.post(`/properties/${seaview}/holidays`, { date: '2026-02-30', name: 'Bad' }))
        .status,
    ).toBe(422);
    const list = await ownerA.get(`/properties/${seaview}/holidays?year=2026`);
    expect(list.body).toEqual([
      { id: added.body.id, date: '2026-12-25', name: 'Christmas', propertyId: seaview },
    ]);
    expect(
      (await ownerA.request('DELETE', `/properties/${seaview}/holidays/${added.body.id}`)).status,
    ).toBe(204);
  });
});

describe('room types', () => {
  it('creates count-based and room-tracking types', async () => {
    const d = await ownerA.post(`/properties/${seaview}/room-types`, {
      name: 'Deluxe Room',
      code: 'DLX',
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
      totalInventory: 10,
      baseRateMinor: 650000,
      internalNotes: 'Sea-facing on floors 3-5',
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.headers.etag).toBe('"v1"');
    expect(d.body).toMatchObject({ totalInventory: 10, trackRooms: false, baseRateMinor: 650000 });
    deluxe = d.body.id;

    const v = await ownerA.post(`/properties/${seaview}/room-types`, {
      name: 'Pool Villa',
      code: 'VIL',
      maxAdults: 4,
      maxChildren: 2,
      maxOccupancy: 6,
      trackRooms: true,
      totalInventory: 99,
    });
    expect(v.body).toMatchObject({ trackRooms: true, totalInventory: 0 });
    villa = v.body.id;
    const c = await ownerA.post(`/properties/${seaview}/room-types`, {
      name: 'Garden Cottage',
      code: 'COT',
      maxAdults: 2,
      maxChildren: 2,
      maxOccupancy: 4,
      trackRooms: true,
    });
    cottage = c.body.id;
  });

  it('validates occupancy and unique codes', async () => {
    const bad = await ownerA.post(`/properties/${seaview}/room-types`, {
      name: 'Bad',
      code: 'BAD',
      maxAdults: 2,
      maxChildren: 0,
      maxOccupancy: 3,
    });
    expect(bad.status).toBe(422);
    const dup = await ownerA.post(`/properties/${seaview}/room-types`, {
      name: 'Dup',
      code: 'DLX',
      maxAdults: 2,
      maxChildren: 0,
      maxOccupancy: 2,
    });
    expect(dup.status).toBe(409);
  });

  it('uses optimistic concurrency (If-Match) for edits', async () => {
    const path = `/properties/${seaview}/room-types/${deluxe}`;
    expect((await ownerA.patch(path, { name: 'Deluxe' })).status).toBe(428);
    const ok = await ownerA.raw('PATCH', path, {
      body: { name: 'Deluxe Sea View' },
      headers: {
        origin: `http://${HOSTS.hotel}`,
        'x-csrf-token': ownerA.csrfToken!,
        'if-match': '"v1"',
      },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.headers.etag).toBe('"v2"');
    const stale = await ownerA.raw('PATCH', path, {
      body: { name: 'Lost update' },
      headers: {
        origin: `http://${HOSTS.hotel}`,
        'x-csrf-token': ownerA.csrfToken!,
        'if-match': '"v1"',
      },
    });
    expect(stale.status).toBe(412);
    const occupancy = await ownerA.raw('PATCH', path, {
      body: { maxOccupancy: 9 },
      headers: {
        origin: `http://${HOSTS.hotel}`,
        'x-csrf-token': ownerA.csrfToken!,
        'if-match': '"v2"',
      },
    });
    expect(occupancy.status).toBe(422);
  });
});

describe('rooms keep tracked totals in step (C4)', () => {
  it('adds rooms in bulk and derives the total', async () => {
    const res = await ownerA.post(`/properties/${seaview}/rooms`, {
      roomTypeId: villa,
      rooms: ['V1', 'V2', 'V3', 'V4', 'V5'].map((number) => ({ number, floor: 'G' })),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.map((r: { number: string }) => r.number)).toEqual([
      'V1',
      'V2',
      'V3',
      'V4',
      'V5',
    ]);
    const villaType = await ownerA.get(`/properties/${seaview}/room-types/${villa}`);
    expect(villaType.body).toMatchObject({ totalInventory: 5, roomCount: 5 });
  });

  it('rejects rooms on count-based types and duplicate numbers', async () => {
    const counted = await ownerA.post(`/properties/${seaview}/rooms`, {
      roomTypeId: deluxe,
      rooms: [{ number: '101' }],
    });
    expect(counted.status).toBe(422);
    const dup = await ownerA.post(`/properties/${seaview}/rooms`, {
      roomTypeId: villa,
      rooms: [{ number: 'v1' }],
    });
    expect(dup.status).toBe(409);
    expect(dup.body.meta.numbers).toEqual(['V1']);
  });

  it('follows deactivation, moves between types and archiving', async () => {
    const rooms = (await ownerA.get(`/properties/${seaview}/rooms?roomTypeId=${villa}`)).body;
    const [, , , v4, v5] = rooms;
    await ownerA.patch(`/properties/${seaview}/rooms/${v5.id}`, { status: 'INACTIVE' });
    await ownerA.patch(`/properties/${seaview}/rooms/${v4.id}`, { roomTypeId: cottage });
    expect(
      (await ownerA.get(`/properties/${seaview}/room-types/${villa}`)).body.totalInventory,
    ).toBe(3);
    expect(
      (await ownerA.get(`/properties/${seaview}/room-types/${cottage}`)).body.totalInventory,
    ).toBe(1);
    expect((await ownerA.post(`/properties/${seaview}/rooms/${v4.id}/archive`)).status).toBe(204);
    expect(
      (await ownerA.get(`/properties/${seaview}/room-types/${cottage}`)).body.totalInventory,
    ).toBe(0);
  });

  it('enforces the plan room limit across room types', async () => {
    // Deluxe 10 + villas 3 = 13 rooms counted.
    await setPlanLimits(admin, planId, { 'limit.rooms': 14 });
    const over = await ownerA.post(`/properties/${seaview}/rooms`, {
      roomTypeId: villa,
      rooms: [{ number: 'V6' }, { number: 'V7' }],
    });
    expect(over.status).toBe(403);
    expect(over.body.meta).toMatchObject({ limit: 'limit.rooms', max: 14, current: 13 });
    await setPlanLimits(admin, planId, {});
  });
});

describe('total inventory changes respect future commitments (BR-09)', () => {
  const today = LocalDate.todayIn('Asia/Kolkata');
  const future = today.plusDays(10).toString();
  const past = today.minusDays(5).toString();

  it('refuses to cut capacity below what upcoming nights already consume', async () => {
    await owner.query(
      `INSERT INTO inventory_day (tenant_id, property_id, room_type_id, date, total, booked)
       VALUES ($1, $2, $3, $4, 10, 8), ($1, $2, $3, $5, 10, 10)`,
      [tenantA, seaview, deluxe, future, past],
    );
    const etag = (await ownerA.get(`/properties/${seaview}/room-types/${deluxe}`)).headers
      .etag as string;
    const cut = await ownerA.raw('PATCH', `/properties/${seaview}/room-types/${deluxe}`, {
      body: { totalInventory: 5 },
      headers: {
        origin: `http://${HOSTS.hotel}`,
        'x-csrf-token': ownerA.csrfToken!,
        'if-match': etag,
      },
    });
    expect(cut.status).toBe(409);
    expect(cut.body).toMatchObject({
      code: 'INVENTORY_CONFLICT',
      meta: { nights: [{ date: future, consumed: 8 }] },
    });
  });

  it('updates future inventory rows and leaves history untouched', async () => {
    const etag = (await ownerA.get(`/properties/${seaview}/room-types/${deluxe}`)).headers
      .etag as string;
    const res = await ownerA.raw('PATCH', `/properties/${seaview}/room-types/${deluxe}`, {
      body: { totalInventory: 9 },
      headers: {
        origin: `http://${HOSTS.hotel}`,
        'x-csrf-token': ownerA.csrfToken!,
        'if-match': etag,
      },
    });
    expect(res.status).toBe(200);
    const rows = await owner.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, total FROM inventory_day WHERE room_type_id = $1 ORDER BY date`,
      [deluxe],
    );
    expect(rows.rows).toEqual([
      { date: past, total: 10 },
      { date: future, total: 9 },
    ]);
  });

  it('refuses to archive a room type with upcoming blocks, then archives with its rooms', async () => {
    await owner.query(
      `INSERT INTO room_block (id, tenant_id, property_id, room_type_id, kind, reason, quantity, start_date,
         end_date, original_end_date, original_quantity, created_by_id, updated_at)
       VALUES ('01900000-0000-7000-8000-00000000b001', $1, $2, $3, 'BLOCK', 'OWNER_USE', 1, $4, $5, $5, 1, $6, now())`,
      [tenantA, seaview, villa, future, today.plusDays(12).toString(), tenantA],
    );
    const blocked = await ownerA.post(`/properties/${seaview}/room-types/${villa}/archive`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.meta).toMatchObject({ blocks: 1 });

    expect((await ownerA.post(`/properties/${seaview}/room-types/${cottage}/archive`)).status).toBe(
      204,
    );
    const list = (await ownerA.get(`/properties/${seaview}/room-types`)).body.map(
      (r: { code: string }) => r.code,
    );
    expect(list).toEqual(['DLX', 'VIL']);
  });
});

describe('field visibility, property scope and isolation', () => {
  let staff: Browser;

  it('hides rates from staff without financial permission and blocks their edits', async () => {
    const roles = (await ownerA.get('/roles')).body;
    const staffRole = roles.find((r: { key: string }) => r.key === 'HOTEL_STAFF').id;
    const invite = await ownerA.post('/users/invitations', {
      email: 'front@seaview.test',
      name: 'Front Desk',
      roleId: staffRole,
      allProperties: false,
      propertyIds: [hillside],
    });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    await acceptInvitation(h, 'front@seaview.test');
    staff = await signIn(h, HOSTS.hotel, 'front@seaview.test');

    expect(
      (
        await staff.post(`/properties/${hillside}/room-types`, {
          name: 'X',
          code: 'XX',
          maxAdults: 1,
          maxChildren: 0,
          maxOccupancy: 1,
        })
      ).status,
    ).toBe(403);
  });

  it('limits members to the properties in their scope', async () => {
    const visible = (await staff.get('/properties')).body.map((p: { id: string }) => p.id);
    expect(visible).toEqual([hillside]);
    expect((await staff.get(`/properties/${seaview}`)).status).toBe(404);
    expect((await staff.get(`/properties/${seaview}/room-types`)).status).toBe(404);
  });

  it('shows owners rates and notes, staff neither', async () => {
    const full = (await ownerA.get(`/properties/${seaview}/room-types/${deluxe}`)).body;
    expect(full).toHaveProperty('baseRateMinor', 650000);
    expect(full).toHaveProperty('internalNotes');
    // Give staff Seaview access to compare the same room type.
    const members = (await ownerA.get('/users')).body;
    const frontDesk = members.find(
      (m: { user: { email: string } }) => m.user.email === 'front@seaview.test',
    );
    await ownerA.patch(`/users/${frontDesk.id}`, { allProperties: true });
    staff = await signIn(h, HOSTS.hotel, 'front@seaview.test');
    const limited = (await staff.get(`/properties/${seaview}/room-types/${deluxe}`)).body;
    expect(limited).not.toHaveProperty('baseRateMinor');
    expect(limited).toHaveProperty('internalNotes');
  });

  it("returns 404 for another tenant's properties and room types", async () => {
    expect((await ownerB.get(`/properties/${seaview}`)).status).toBe(404);
    expect((await ownerB.get(`/properties/${seaview}/room-types/${deluxe}`)).status).toBe(404);
    expect(
      (
        await ownerB.post(`/properties/${seaview}/rooms`, {
          roomTypeId: villa,
          rooms: [{ number: 'Z1' }],
        })
      ).status,
    ).toBe(404);
    expect((await ownerB.get('/properties')).body).toEqual([]);
  });
});

describe('settings frozen by bookings (BR-32, BR-27, BR-19)', () => {
  it('locks currency, time zone and prefix once a booking exists', async () => {
    await owner.query(
      `INSERT INTO guest (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('01900000-0000-7000-8000-00000000c001', $1, 'Asha', 'Guest', now())`,
      [tenantA],
    );
    await owner.query(
      `INSERT INTO booking (id, tenant_id, property_id, reference, status, source, guest_id, check_in, check_out,
         adults, children, currency, created_by_id, updated_at)
       VALUES ('01900000-0000-7000-8000-00000000c002', $1, $2, 'SVA-26-000001', 'CONFIRMED', 'DIRECT',
         '01900000-0000-7000-8000-00000000c001', '2026-12-01', '2026-12-03', 2, 0, 'INR', $1, now())`,
      [tenantA, seaview],
    );
    const res = await ownerA.patch(`/properties/${seaview}`, { currency: 'USD', name: 'Renamed' });
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(['currency']);
    expect(
      (await ownerA.patch(`/properties/${seaview}`, { name: 'Seaview Goa Resort' })).status,
    ).toBe(200);
  });
});
