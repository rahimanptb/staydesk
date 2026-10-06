import { InvariantViolationError } from '../errors.js';
import type { LocalDate } from '../dates/local-date.js';
import { eachNight } from '../dates/stay.js';

/**
 * Pure core of the availability engine (docs/08-availability-engine.md).
 *
 * The database layer locks the affected `inventory_day` rows, passes them here with the
 * requested deltas, and writes back the counters this module returns. Keeping the arithmetic
 * pure makes every rule unit-testable; the database CHECK constraint remains the backstop.
 */

export type InventoryBucket = 'BOOKED' | 'HELD' | 'BLOCKED' | 'OUT_OF_SERVICE';

export interface InventoryCounters {
  total: number;
  booked: number;
  held: number;
  blocked: number;
  outOfService: number;
  /** Authorised overbooking currently in effect; 0 unless an override was used (C8). */
  overbookAllowance: number;
}

export interface InventoryDayState extends InventoryCounters {
  roomTypeId: string;
  date: LocalDate;
  closedAll: boolean;
  closedAgents: boolean;
}

export interface InventoryDelta {
  roomTypeId: string;
  /** First night affected. */
  from: LocalDate;
  /** Exclusive end, like a stay's check-out. */
  to: LocalDate;
  bucket: InventoryBucket;
  /** Positive consumes inventory, negative releases it. */
  quantity: number;
}

export type SalesChannel = 'STAFF' | 'AGENT' | 'SYSTEM';

export interface PlanOptions {
  channel: SalesChannel;
  /** Caller verified `inventory.override` and tenant overbooking is enabled. */
  override: boolean;
  /** Caller verified `inventory.override` for selling into a stop-sell. */
  ignoreStopSell: boolean;
  lowAvailabilityThreshold: number;
}

export interface Shortfall {
  roomTypeId: string;
  date: string;
  requested: number;
  available: number;
}

export interface ClosedNight {
  roomTypeId: string;
  date: string;
}

export interface NightChange {
  roomTypeId: string;
  date: LocalDate;
  before: InventoryCounters;
  after: InventoryCounters;
  overrideUsed: boolean;
  /** Availability dropped to or below the low threshold but is still positive. */
  crossedLowThreshold: boolean;
  /** Availability dropped to zero or below. */
  becameFull: boolean;
}

export type InventoryPlan =
  | { ok: true; changes: NightChange[] }
  | { ok: false; shortfalls: Shortfall[]; closedNights: ClosedNight[] };

export function consumed(c: InventoryCounters): number {
  return c.booked + c.held + c.blocked + c.outOfService;
}

/** total − booked − held − blocked − OOS. Negative only when overbooked by override (BR-07). */
export function available(c: InventoryCounters): number {
  return c.total - consumed(c);
}

const BUCKET_FIELD = {
  BOOKED: 'booked',
  HELD: 'held',
  BLOCKED: 'blocked',
  OUT_OF_SERVICE: 'outOfService',
} as const satisfies Record<InventoryBucket, keyof InventoryCounters>;

const keyOf = (roomTypeId: string, date: LocalDate) => `${roomTypeId}|${date.epochDay}`;

function countersOf(s: InventoryCounters): InventoryCounters {
  return {
    total: s.total,
    booked: s.booked,
    held: s.held,
    blocked: s.blocked,
    outOfService: s.outOfService,
    overbookAllowance: s.overbookAllowance,
  };
}

/**
 * Applies deltas to the current (locked) inventory rows.
 *
 * Rules:
 * - Deltas are netted per night first, so a modification that releases and re-consumes the
 *   same night needs no availability on that night (BR-16).
 * - A night whose consumption increases must keep `consumed ≤ total` unless `override`, in
 *   which case the allowance grows to cover it.
 * - When consumption decreases, the allowance shrinks so released rooms never become
 *   sellable while the night is still overbooked.
 * - Sales (booked + held) increases on a stop-sold night fail unless `ignoreStopSell`.
 * - Every affected night must be present in `current`; releasing more than is consumed is a
 *   programming error.
 */
export function planInventoryChange(
  current: readonly InventoryDayState[],
  deltas: readonly InventoryDelta[],
  options: PlanOptions,
): InventoryPlan {
  const rows = new Map<string, InventoryDayState>();
  for (const row of current) rows.set(keyOf(row.roomTypeId, row.date), row);

  // 1. Net the deltas per night and bucket.
  const net = new Map<string, { row: InventoryDayState; delta: Record<InventoryBucket, number> }>();
  for (const d of deltas) {
    if (!Number.isInteger(d.quantity)) {
      throw new InvariantViolationError(`Delta quantity must be an integer, got ${d.quantity}`);
    }
    if (d.to.isBefore(d.from)) {
      throw new InvariantViolationError(`Delta range ${d.from}..${d.to} is reversed`);
    }
    for (const night of eachNight(d.from, d.to)) {
      const key = keyOf(d.roomTypeId, night);
      const row = rows.get(key);
      if (!row) {
        throw new InvariantViolationError(
          `Inventory row ${d.roomTypeId} ${night} was not locked before planning`,
        );
      }
      let entry = net.get(key);
      if (!entry) {
        entry = { row, delta: { BOOKED: 0, HELD: 0, BLOCKED: 0, OUT_OF_SERVICE: 0 } };
        net.set(key, entry);
      }
      entry.delta[d.bucket] += d.quantity;
    }
  }

  // 2. Evaluate each night.
  const changes: NightChange[] = [];
  const shortfalls: Shortfall[] = [];
  const closedNights: ClosedNight[] = [];

  for (const { row, delta } of net.values()) {
    const before = countersOf(row);
    const after = countersOf(row);
    for (const bucket of Object.keys(BUCKET_FIELD) as InventoryBucket[]) {
      after[BUCKET_FIELD[bucket]] += delta[bucket];
    }
    for (const bucket of Object.keys(BUCKET_FIELD) as InventoryBucket[]) {
      if (after[BUCKET_FIELD[bucket]] < 0) {
        throw new InvariantViolationError(
          `Releasing more ${bucket} than consumed on ${row.roomTypeId} ${row.date}`,
        );
      }
    }

    const consumedBefore = consumed(before);
    const consumedAfter = consumed(after);
    const increase = consumedAfter - consumedBefore;
    const salesIncrease = delta.BOOKED + delta.HELD;
    let overrideUsed = false;

    if (salesIncrease > 0 && increase >= 0 && !options.ignoreStopSell) {
      const closed = row.closedAll || (options.channel === 'AGENT' && row.closedAgents);
      if (closed) closedNights.push({ roomTypeId: row.roomTypeId, date: row.date.toString() });
    }

    if (increase > 0) {
      if (consumedAfter > after.total) {
        if (options.override) {
          after.overbookAllowance = Math.max(before.overbookAllowance, consumedAfter - after.total);
          overrideUsed = true;
        } else {
          shortfalls.push({
            roomTypeId: row.roomTypeId,
            date: row.date.toString(),
            requested: increase,
            available: Math.max(0, available(before)),
          });
        }
      }
    } else if (increase < 0) {
      after.overbookAllowance = Math.min(
        before.overbookAllowance,
        Math.max(0, consumedAfter - after.total),
      );
    }

    const availableBefore = available(before);
    const availableAfter = available(after);
    const threshold = options.lowAvailabilityThreshold;
    changes.push({
      roomTypeId: row.roomTypeId,
      date: row.date,
      before,
      after,
      overrideUsed,
      crossedLowThreshold:
        availableBefore > threshold && availableAfter <= threshold && availableAfter > 0,
      becameFull: availableBefore > 0 && availableAfter <= 0,
    });
  }

  const byNight = (
    a: { roomTypeId: string; date: string },
    b: { roomTypeId: string; date: string },
  ) => a.roomTypeId.localeCompare(b.roomTypeId) || a.date.localeCompare(b.date);

  if (shortfalls.length > 0 || closedNights.length > 0) {
    return {
      ok: false,
      shortfalls: shortfalls.sort(byNight),
      closedNights: closedNights.sort(byNight),
    };
  }

  changes.sort((a, b) => a.roomTypeId.localeCompare(b.roomTypeId) || a.date.compareTo(b.date));
  return { ok: true, changes };
}

export interface TotalChangeConflict {
  date: string;
  consumed: number;
}

/**
 * Nights (from the business date on) that could not absorb a new total inventory (BR-09).
 * Callers pass only rows dated on or after the business date.
 */
export function totalChangeConflicts(
  futureRows: readonly InventoryDayState[],
  newTotal: number,
): TotalChangeConflict[] {
  if (!Number.isInteger(newTotal) || newTotal < 0) {
    throw new InvariantViolationError(
      `Total inventory must be a non-negative integer, got ${newTotal}`,
    );
  }
  return futureRows
    .filter((r) => consumed(r) > newTotal)
    .sort((a, b) => a.date.compareTo(b.date))
    .map((r) => ({ date: r.date.toString(), consumed: consumed(r) }));
}
