import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  inContext,
  pgErrorCode,
  startTestDatabase,
  type TestDatabase,
} from '../src/testing/index.js';

/**
 * Database-level guarantees (docs/10 §4, docs/11 XT-02/XT-03). These hold even if application
 * code is wrong, so they are tested directly against PostgreSQL as each runtime role.
 */

// PostgreSQL error codes
const INSUFFICIENT_PRIVILEGE = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const T_A = id(1);
const T_B = id(2);
const P_A = id(11);
const P_B = id(12);
const RT_A = id(21);
const RT_B = id(22);
const ROOM_A = id(31);
const GUEST_A = id(41);
const GUEST_B = id(42);
const USER_1 = id(51);
const ROLE_A = id(61);
const ROLE_B = id(62);

let db: TestDatabase;
let owner: pg.Client;
let app: pg.Client;
let platform: pg.Client;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = await db.connect('sd_owner');
  app = await db.connect('sd_app');
  platform = await db.connect('sd_platform');

  // Seed as the schema owner (RLS does not apply to the table owner).
  await owner.query(`
    INSERT INTO tenant (id, name, slug, country, status, updated_at) VALUES
      ('${T_A}', 'Hotel A Group', 'a', 'IN', 'ACTIVE', now()),
      ('${T_B}', 'Hotel B Group', 'b', 'IN', 'ACTIVE', now());
    INSERT INTO property (id, tenant_id, name, code, timezone, country, booking_ref_prefix, updated_at) VALUES
      ('${P_A}', '${T_A}', 'Seaview A', 'SVA', 'Asia/Kolkata', 'IN', 'SVA', now()),
      ('${P_B}', '${T_B}', 'Hillside B', 'HSB', 'Asia/Kolkata', 'IN', 'HSB', now());
    INSERT INTO room_type (id, tenant_id, property_id, name, code, max_adults, max_children, max_occupancy, total_inventory, track_rooms, updated_at) VALUES
      ('${RT_A}', '${T_A}', '${P_A}', 'Deluxe', 'DLX', 2, 1, 3, 1, true, now()),
      ('${RT_B}', '${T_B}', '${P_B}', 'Suite', 'STE', 2, 2, 4, 5, false, now());
    INSERT INTO room (id, tenant_id, property_id, room_type_id, number, updated_at) VALUES
      ('${ROOM_A}', '${T_A}', '${P_A}', '${RT_A}', '101', now());
    INSERT INTO guest (id, tenant_id, first_name, last_name, updated_at) VALUES
      ('${GUEST_A}', '${T_A}', 'Asha', 'A', now()),
      ('${GUEST_B}', '${T_B}', 'Bilal', 'B', now());
    INSERT INTO "user" (id, email, name, status, updated_at) VALUES
      ('${USER_1}', 'staff@example.test', 'Staff One', 'ACTIVE', now());
    INSERT INTO role (id, context, tenant_id, key, name, updated_at) VALUES
      ('${ROLE_A}', 'TENANT', '${T_A}', 'HOTEL_STAFF', 'Hotel Staff', now()),
      ('${ROLE_B}', 'TENANT', '${T_B}', 'HOTEL_STAFF', 'Hotel Staff', now());
    INSERT INTO tenant_membership (id, tenant_id, user_id, role_id, status, updated_at) VALUES
      ('${id(71)}', '${T_A}', '${USER_1}', '${ROLE_A}', 'ACTIVE', now());
  `);
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe('row-level security (XT-02)', () => {
  it('shows nothing without a tenant context (fail closed)', async () => {
    await inContext(app, {}, async () => {
      expect((await app.query('SELECT id FROM property')).rowCount).toBe(0);
      expect((await app.query('SELECT id FROM guest')).rowCount).toBe(0);
      expect((await app.query('SELECT id FROM tenant')).rowCount).toBe(0);
    });
  });

  it("shows only the current tenant's rows", async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      const properties = await app.query('SELECT id FROM property');
      expect(properties.rows.map((r) => r.id)).toEqual([P_A]);
      const guests = await app.query('SELECT id FROM guest');
      expect(guests.rows.map((r) => r.id)).toEqual([GUEST_A]);
      // Asking for another tenant's row by id finds nothing (IDOR protection).
      expect((await app.query('SELECT id FROM guest WHERE id = $1', [GUEST_B])).rowCount).toBe(0);
    });
  });

  it('cannot write rows into another tenant', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      const code = await pgErrorCode(
        app.query(
          `INSERT INTO guest (id, tenant_id, first_name, last_name, updated_at) VALUES ($1, $2, 'X', 'Y', now())`,
          [id(43), T_B],
        ),
      );
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("cannot update or delete another tenant's rows", async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      expect(
        (await app.query(`UPDATE guest SET last_name = 'Z' WHERE id = $1`, [GUEST_B])).rowCount,
      ).toBe(0);
      expect((await app.query('DELETE FROM guest WHERE id = $1', [GUEST_B])).rowCount).toBe(0);
    });
    const still = await owner.query('SELECT last_name FROM guest WHERE id = $1', [GUEST_B]);
    expect(still.rows[0]?.last_name).toBe('B');
  });

  it("lists a signed-in user's own tenants before a context is chosen", async () => {
    await inContext(app, { userId: USER_1 }, async () => {
      const tenants = await app.query('SELECT id FROM tenant ORDER BY id');
      expect(tenants.rows.map((r) => r.id)).toEqual([T_A]);
      const memberships = await app.query('SELECT tenant_id FROM tenant_membership');
      expect(memberships.rows.map((r) => r.tenant_id)).toEqual([T_A]);
    });
  });

  it('cannot create global (platform/agency) roles', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      const code = await pgErrorCode(
        app.query(
          `INSERT INTO role (id, context, tenant_id, key, name, updated_at) VALUES ($1, 'PLATFORM', NULL, 'EVIL', 'Evil', now())`,
          [id(63)],
        ),
      );
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it('protects every table that has a tenant_id column', async () => {
    const unprotected = await owner.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND NOT c.relrowsecurity
      ORDER BY 1`);
    // Deliberately without RLS (see the integrity_and_rls migration): the outbox is write-only for
    // sd_app, and sessions are read during authentication before any tenant context exists.
    // Adding a tenant table without a policy makes this test fail.
    expect(unprotected.rows.map((r) => r.relname)).toEqual(['outbox_event', 'session']);
  });
});

describe('referential integrity across tenants', () => {
  it("rejects a child row pointing at another tenant's parent, even as owner", async () => {
    const code = await pgErrorCode(
      owner.query(
        `INSERT INTO room_type (id, tenant_id, property_id, name, code, max_adults, max_children, max_occupancy, updated_at)
         VALUES ($1, $2, $3, 'Sneaky', 'SNK', 2, 0, 2, now())`,
        [id(23), T_A, P_B],
      ),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('platform role (XT-03, C11)', () => {
  it('can manage tenants across the platform', async () => {
    const tenants = await platform.query('SELECT id FROM tenant ORDER BY id');
    expect(tenants.rows.map((r) => r.id)).toEqual([T_A, T_B]);
  });

  it.each(['guest', 'booking', 'booking_room', 'booking_payment', 'inventory_day'])(
    'has no access to operational table %s',
    async (table) => {
      expect(await pgErrorCode(platform.query(`SELECT 1 FROM ${table} LIMIT 1`))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    },
  );
});

describe('append-only records (BR-22, C13)', () => {
  it('lets the app write audit entries but never change them', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      await app.query(
        `INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type, summary)
         VALUES ($1, $2, 'USER', 'guest.create', 'guest', 'Staff One created guest Asha A')`,
        [id(81), T_A],
      );
      await app.query('SAVEPOINT s');
      expect(await pgErrorCode(app.query(`UPDATE audit_log SET summary = 'edited'`))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      await app.query('ROLLBACK TO SAVEPOINT s');
      expect(await pgErrorCode(app.query('DELETE FROM audit_log'))).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it('lets the app append outbox events but not read them', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      await app.query(
        `INSERT INTO outbox_event (id, tenant_id, type, aggregate_type, aggregate_id, payload)
         VALUES ($1, $2, 'guest.created', 'guest', $3, '{}')`,
        [id(82), T_A, GUEST_A],
      );
      await app.query('SAVEPOINT s');
      expect(await pgErrorCode(app.query('SELECT * FROM outbox_event'))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

describe('inventory guarantees', () => {
  it('rejects overselling at the database level (capacity CHECK)', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      await app.query(
        `INSERT INTO inventory_day (tenant_id, property_id, room_type_id, date, total, booked)
         VALUES ($1, $2, $3, '2026-10-10', 1, 1)`,
        [T_A, P_A, RT_A],
      );
      await app.query('SAVEPOINT s');
      const oversell = await pgErrorCode(
        app.query(
          `UPDATE inventory_day SET booked = 2 WHERE room_type_id = $1 AND date = '2026-10-10'`,
          [RT_A],
        ),
      );
      expect(oversell).toBe(CHECK_VIOLATION);
      await app.query('ROLLBACK TO SAVEPOINT s');
      // An authorised override raises the allowance in the same statement (C8).
      await app.query(
        `UPDATE inventory_day SET booked = 2, overbook_allowance = 1 WHERE room_type_id = $1 AND date = '2026-10-10'`,
        [RT_A],
      );
    });
  });

  it('never allocates one physical room to overlapping stays (BR-11), but allows back-to-back (DT-01)', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      const block = (n: number, start: string, end: string) =>
        app.query(
          `INSERT INTO room_block (id, tenant_id, property_id, room_type_id, room_id, kind, reason, quantity,
             start_date, end_date, original_end_date, original_quantity, created_by_id, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'OUT_OF_SERVICE', 'MAINTENANCE', 1, $6, $7, $7, 1, $8, now())`,
          [id(n), T_A, P_A, RT_A, ROOM_A, start, end, USER_1],
        );
      const allocate = (n: number, blockN: number, start: string, end: string) =>
        app.query(
          `INSERT INTO room_allocation (id, tenant_id, property_id, room_id, start_date, end_date, room_block_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id(n), T_A, P_A, ROOM_A, start, end, id(blockN)],
        );

      await block(91, '2026-10-10', '2026-10-12');
      await block(92, '2026-10-12', '2026-10-14');
      await block(93, '2026-10-11', '2026-10-13');
      await allocate(101, 91, '2026-10-10', '2026-10-12');
      await allocate(102, 92, '2026-10-12', '2026-10-14'); // back-to-back: allowed
      await app.query('SAVEPOINT s');
      expect(await pgErrorCode(allocate(103, 93, '2026-10-11', '2026-10-13'))).toBe(
        EXCLUSION_VIOLATION,
      );
    });
  });

  it('rejects zero-night and reversed stays (DT-02)', async () => {
    await inContext(app, { tenantId: T_A }, async () => {
      const code = await pgErrorCode(
        app.query(
          `INSERT INTO booking (id, tenant_id, property_id, reference, status, source, guest_id, check_in, check_out,
             adults, children, currency, created_by_id, updated_at)
           VALUES ($1, $2, $3, 'SVA-26-000001', 'CONFIRMED', 'DIRECT', $4, '2026-10-10', '2026-10-10', 1, 0, 'INR', $5, now())`,
          [id(111), T_A, P_A, GUEST_A, USER_1],
        ),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });
  });
});

describe('migrations', () => {
  it('leave no drift between the database and the Prisma schema', () => {
    const diff = db.prisma([
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ]);
    expect(diff.status, diff.output).toBe(0);
  });
});
