import type { DbTransaction } from './client.js';
import { Prisma } from './generated/prisma/client.js';

/**
 * Shared SQL for the inventory projection (docs/08). Dates are ISO `YYYY-MM-DD` strings for
 * property-local calendar dates; ranges are half-open `[from, to)` like stays.
 *
 * Every writer follows the global lock order (docs/08 §5): aggregate row → room_type rows
 * (ordered by id) → inventory_day rows (ordered by room type, date) → room_allocation.
 */

export interface InventoryDayRow {
  room_type_id: string;
  date: Date;
  total: number;
  booked: number;
  held: number;
  blocked: number;
  out_of_service: number;
  overbook_allowance: number;
  closed_all: boolean;
  closed_agents: boolean;
}

export interface LockedRoomType {
  id: string;
  property_id: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  total_inventory: number;
}

/** Nights in [from, to) as a set-returning SQL fragment yielding `date` values. */
const nights = (from: string, to: string) =>
  Prisma.sql`generate_series(${from}::timestamp, ${to}::timestamp - interval '1 day', interval '1 day')`;

/** Whether an active stop-sell of `scope` covers room type `rt` on night `day` (SQL fragment). */
function closedBy(scope: 'ALL_CHANNELS' | 'AGENTS_ONLY', rt: string, day: string): Prisma.Sql {
  return Prisma.raw(`EXISTS (
    SELECT 1 FROM stop_sell s
    WHERE s.property_id = ${rt}.property_id
      AND (s.room_type_id IS NULL OR s.room_type_id = ${rt}.room_type_id)
      AND s.lifted_at IS NULL AND s.scope = '${scope}'
      AND ${day} >= s.start_date AND ${day} < s.end_date)`);
}

/**
 * Locks room types in id order. FOR SHARE excludes concurrent total changes (which take FOR
 * UPDATE) while letting other inventory writers proceed.
 */
export async function lockRoomTypes(
  tx: DbTransaction,
  roomTypeIds: readonly string[],
  mode: 'SHARE' | 'UPDATE' = 'SHARE',
): Promise<LockedRoomType[]> {
  if (roomTypeIds.length === 0) return [];
  const ids = [...new Set(roomTypeIds)].sort();
  return mode === 'UPDATE'
    ? tx.$queryRaw<LockedRoomType[]>`
        SELECT id, property_id, status::text AS status, total_inventory FROM room_type
        WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`
    : tx.$queryRaw<LockedRoomType[]>`
        SELECT id, property_id, status::text AS status, total_inventory FROM room_type
        WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
}

/**
 * Creates any missing inventory rows for [from, to): the current total, no consumption, and
 * closure flags from active stop-sells. Existing rows are untouched. Locks the room types FOR
 * SHARE first, so a row is never created with a total that a concurrent change is replacing.
 * Returns the number of rows created.
 */
export async function ensureInventoryDays(
  tx: DbTransaction,
  input: { roomTypeIds: readonly string[]; from: string; to: string },
): Promise<number> {
  if (input.roomTypeIds.length === 0 || input.from >= input.to) return 0;
  const locked = await lockRoomTypes(tx, input.roomTypeIds);
  const ids = locked.map((r) => r.id);
  if (ids.length === 0) return 0;
  return tx.$executeRaw`
    INSERT INTO inventory_day
      (tenant_id, property_id, room_type_id, date, total, closed_all, closed_agents, updated_at)
    SELECT rt.tenant_id, rt.property_id, rt.room_type_id, d.date, rt.total_inventory,
           ${closedBy('ALL_CHANNELS', 'rt', 'd.date')}, ${closedBy('AGENTS_ONLY', 'rt', 'd.date')},
           now()
    FROM (SELECT tenant_id, property_id, id AS room_type_id, total_inventory
          FROM room_type WHERE id = ANY(${ids}::uuid[])) rt
    CROSS JOIN LATERAL (SELECT g::date AS date FROM ${nights(input.from, input.to)} g) d
    ON CONFLICT (room_type_id, date) DO NOTHING`;
}

/** Locks inventory rows FOR UPDATE in (room type, date) order and returns them. */
export async function lockInventoryDays(
  tx: DbTransaction,
  input: { roomTypeIds: readonly string[]; from: string; to: string },
): Promise<InventoryDayRow[]> {
  if (input.roomTypeIds.length === 0 || input.from >= input.to) return [];
  const ids = [...new Set(input.roomTypeIds)].sort();
  return tx.$queryRaw<InventoryDayRow[]>`
    SELECT room_type_id, date, total, booked, held, blocked, out_of_service, overbook_allowance,
           closed_all, closed_agents
    FROM inventory_day
    WHERE room_type_id = ANY(${ids}::uuid[]) AND date >= ${input.from}::date AND date < ${input.to}::date
    ORDER BY room_type_id, date
    FOR UPDATE`;
}

/**
 * Recomputes the closure flags of existing rows from the active stop-sells. The caller has
 * locked the rows. Returns the number of rows whose flags changed.
 */
export async function refreshClosures(
  tx: DbTransaction,
  input: { roomTypeIds: readonly string[]; from: string; to: string },
): Promise<number> {
  if (input.roomTypeIds.length === 0 || input.from >= input.to) return 0;
  const ids = [...new Set(input.roomTypeIds)].sort();
  return tx.$executeRaw`
    UPDATE inventory_day AS i
    SET closed_all = c.closed_all, closed_agents = c.closed_agents, updated_at = now()
    FROM (
      SELECT x.room_type_id, x.date,
             ${closedBy('ALL_CHANNELS', 'x', 'x.date')} AS closed_all,
             ${closedBy('AGENTS_ONLY', 'x', 'x.date')} AS closed_agents
      FROM inventory_day x
      WHERE x.room_type_id = ANY(${ids}::uuid[])
        AND x.date >= ${input.from}::date AND x.date < ${input.to}::date
    ) c
    WHERE i.room_type_id = c.room_type_id AND i.date = c.date
      AND (i.closed_all <> c.closed_all OR i.closed_agents <> c.closed_agents)`;
}

/**
 * Serialises stop-sell changes with room type creation for one property, so a new room type's
 * rows can never miss a property-wide stop-sell being created at the same moment. Taken first,
 * before any row lock.
 */
export async function lockPropertyClosures(tx: DbTransaction, propertyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`closures:${propertyId}`}, 0))`;
}

/**
 * Pre-creates inventory rows for every non-archived room type of a property over [from, to)
 * (docs/08 §14). Idempotent; the nightly job calls it to roll the horizon forward.
 */
export async function extendInventoryHorizon(
  tx: DbTransaction,
  input: { propertyId: string; from: string; to: string },
): Promise<number> {
  const types = await tx.roomType.findMany({
    where: { propertyId: input.propertyId, archivedAt: null },
    select: { id: true },
  });
  return ensureInventoryDays(tx, {
    roomTypeIds: types.map((t) => t.id),
    from: input.from,
    to: input.to,
  });
}
