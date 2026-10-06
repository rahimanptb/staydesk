import type { DbTransaction } from './client.js';
import { Prisma } from './generated/prisma/client.js';
import { lockRoomTypes, refreshClosures } from './inventory.js';

/**
 * Reconciliation: the proof that the inventory projection matches its sources (docs/08 §12).
 * The oracle recomputes every counter from booking lines and blocks; the projection must equal
 * it on every night, past and future. Any mismatch is an incident.
 */

export type MismatchKind = 'COUNTERS' | 'TOTAL' | 'CLOSURE';

export interface InventoryMismatch {
  kind: MismatchKind;
  roomTypeId: string;
  date: string;
  expected: Record<string, number | boolean>;
  actual: Record<string, number | boolean>;
}

export interface ReconciliationResult {
  mismatchCount: number;
  /** The first `limit` mismatches, ordered by kind, room type and date. */
  mismatches: InventoryMismatch[];
}

/** Expected counters per (room type, night) from the sources of truth. */
const expectedCounters = (propertyId: string) => Prisma.sql`
  SELECT room_type_id, date,
         SUM(booked)::int AS booked, SUM(held)::int AS held,
         SUM(blocked)::int AS blocked, SUM(oos)::int AS oos
  FROM (
    SELECT br.room_type_id, d::date AS date,
           (br.inventory_bucket = 'BOOKED')::int AS booked,
           (br.inventory_bucket = 'HELD')::int AS held,
           0 AS blocked, 0 AS oos
    FROM booking_room br
    CROSS JOIN LATERAL generate_series(
      br.inv_from::timestamp, br.inv_to::timestamp - interval '1 day', interval '1 day') d
    WHERE br.property_id = ${propertyId}::uuid AND br.inventory_bucket <> 'NONE'
    UNION ALL
    SELECT b.room_type_id, d::date,
           0, 0,
           CASE WHEN b.kind = 'BLOCK' THEN b.quantity ELSE 0 END,
           CASE WHEN b.kind = 'OUT_OF_SERVICE' THEN b.quantity ELSE 0 END
    FROM room_block b
    CROSS JOIN LATERAL generate_series(
      b.start_date::timestamp, b.end_date::timestamp - interval '1 day', interval '1 day') d
    WHERE b.property_id = ${propertyId}::uuid
  ) x
  GROUP BY 1, 2`;

const closedBy = (scope: 'ALL_CHANNELS' | 'AGENTS_ONLY') =>
  Prisma.raw(`EXISTS (
    SELECT 1 FROM stop_sell s
    WHERE s.property_id = i.property_id
      AND (s.room_type_id IS NULL OR s.room_type_id = i.room_type_id)
      AND s.lifted_at IS NULL AND s.scope = '${scope}'
      AND i.date >= s.start_date AND i.date < s.end_date)`);

interface MismatchRow {
  kind: MismatchKind;
  room_type_id: string;
  date: Date;
  expected: Record<string, number | boolean>;
  actual: Record<string, number | boolean>;
  mismatch_count: bigint;
}

/** Compares the projection with the oracle. Reads only; safe to run at any time. */
export async function reconcileProperty(
  tx: DbTransaction,
  propertyId: string,
  options: { limit?: number } = {},
): Promise<ReconciliationResult> {
  const limit = options.limit ?? 100;
  const rows = await tx.$queryRaw<MismatchRow[]>`
    WITH expected AS (${expectedCounters(propertyId)}),
    actual AS (
      SELECT room_type_id, date, booked, held, blocked, out_of_service
      FROM inventory_day WHERE property_id = ${propertyId}::uuid
    ),
    mismatches AS (
      SELECT 'COUNTERS' AS kind,
             COALESCE(a.room_type_id, e.room_type_id) AS room_type_id,
             COALESCE(a.date, e.date) AS date,
             jsonb_build_object('booked', COALESCE(e.booked, 0), 'held', COALESCE(e.held, 0),
               'blocked', COALESCE(e.blocked, 0), 'outOfService', COALESCE(e.oos, 0)) AS expected,
             jsonb_build_object('booked', COALESCE(a.booked, 0), 'held', COALESCE(a.held, 0),
               'blocked', COALESCE(a.blocked, 0), 'outOfService', COALESCE(a.out_of_service, 0)) AS actual
      FROM actual a
      FULL OUTER JOIN expected e ON e.room_type_id = a.room_type_id AND e.date = a.date
      WHERE COALESCE(a.booked, 0) <> COALESCE(e.booked, 0)
         OR COALESCE(a.held, 0) <> COALESCE(e.held, 0)
         OR COALESCE(a.blocked, 0) <> COALESCE(e.blocked, 0)
         OR COALESCE(a.out_of_service, 0) <> COALESCE(e.oos, 0)
      UNION ALL
      -- Future nights carry the room type's current total; past nights keep their history.
      SELECT 'TOTAL', i.room_type_id, i.date,
             jsonb_build_object('total', rt.total_inventory), jsonb_build_object('total', i.total)
      FROM inventory_day i
      JOIN room_type rt ON rt.id = i.room_type_id
      JOIN property p ON p.id = i.property_id
      WHERE i.property_id = ${propertyId}::uuid
        AND i.date >= business_date(p.timezone) AND i.total <> rt.total_inventory
      UNION ALL
      SELECT 'CLOSURE', c.room_type_id, c.date,
             jsonb_build_object('closedAll', c.want_all, 'closedAgents', c.want_agents),
             jsonb_build_object('closedAll', c.closed_all, 'closedAgents', c.closed_agents)
      FROM (
        SELECT i.room_type_id, i.date, i.closed_all, i.closed_agents,
               ${closedBy('ALL_CHANNELS')} AS want_all, ${closedBy('AGENTS_ONLY')} AS want_agents
        FROM inventory_day i WHERE i.property_id = ${propertyId}::uuid
      ) c
      WHERE c.closed_all <> c.want_all OR c.closed_agents <> c.want_agents
    )
    SELECT kind, room_type_id, date, expected, actual, count(*) OVER () AS mismatch_count
    FROM mismatches
    ORDER BY kind, room_type_id, date
    LIMIT ${limit}`;
  return {
    mismatchCount: rows.length === 0 ? 0 : Number(rows[0]!.mismatch_count),
    mismatches: rows.map((r) => ({
      kind: r.kind,
      roomTypeId: r.room_type_id,
      date: r.date.toISOString().slice(0, 10),
      expected: r.expected,
      actual: r.actual,
    })),
  };
}

/**
 * Rewrites the projection from the oracle under the normal lock order. Only ever run through an
 * explicit, audited admin command after a mismatch has been investigated — never automatically.
 * Returns the number of rows changed.
 */
export async function repairPropertyInventory(
  tx: DbTransaction,
  propertyId: string,
): Promise<number> {
  const types = await tx.roomType.findMany({ where: { propertyId }, select: { id: true } });
  const ids = types.map((t) => t.id);
  if (ids.length === 0) return 0;
  await lockRoomTypes(tx, ids);
  await tx.$queryRaw`
    SELECT 1 FROM inventory_day WHERE property_id = ${propertyId}::uuid
    ORDER BY room_type_id, date FOR UPDATE`;

  // Nights consumed by a source but missing from the projection.
  let changed = await tx.$executeRaw`
    INSERT INTO inventory_day (tenant_id, property_id, room_type_id, date, total, updated_at)
    SELECT rt.tenant_id, rt.property_id, rt.id, e.date, rt.total_inventory, now()
    FROM (${expectedCounters(propertyId)}) e
    JOIN room_type rt ON rt.id = e.room_type_id
    ON CONFLICT (room_type_id, date) DO NOTHING`;

  changed += await tx.$executeRaw`
    WITH expected AS (${expectedCounters(propertyId)})
    UPDATE inventory_day AS i
    SET booked = v.booked, held = v.held, blocked = v.blocked, out_of_service = v.oos,
        total = v.total,
        overbook_allowance = GREATEST(0, v.booked + v.held + v.blocked + v.oos - v.total),
        updated_at = now()
    FROM (
      SELECT i2.room_type_id, i2.date,
             COALESCE(e.booked, 0) AS booked, COALESCE(e.held, 0) AS held,
             COALESCE(e.blocked, 0) AS blocked, COALESCE(e.oos, 0) AS oos,
             CASE WHEN i2.date >= business_date(p.timezone) THEN rt.total_inventory ELSE i2.total END AS total
      FROM inventory_day i2
      JOIN room_type rt ON rt.id = i2.room_type_id
      JOIN property p ON p.id = i2.property_id
      LEFT JOIN expected e ON e.room_type_id = i2.room_type_id AND e.date = i2.date
      WHERE i2.property_id = ${propertyId}::uuid
    ) v
    WHERE i.room_type_id = v.room_type_id AND i.date = v.date
      AND (i.booked, i.held, i.blocked, i.out_of_service, i.total)
          IS DISTINCT FROM (v.booked, v.held, v.blocked, v.oos, v.total)`;

  const range = await tx.$queryRaw<Array<{ from: Date | null; to: Date | null }>>`
    SELECT min(date) AS "from", max(date) + 1 AS "to" FROM inventory_day
    WHERE property_id = ${propertyId}::uuid`;
  const { from, to } = range[0] ?? { from: null, to: null };
  if (from && to) {
    changed += await refreshClosures(tx, {
      roomTypeIds: ids,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
  }
  return changed;
}
