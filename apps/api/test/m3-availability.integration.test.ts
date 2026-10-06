import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  createDbClient,
  inventoryTargets,
  repairInventory,
  rollInventoryHorizon,
  runReconciliation,
  type DbClient,
  type InventoryTarget,
} from '@staydesk/db';
import { pgErrorCode } from '@staydesk/db/testing';
import { LocalDate } from '@staydesk/domain';
import { HOSTS, startHarness, type Browser, type Harness } from './support/harness.js';
import { acceptInvitation, platformAdmin, signIn, tenantWithOwner } from './support/fixtures.js';
import { LedgerDriver } from './support/ledger.js';

/**
 * Milestone M3 end to end: the availability engine through the real API and database —
 * per-night arithmetic (AV-*), blocks and out of service (BL-*, OOS-*), stop-sell, the
 * concurrency guarantees (CC-*), the horizon roll and reconciliation.
 */

let h: Harness;
let owner: pg.Client;
let worker: DbClient;
let admin: Browser;
let ownerA: Browser;
let ownerB: Browser;
let ledger: LedgerDriver;
let tenantA = '';
let goa = '';
let kochi = '';
let deluxe = '';
let suite = '';
let villa = '';
const rooms: Record<string, string> = {};

let today: LocalDate;
const day = (n: number) => today.plusDays(n);
const iso = (n: number) => day(n).toString();
const KEY = () => `test-${crypto.randomUUID()}`;

async function createType(propertyId: string, body: Record<string, unknown>): Promise<string> {
  const res = await ownerA.post(`/properties/${propertyId}/room-types`, {
    maxAdults: 2,
    maxChildren: 1,
    maxOccupancy: 3,
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function grid(propertyId: string, from: number, to: number, browser = ownerA) {
  const res = await browser.get(
    `/properties/${propertyId}/availability?from=${iso(from)}&to=${iso(to)}`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    roomTypes: Array<{
      roomTypeId: string;
      nights: Array<{
        date: string;
        available: number;
        blocked: number;
        outOfService: number;
        booked: number;
        closedAll: boolean;
        closedAgents: boolean;
        status: string;
      }>;
    }>;
  };
}

async function nightsOf(propertyId: string, roomTypeId: string, from: number, to: number) {
  return (await grid(propertyId, from, to)).roomTypes.find((r) => r.roomTypeId === roomTypeId)!
    .nights;
}

async function availableOf(propertyId: string, roomTypeId: string, from: number, to: number) {
  return (await nightsOf(propertyId, roomTypeId, from, to)).map((n) => n.available);
}

const block = (body: Record<string, unknown>, browser = ownerA, key = KEY()) =>
  browser.post(
    `/properties/${goa}/blocks`,
    { reason: 'MAINTENANCE', ...body },
    { 'idempotency-key': key },
  );

async function target(propertyId: string): Promise<InventoryTarget> {
  return (await inventoryTargets(worker)).find((t) => t.propertyId === propertyId)!;
}

beforeAll(async () => {
  h = await startHarness();
  owner = await h.database.connect('sd_owner');
  worker = createDbClient({ connectionString: h.database.url('sd_worker'), max: 2 });
  today = LocalDate.todayIn('Asia/Kolkata');
  let planId: string;
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
  const session = await ownerA.get('/auth/session');
  ledger = new LedgerDriver(h, session.body.user.id);

  const property = async (code: string, name: string) => {
    const res = await ownerA.post('/properties', {
      name,
      code,
      timezone: 'Asia/Kolkata',
      country: 'IN',
      bookingHorizonDays: 365,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  goa = await property('GOA', 'Seaview Goa');
  kochi = await property('KOC', 'Seaview Kochi');
  deluxe = await createType(goa, { name: 'Deluxe', code: 'DLX', totalInventory: 10 });
  suite = await createType(goa, { name: 'Suite', code: 'STE', totalInventory: 1, sortOrder: 1 });
  villa = await createType(goa, {
    name: 'Pool Villa',
    code: 'VIL',
    trackRooms: true,
    sortOrder: 2,
  });
  const added = await ownerA.post(`/properties/${goa}/rooms`, {
    roomTypeId: villa,
    rooms: [{ number: 'V1' }, { number: 'V2' }, { number: 'V3' }],
  });
  expect(added.status, JSON.stringify(added.body)).toBe(201);
  for (const r of added.body) rooms[r.number] = r.id;
  await createType(kochi, { name: 'Deluxe', code: 'DLX', totalInventory: 10 });
}, 300_000);

afterAll(async () => {
  await worker?.$disconnect();
  await owner?.end();
  await h?.stop();
});

describe('inventory rows and the availability grid', () => {
  it('pre-creates nightly rows up to the booking horizon for a new room type', async () => {
    const { rows } = await owner.query(
      'SELECT count(*)::int AS n, min(date)::text AS first, max(date)::text AS last FROM inventory_day WHERE room_type_id = $1',
      [deluxe],
    );
    expect(rows[0]).toEqual({ n: 366, first: iso(0), last: iso(365) });
  });

  it('shows every active room type with per-night counts and status', async () => {
    const g = await grid(goa, 1, 4);
    expect(g.roomTypes.map((r) => r.roomTypeId)).toEqual([deluxe, suite, villa]);
    expect(g.roomTypes[0]!.nights.map((n) => [n.date, n.available, n.status])).toEqual([
      [iso(1), 10, 'AVAILABLE'],
      [iso(2), 10, 'AVAILABLE'],
      [iso(3), 10, 'AVAILABLE'],
    ]);
    expect(g.roomTypes[1]!.nights[0]).toMatchObject({ available: 1, status: 'LOW' });
    expect(g.roomTypes[2]!.nights[0]).toMatchObject({ available: 3 });
  });

  it('validates ranges: at most 92 nights, end after start', async () => {
    const tooLong = await ownerA.get(
      `/properties/${goa}/availability?from=${iso(0)}&to=${iso(93)}`,
    );
    expect(tooLong.status).toBe(422);
    const reversed = await ownerA.get(
      `/properties/${goa}/availability?from=${iso(3)}&to=${iso(3)}`,
    );
    expect(reversed.status).toBe(422);
    const invalid = await ownerA.get(
      `/properties/${goa}/availability?from=2026-02-30&to=${iso(3)}`,
    );
    expect(invalid.status).toBe(422);
  });

  it("does not reveal another tenant's availability", async () => {
    const res = await ownerB.get(`/properties/${goa}/availability?from=${iso(0)}&to=${iso(3)}`);
    expect(res.status).toBe(404);
  });
});

describe('availability arithmetic (AV-*)', () => {
  it('AV-01: the brief example — per-night 8/5/7/7/10 and a stay minimum of 5', async () => {
    const a = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(1),
      checkOut: day(3),
      lines: [{ roomTypeId: deluxe, rooms: 2 }],
    });
    const b = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(2),
      checkOut: day(5),
      lines: [{ roomTypeId: deluxe, rooms: 3 }],
    });
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await availableOf(goa, deluxe, 1, 6)).toEqual([8, 5, 7, 7, 10]);

    const quote = await ownerA.post(`/properties/${goa}/availability/check`, {
      checkIn: iso(1),
      checkOut: iso(5),
      rooms: 6,
      adults: 6,
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    const dlx = quote.body.results.find((r: { roomTypeId: string }) => r.roomTypeId === deluxe);
    expect(dlx).toMatchObject({
      available: 5,
      sellable: 5,
      limitingDate: iso(2),
      occupancyFits: true,
      canBook: false,
    });

    const six = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(1),
      checkOut: day(5),
      lines: [{ roomTypeId: deluxe, rooms: 6 }],
    });
    expect(six).toEqual({
      ok: false,
      code: 'NO_AVAILABILITY',
      meta: { shortfall: [{ roomTypeId: deluxe, date: iso(2), requested: 6, available: 5 }] },
    });
  });

  it('AV-02 / AV-03: the last room sells once per night; back-to-back stays both succeed', async () => {
    const first = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(10),
      checkOut: day(12),
      lines: [{ roomTypeId: suite, rooms: 1 }],
    });
    expect(first.ok).toBe(true);
    const overlapping = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(11),
      checkOut: day(13),
      lines: [{ roomTypeId: suite, rooms: 1 }],
    });
    expect(overlapping).toMatchObject({
      ok: false,
      code: 'NO_AVAILABILITY',
      meta: { shortfall: [{ date: iso(11), requested: 1, available: 0 }] },
    });
    const backToBack = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(12),
      checkOut: day(14),
      lines: [{ roomTypeId: suite, rooms: 1 }],
    });
    expect(backToBack.ok).toBe(true);
    expect((await nightsOf(goa, suite, 10, 14)).map((n) => n.status)).toEqual([
      'FULL',
      'FULL',
      'FULL',
      'FULL',
    ]);
  });

  it('AV-04: a shortfall on one room type rejects the whole multi-type booking', async () => {
    const before = await availableOf(goa, deluxe, 11, 12);
    const res = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(11),
      checkOut: day(12),
      lines: [
        { roomTypeId: deluxe, rooms: 1 },
        { roomTypeId: suite, rooms: 1 },
      ],
    });
    expect(res).toMatchObject({ ok: false, code: 'NO_AVAILABILITY' });
    expect(await availableOf(goa, deluxe, 11, 12)).toEqual(before);
  });

  it('AV-05: inventory in one property never affects another', async () => {
    const kochiGrid = await grid(kochi, 1, 6);
    expect(kochiGrid.roomTypes[0]!.nights.map((n) => n.available)).toEqual([10, 10, 10, 10, 10]);
  });

  it('applies stay policy to quotes (past dates, horizon, maximum stay)', async () => {
    const far = await ownerA.post(`/properties/${goa}/availability/check`, {
      checkIn: iso(364),
      checkOut: iso(367),
    });
    expect(far.body.code).toBe('BEYOND_HORIZON');
    const party = await ownerA.post(`/properties/${goa}/availability/check`, {
      checkIn: iso(30),
      checkOut: iso(31),
      rooms: 1,
      adults: 4,
    });
    expect(
      party.body.results.find((r: { roomTypeId: string }) => r.roomTypeId === deluxe),
    ).toMatchObject({ occupancyFits: false, canBook: false, sellable: 10 });
  });
});

describe('blocks and out of service (BL-*, OOS-*)', () => {
  it('requires an Idempotency-Key and replays a retried create exactly once', async () => {
    const body = {
      kind: 'BLOCK',
      roomTypeId: deluxe,
      quantity: 2,
      startDate: iso(60),
      endDate: iso(62),
    };
    const missing = await ownerA.post(`/properties/${goa}/blocks`, {
      reason: 'OWNER_USE',
      ...body,
    });
    expect(missing.status).toBe(428);

    const key = KEY();
    const first = await block({ ...body, reason: 'OWNER_USE' }, ownerA, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await block({ ...body, reason: 'OWNER_USE' }, ownerA, key);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((await nightsOf(goa, deluxe, 60, 62)).map((n) => n.blocked)).toEqual([2, 2]);

    const reused = await block({ ...body, quantity: 3, reason: 'OWNER_USE' }, ownerA, key);
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('BL-01: a block beyond availability conflicts; an authorised override is recorded', async () => {
    const conflict = await block({
      kind: 'BLOCK',
      roomTypeId: suite,
      quantity: 1,
      startDate: iso(11),
      endDate: iso(12),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('INVENTORY_CONFLICT');
    expect(conflict.body.meta.shortfall[0]).toMatchObject({ date: iso(11), available: 0 });

    const override = { override: { reason: 'Owner insists on holding the suite' } };
    const disabled = await block({
      kind: 'BLOCK',
      roomTypeId: suite,
      quantity: 1,
      startDate: iso(11),
      endDate: iso(12),
      ...override,
    });
    expect(disabled.status).toBe(403);

    expect((await ownerA.patch('/tenant', { overbookingEnabled: true })).status).toBe(200);
    const allowed = await block({
      kind: 'BLOCK',
      roomTypeId: suite,
      quantity: 1,
      startDate: iso(11),
      endDate: iso(12),
      reason: 'OWNER_USE',
      ...override,
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body.overrideUsed).toBe(true);
    const night = (await nightsOf(goa, suite, 11, 12))[0]!;
    expect(night).toMatchObject({ available: -1, status: 'OVERBOOKED' });
    const { rows } = await owner.query(
      'SELECT overbook_allowance FROM inventory_day WHERE room_type_id = $1 AND date = $2',
      [suite, iso(11)],
    );
    expect(rows[0].overbook_allowance).toBe(1);
    const audit = await ownerA.get('/audit-logs?limit=5');
    const entry = audit.body.data.find((e: { action: string }) => e.action === 'block.create');
    expect(entry.summary).toContain('exceeding availability');

    // Releasing it shrinks the allowance back automatically.
    const released = await ownerA.post(`/properties/${goa}/blocks/${allowed.body.id}/release`, {
      reason: 'Owner changed plans',
    });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const { rows: after } = await owner.query(
      'SELECT overbook_allowance FROM inventory_day WHERE room_type_id = $1 AND date = $2',
      [suite, iso(11)],
    );
    expect(after[0].overbook_allowance).toBe(0);
    expect((await ownerA.patch('/tenant', { overbookingEnabled: false })).status).toBe(200);
  });

  it('BL-02: releases by quantity and by date keep the counters and history exact', async () => {
    const created = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      quantity: 4,
      startDate: iso(20),
      endDate: iso(30),
      reason: 'GROUP_RESERVATION',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;

    const byQuantity = await ownerA.post(`/properties/${goa}/blocks/${id}/release`, {
      quantity: 1,
      reason: 'Group shrank',
    });
    expect(byQuantity.status, JSON.stringify(byQuantity.body)).toBe(200);
    expect(byQuantity.body.block).toMatchObject({
      quantity: 3,
      status: 'ACTIVE',
      originalQuantity: 4,
    });
    expect(byQuantity.body.remainder).toBeNull();

    const byDate = await ownerA.post(`/properties/${goa}/blocks/${id}/release`, {
      fromDate: iso(25),
      reason: 'Group leaves early',
    });
    expect(byDate.status, JSON.stringify(byDate.body)).toBe(200);
    expect(byDate.body.block).toMatchObject({
      status: 'RELEASED',
      endDate: iso(25),
      originalEndDate: iso(30),
      releaseReason: 'Group leaves early',
    });
    expect((await nightsOf(goa, deluxe, 19, 31)).map((n) => n.blocked)).toEqual([
      0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0,
    ]);

    const twice = await ownerA.post(`/properties/${goa}/blocks/${id}/release`, { reason: 'again' });
    expect(twice.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('BL-02: releasing some rooms of a running block splits it so past nights stay exact', async () => {
    const created = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      quantity: 3,
      startDate: iso(0),
      endDate: iso(8),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const past = await ownerA.post(`/properties/${goa}/blocks/${created.body.id}/release`, {
      fromDate: iso(-1),
      reason: 'x',
    });
    expect(past.body.code).toBe('DATE_IN_PAST');

    const split = await ownerA.post(`/properties/${goa}/blocks/${created.body.id}/release`, {
      fromDate: iso(6),
      quantity: 2,
      reason: 'Two rooms back on sale',
    });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect(split.body.block).toMatchObject({ status: 'RELEASED', endDate: iso(6), quantity: 3 });
    expect(split.body.remainder).toMatchObject({
      status: 'ACTIVE',
      startDate: iso(6),
      endDate: iso(8),
      quantity: 1,
      splitFromId: created.body.id,
    });
    expect((await nightsOf(goa, deluxe, 5, 9)).map((n) => n.blocked)).toEqual([3, 1, 1, 0]);

    const list = await ownerA.get(`/properties/${goa}/blocks?status=active&roomTypeId=${deluxe}`);
    expect(list.body.map((b: { id: string }) => b.id)).toContain(split.body.remainder.id);
    expect(list.body.map((b: { id: string }) => b.id)).not.toContain(created.body.id);
  });

  it('validates dates against today and the horizon', async () => {
    const past = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      startDate: iso(-2),
      endDate: iso(1),
    });
    expect(past.body.code).toBe('DATE_IN_PAST');
    const far = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      startDate: iso(300),
      endDate: iso(400),
    });
    expect(far.body.code).toBe('BEYOND_HORIZON');
    const reversed = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      startDate: iso(5),
      endDate: iso(5),
    });
    expect(reversed.status).toBe(422);
  });

  it('OOS-01: room-specific out of service reduces the count and holds the room', async () => {
    const oos = await block({
      kind: 'OUT_OF_SERVICE',
      roomTypeId: villa,
      roomId: rooms.V1,
      startDate: iso(3),
      endDate: iso(6),
    });
    expect(oos.status, JSON.stringify(oos.body)).toBe(201);
    expect(oos.body).toMatchObject({ roomNumber: 'V1', quantity: 1 });
    expect((await nightsOf(goa, villa, 2, 7)).map((n) => [n.outOfService, n.available])).toEqual([
      [0, 3],
      [1, 2],
      [1, 2],
      [1, 2],
      [0, 3],
    ]);

    const clash = await block({
      kind: 'BLOCK',
      roomTypeId: villa,
      roomId: rooms.V1,
      startDate: iso(5),
      endDate: iso(7),
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('ROOM_UNAVAILABLE');
    expect((await nightsOf(goa, villa, 6, 7))[0]!.blocked).toBe(0);

    const backToBack = await block({
      kind: 'BLOCK',
      roomTypeId: villa,
      roomId: rooms.V1,
      startDate: iso(6),
      endDate: iso(7),
    });
    expect(backToBack.status, JSON.stringify(backToBack.body)).toBe(201);

    const wrongType = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      roomId: rooms.V2,
      startDate: iso(6),
      endDate: iso(7),
    });
    expect(wrongType.status).toBe(422);

    const deactivate = await ownerA.patch(`/properties/${goa}/rooms/${rooms.V1}`, {
      status: 'INACTIVE',
    });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.code).toBe('INVENTORY_CONFLICT');
  });

  it('OOS-02: removing a room or cutting the total below commitments lists the conflict', async () => {
    const count = await block({
      kind: 'BLOCK',
      roomTypeId: villa,
      quantity: 2,
      startDate: iso(4),
      endDate: iso(5),
    });
    expect(count.status, JSON.stringify(count.body)).toBe(201);
    // Night 4: V1 out of service + 2 blocked = 3 of 3.
    const archive = await ownerA.post(`/properties/${goa}/rooms/${rooms.V3}/archive`);
    expect(archive.status).toBe(409);
    expect(archive.body).toMatchObject({
      code: 'INVENTORY_CONFLICT',
      meta: { nights: [{ date: iso(4), consumed: 3 }] },
    });

    const type = await ownerA.get(`/properties/${goa}/room-types/${deluxe}`);
    const cut = await ownerA.raw('PATCH', `/properties/${goa}/room-types/${deluxe}`, {
      body: { totalInventory: 4 },
      headers: {
        origin: `http://${HOSTS.hotel}`,
        'x-csrf-token': ownerA.csrfToken!,
        'if-match': `"v${type.body.version}"`,
      },
    });
    expect(cut.status).toBe(409);
    // Night 1: 2 booked + 3 still blocked by the split block above.
    expect(cut.body.meta.nights[0]).toEqual({ date: iso(1), consumed: 5 });
  });

  it('enforces kind-specific permissions', async () => {
    const roles = (await ownerA.get('/roles')).body;
    const invite = await ownerA.post('/users/invitations', {
      email: 'desk@seaview.test',
      name: 'Front Desk',
      roleId: roles.find((r: { key: string }) => r.key === 'HOTEL_STAFF').id,
    });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    await acceptInvitation(h, 'desk@seaview.test');
    const staff = await signIn(h, HOSTS.hotel, 'desk@seaview.test');

    expect((await grid(goa, 1, 3, staff)).roomTypes).toHaveLength(3);
    // Without booking.backdate, quotes for past dates are refused.
    const past = await staff.post(`/properties/${goa}/availability/check`, {
      checkIn: iso(-1),
      checkOut: iso(1),
    });
    expect(past.body.code).toBe('DATE_IN_PAST');
    expect((await staff.get(`/properties/${goa}/blocks`)).status).toBe(200);
    const denied = await block(
      { kind: 'BLOCK', roomTypeId: deluxe, startDate: iso(40), endDate: iso(41) },
      staff,
    );
    expect(denied.status).toBe(403);
    const oos = await block(
      { kind: 'OUT_OF_SERVICE', roomTypeId: deluxe, startDate: iso(40), endDate: iso(41) },
      staff,
    );
    expect(oos.status).toBe(403);
    const stop = await staff.post(`/properties/${goa}/stop-sells`, {
      startDate: iso(40),
      endDate: iso(41),
    });
    expect(stop.status).toBe(403);
  });
});

describe('stop-sell', () => {
  let agentsOnly = '';
  let deluxeClosed = '';

  it('closes nights per channel; overlapping stop-sells and lifts stay exact', async () => {
    const a = await ownerA.post(`/properties/${goa}/stop-sells`, {
      startDate: iso(40),
      endDate: iso(42),
      scope: 'AGENTS_ONLY',
      reason: 'Festival: direct bookings only',
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    agentsOnly = a.body.id;
    const b = await ownerA.post(`/properties/${goa}/stop-sells`, {
      roomTypeId: deluxe,
      startDate: iso(41),
      endDate: iso(43),
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    deluxeClosed = b.body.id;

    const nights = await nightsOf(goa, deluxe, 40, 44);
    expect(nights.map((n) => [n.closedAll, n.closedAgents, n.status])).toEqual([
      [false, true, 'AVAILABLE'],
      [true, true, 'CLOSED'],
      [true, false, 'CLOSED'],
      [false, false, 'AVAILABLE'],
    ]);
    expect((await nightsOf(goa, suite, 40, 41))[0]!.closedAgents).toBe(true);
  });

  it('refuses sales into a stop-sell but not blocks', async () => {
    const sale = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(41),
      checkOut: day(42),
      lines: [{ roomTypeId: deluxe, rooms: 1 }],
    });
    expect(sale).toMatchObject({ ok: false, code: 'CLOSED_FOR_SALE' });
    const agentSale = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(40),
      checkOut: day(41),
      lines: [{ roomTypeId: suite, rooms: 1 }],
      channel: 'AGENT',
    });
    expect(agentSale).toMatchObject({ ok: false, code: 'CLOSED_FOR_SALE' });
    const staffSale = await ledger.book({
      tenantId: tenantA,
      propertyId: goa,
      checkIn: day(40),
      checkOut: day(41),
      lines: [{ roomTypeId: suite, rooms: 1 }],
    });
    expect(staffSale.ok).toBe(true);
    const blocked = await block({
      kind: 'BLOCK',
      roomTypeId: deluxe,
      startDate: iso(41),
      endDate: iso(42),
    });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(201);
  });

  it('applies a property-wide stop-sell to room types created later', async () => {
    const late = await createType(goa, {
      name: 'Garden Room',
      code: 'GDN',
      totalInventory: 4,
      sortOrder: 3,
    });
    expect((await nightsOf(goa, late, 40, 42)).map((n) => n.closedAgents)).toEqual([true, true]);
  });

  it('lifts once, recomputing flags from what is still active', async () => {
    const lifted = await ownerA.post(`/properties/${goa}/stop-sells/${deluxeClosed}/lift`);
    expect(lifted.status, JSON.stringify(lifted.body)).toBe(200);
    expect(lifted.body.liftedBy.name).toBe('Seaview Resorts Owner');
    expect((await nightsOf(goa, deluxe, 40, 43)).map((n) => [n.closedAll, n.closedAgents])).toEqual(
      [
        [false, true],
        [false, true],
        [false, false],
      ],
    );
    const again = await ownerA.post(`/properties/${goa}/stop-sells/${deluxeClosed}/lift`);
    expect(again.body.code).toBe('INVALID_STATUS_TRANSITION');
    const active = await ownerA.get(`/properties/${goa}/stop-sells`);
    expect(active.body.map((s: { id: string }) => s.id)).toEqual([agentsOnly]);
  });

  it('validates stop-sell dates', async () => {
    const past = await ownerA.post(`/properties/${goa}/stop-sells`, {
      startDate: iso(-1),
      endDate: iso(2),
    });
    expect(past.body.code).toBe('DATE_IN_PAST');
    const far = await ownerA.post(`/properties/${goa}/stop-sells`, {
      startDate: iso(10),
      endDate: iso(500),
    });
    expect(far.body.code).toBe('BEYOND_HORIZON');
    const foreign = await ownerB.post(`/properties/${goa}/stop-sells`, {
      startDate: iso(10),
      endDate: iso(12),
    });
    expect(foreign.status).toBe(404);
  });
});

describe('concurrency (CC-*)', () => {
  it('CC-01: 50 parallel requests for the last room → exactly one succeeds', async () => {
    const last = await createType(goa, {
      name: 'Lighthouse',
      code: 'LHT',
      totalInventory: 1,
      sortOrder: 9,
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        ledger.book({
          tenantId: tenantA,
          propertyId: goa,
          checkIn: day(50),
          checkOut: day(52),
          lines: [{ roomTypeId: last, rooms: 1 }],
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 'NO_AVAILABILITY')).toHaveLength(49);
    expect((await nightsOf(goa, last, 50, 52)).map((n) => n.booked)).toEqual([1, 1]);
  }, 120_000);

  it('CC-02: overlapping multi-type bookings in conflicting orders never surface deadlocks', async () => {
    const x = await createType(goa, {
      name: 'Twin',
      code: 'TWN',
      totalInventory: 6,
      sortOrder: 10,
    });
    const y = await createType(goa, {
      name: 'Family',
      code: 'FAM',
      totalInventory: 6,
      sortOrder: 11,
    });
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        ledger.book({
          tenantId: tenantA,
          propertyId: goa,
          checkIn: day(70 + (i % 3)),
          checkOut: day(74 + (i % 2)),
          lines:
            i % 2 === 0
              ? [
                  { roomTypeId: x, rooms: 1 },
                  { roomTypeId: y, rooms: 1 },
                ]
              : [
                  { roomTypeId: y, rooms: 1 },
                  { roomTypeId: x, rooms: 1 },
                ],
        }),
      ),
    );
    for (const r of results) if (!r.ok) expect(r.code).toBe('NO_AVAILABILITY');
    const nights = await grid(goa, 70, 75);
    for (const type of nights.roomTypes.filter((t) => t.roomTypeId === x || t.roomTypeId === y)) {
      for (const n of type.nights) expect(n.available).toBeGreaterThanOrEqual(0);
    }
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('CC-03: a block racing a booking for the last room → exactly one wins', async () => {
    const solo = await createType(goa, {
      name: 'Tree House',
      code: 'TRH',
      totalInventory: 1,
      sortOrder: 12,
    });
    const [blocked, booked] = await Promise.all([
      block({ kind: 'BLOCK', roomTypeId: solo, startDate: iso(80), endDate: iso(82) }),
      ledger.book({
        tenantId: tenantA,
        propertyId: goa,
        checkIn: day(81),
        checkOut: day(83),
        lines: [{ roomTypeId: solo, rooms: 1 }],
      }),
    ]);
    expect([blocked.status === 201, booked.ok].filter(Boolean)).toHaveLength(1);
  }, 60_000);

  it('CC-04: total reductions racing bookings never leave consumption above the total', async () => {
    const pool = await createType(goa, {
      name: 'Bunk',
      code: 'BNK',
      totalInventory: 5,
      sortOrder: 13,
    });
    const type = await ownerA.get(`/properties/${goa}/room-types/${pool}`);
    const [cut, ...bookings] = await Promise.all([
      ownerA.raw('PATCH', `/properties/${goa}/room-types/${pool}`, {
        body: { totalInventory: 2 },
        headers: {
          origin: `http://${HOSTS.hotel}`,
          'x-csrf-token': ownerA.csrfToken!,
          'if-match': `"v${type.body.version}"`,
        },
      }),
      ...Array.from({ length: 8 }, () =>
        ledger.book({
          tenantId: tenantA,
          propertyId: goa,
          checkIn: day(90),
          checkOut: day(91),
          lines: [{ roomTypeId: pool, rooms: 1 }],
        }),
      ),
    ]);
    const { rows } = await owner.query(
      'SELECT total, booked FROM inventory_day WHERE room_type_id = $1 AND date = $2',
      [pool, iso(90)],
    );
    expect(rows[0].booked).toBeLessThanOrEqual(rows[0].total);
    expect(rows[0].booked).toBe(bookings.filter((b) => b.ok).length);
    expect(rows[0].total).toBe(cut.status === 200 ? 2 : 5);
  }, 60_000);
});

describe('horizon roll and reconciliation', () => {
  it('lists properties for the worker only through its definer function', async () => {
    const targets = await inventoryTargets(worker);
    expect(targets.map((t) => t.propertyId)).toEqual(expect.arrayContaining([goa, kochi]));
    const app = await h.database.connect('sd_app');
    try {
      expect(await pgErrorCode(app.query('SELECT * FROM worker_inventory_targets()'))).toBe(
        '42501',
      );
    } finally {
      await app.end();
    }
  });

  it('rolls the horizon forward idempotently', async () => {
    await owner.query('DELETE FROM inventory_day WHERE room_type_id = $1 AND date > $2', [
      deluxe,
      iso(300),
    ]);
    const t = await target(goa);
    expect(await rollInventoryHorizon(worker, t)).toBe(65);
    expect(await rollInventoryHorizon(worker, t)).toBe(0);
  });

  it('stays clean after randomised load', async () => {
    let seed = 7;
    const random = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    const types = [deluxe, suite, villa];
    const bookings: string[] = [];
    const blocks: string[] = [];
    for (let i = 0; i < 60; i++) {
      const start = 100 + random(20);
      const end = start + 1 + random(5);
      const roomTypeId = types[random(types.length)]!;
      const action = random(4);
      if (action === 0) {
        const r = await ledger.book({
          tenantId: tenantA,
          propertyId: goa,
          checkIn: day(start),
          checkOut: day(end),
          lines: [{ roomTypeId, rooms: 1 + random(2) }],
          bucket: random(2) === 0 ? 'HELD' : 'BOOKED',
        });
        if (r.ok) bookings.push(r.bookingId);
      } else if (action === 1 && bookings.length > 0) {
        await ledger.cancel(tenantA, bookings.splice(random(bookings.length), 1)[0]!);
      } else if (action === 2) {
        const res = await block({
          kind: random(2) === 0 ? 'BLOCK' : 'OUT_OF_SERVICE',
          roomTypeId,
          quantity: 1 + random(2),
          startDate: iso(start),
          endDate: iso(end),
        });
        if (res.status === 201) blocks.push(res.body.id);
      } else if (blocks.length > 0) {
        const id = blocks[random(blocks.length)]!;
        const detail = await ownerA.get(`/properties/${goa}/blocks/${id}`);
        if (detail.body.status === 'ACTIVE') {
          await ownerA.post(`/properties/${goa}/blocks/${id}/release`, {
            fromDate: iso(Math.max(100, start)),
            ...(detail.body.quantity > 1 ? { quantity: 1 } : {}),
            reason: 'load test',
          });
        }
      }
    }
    for (const propertyId of [goa, kochi]) {
      const run = await runReconciliation(worker, await target(propertyId));
      expect(run.mismatches).toEqual([]);
    }
  }, 180_000);

  it('detects drift as an incident and repairs only through the audited command', async () => {
    await owner.query(
      'UPDATE inventory_day SET booked = booked + 1, total = total + 1 WHERE room_type_id = $1 AND date = $2',
      [deluxe, iso(150)],
    );
    await owner.query(
      'UPDATE inventory_day SET closed_all = true WHERE room_type_id = $1 AND date = $2',
      [deluxe, iso(151)],
    );
    const t = await target(goa);
    const run = await runReconciliation(worker, t);
    expect(run.mismatchCount).toBe(3);
    expect(run.mismatches.map((m) => [m.kind, m.date])).toEqual([
      ['CLOSURE', iso(151)],
      ['COUNTERS', iso(150)],
      ['TOTAL', iso(150)],
    ]);
    const { rows: alerts } = await owner.query(
      "SELECT payload FROM outbox_event WHERE type = 'inventory.reconciliation_failed'",
    );
    expect(alerts.at(-1).payload).toMatchObject({ reconciliationId: run.id, mismatchCount: 3 });

    await expect(repairInventory(worker, t, { actor: 'ops', reason: 'x' })).rejects.toThrow();
    const repaired = await repairInventory(worker, t, {
      actor: 'ops@staydesk',
      reason: 'Manual SQL edit during incident drill',
    });
    expect(repaired.before.mismatchCount).toBe(3);
    expect(repaired.after.mismatchCount).toBe(0);
    expect((await runReconciliation(worker, t)).mismatchCount).toBe(0);

    const { rows: runs } = await owner.query(
      'SELECT trigger::text, mismatch_count FROM inventory_reconciliation WHERE property_id = $1 ORDER BY started_at',
      [goa],
    );
    expect(runs.map((r) => r.trigger)).toContain('REPAIR');
    const audit = await ownerA.get('/audit-logs?limit=5');
    expect(audit.body.data[0]).toMatchObject({ action: 'inventory.repair' });
  });

  it('keeps reconciliation records append-only for runtime roles', async () => {
    const app = await h.database.connect('sd_worker');
    try {
      expect(await pgErrorCode(app.query('DELETE FROM inventory_reconciliation'))).toBe('42501');
    } finally {
      await app.end();
    }
  });
});
