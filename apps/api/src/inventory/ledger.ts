import { Logger } from '@nestjs/common';
import {
  ensureInventoryDays,
  lockInventoryDays,
  lockRoomTypes,
  sqlStateOf,
  type DbTransaction,
  type InventoryDayRow,
} from '@staydesk/db';
import {
  LocalDate,
  planInventoryChange,
  type InventoryDayState,
  type InventoryDelta,
  type NightChange,
  type SalesChannel,
} from '@staydesk/domain';
import { writeOutbox } from '../audit/outbox.js';
import { ApiError } from '../common/api-error.js';
import { localDateOf } from '../common/dates.js';

/**
 * InventoryLedger — the single writer of `inventory_day` (docs/08 §5). Bookings, holds, blocks,
 * out-of-service periods and their releases all call `applyInventory` inside their own
 * transaction, after locking their aggregate row and before touching room allocations.
 */

export interface LedgerContext {
  tenantId: string;
  propertyId: string;
  businessDate: LocalDate;
  lowAvailabilityThreshold: number;
  channel: SalesChannel;
  /** Exceed availability: the caller checked inventory.override + tenant overbooking. */
  override?: boolean;
  /** Sell into a stop-sell: the caller checked inventory.override. */
  ignoreStopSell?: boolean;
  /** How a shortfall is reported: bookings → NO_AVAILABILITY, blocks → INVENTORY_CONFLICT. */
  shortfallCode?: 'NO_AVAILABILITY' | 'INVENTORY_CONFLICT';
}

export interface InventoryEffect {
  changes: NightChange[];
  overrideUsed: boolean;
}

const logger = new Logger('InventoryLedger');

function stateOf(row: InventoryDayRow): InventoryDayState {
  return {
    roomTypeId: row.room_type_id,
    date: localDateOf(row.date),
    total: row.total,
    booked: row.booked,
    held: row.held,
    blocked: row.blocked,
    outOfService: row.out_of_service,
    overbookAllowance: row.overbook_allowance,
    closedAll: row.closed_all,
    closedAgents: row.closed_agents,
  };
}

/** Applies inventory deltas atomically, or throws without writing anything. */
export async function applyInventory(
  tx: DbTransaction,
  deltas: readonly InventoryDelta[],
  ctx: LedgerContext,
): Promise<InventoryEffect> {
  const effective = deltas.filter((d) => d.quantity !== 0 && d.from.isBefore(d.to));
  if (effective.length === 0) return { changes: [], overrideUsed: false };

  const roomTypeIds = [...new Set(effective.map((d) => d.roomTypeId))].sort();
  const from = effective.map((d) => d.from).reduce((a, b) => LocalDate.min(a, b));
  const to = effective.map((d) => d.to).reduce((a, b) => LocalDate.max(a, b));
  const range = { roomTypeIds, from: from.toString(), to: to.toString() };

  // 2. Room types FOR SHARE, in id order: blocks concurrent total changes.
  const types = await lockRoomTypes(tx, roomTypeIds);
  for (const id of roomTypeIds) {
    const type = types.find((t) => t.id === id);
    const consumes = effective.some((d) => d.roomTypeId === id && d.quantity > 0);
    const sells = effective.some(
      (d) =>
        d.roomTypeId === id && d.quantity > 0 && (d.bucket === 'BOOKED' || d.bucket === 'HELD'),
    );
    if (!type || type.property_id !== ctx.propertyId || (consumes && type.status === 'ARCHIVED')) {
      throw new ApiError('NOT_FOUND', 'No such room type');
    }
    if (sells && type.status !== 'ACTIVE') {
      throw new ApiError('VALIDATION_FAILED', 'This room type is not open for sale');
    }
  }

  // 3–4. Make sure every night has a row, then lock the rows in (room type, date) order.
  await ensureInventoryDays(tx, range);
  const rows = (await lockInventoryDays(tx, range)).map(stateOf);

  // 5–6. Pure planning; nothing is written unless every night passes.
  const plan = planInventoryChange(rows, effective, {
    channel: ctx.channel,
    override: ctx.override ?? false,
    ignoreStopSell: ctx.ignoreStopSell ?? false,
    lowAvailabilityThreshold: ctx.lowAvailabilityThreshold,
  });
  if (!plan.ok) {
    if (plan.closedNights.length > 0) {
      throw new ApiError(
        'CLOSED_FOR_SALE',
        `Closed for sale on ${plan.closedNights.length} night(s), starting ${plan.closedNights[0]!.date}`,
        { meta: { closedNights: plan.closedNights, shortfall: plan.shortfalls } },
      );
    }
    const first = plan.shortfalls[0]!;
    throw new ApiError(
      ctx.shortfallCode ?? 'NO_AVAILABILITY',
      `Only ${first.available} room${first.available === 1 ? '' : 's'} available on ${first.date} (requested ${first.requested})${
        plan.shortfalls.length > 1 ? ` and ${plan.shortfalls.length - 1} more night(s) short` : ''
      }`,
      { meta: { shortfall: plan.shortfalls } },
    );
  }

  // 7. Write absolute values: safe because the rows are locked.
  const changed = plan.changes;
  try {
    await tx.$executeRaw`
      UPDATE inventory_day AS i
      SET booked = v.booked, held = v.held, blocked = v.blocked, out_of_service = v.oos,
          overbook_allowance = v.allowance, updated_at = now()
      FROM unnest(
        ${changed.map((c) => c.roomTypeId)}::uuid[],
        ${changed.map((c) => c.date.toString())}::date[],
        ${changed.map((c) => c.after.booked)}::int[],
        ${changed.map((c) => c.after.held)}::int[],
        ${changed.map((c) => c.after.blocked)}::int[],
        ${changed.map((c) => c.after.outOfService)}::int[],
        ${changed.map((c) => c.after.overbookAllowance)}::int[]
      ) AS v(room_type_id, date, booked, held, blocked, oos, allowance)
      WHERE i.room_type_id = v.room_type_id AND i.date = v.date`;
  } catch (error) {
    // 8. The CHECK backstop fired: the planner and the database disagree — a bug, never a race.
    if (sqlStateOf(error) === '23514') {
      logger.error(
        `CRITICAL: the inventory capacity check rejected a planned change ${JSON.stringify({
          propertyId: ctx.propertyId,
          ...range,
        })}`,
      );
      throw new ApiError(ctx.shortfallCode ?? 'NO_AVAILABILITY', 'Not enough rooms available');
    }
    throw error;
  }

  // 9. Events for channel sync, dashboards and alerts (the worker delivers them after commit).
  for (const roomTypeId of roomTypeIds) {
    const nights = changed.filter((c) => c.roomTypeId === roomTypeId);
    if (nights.length === 0) continue;
    const payload = {
      propertyId: ctx.propertyId,
      roomTypeId,
      from: nights[0]!.date.toString(),
      to: nights[nights.length - 1]!.date.plusDays(1).toString(),
    };
    await writeOutbox(tx, {
      tenantId: ctx.tenantId,
      type: 'inventory.changed',
      aggregateType: 'room_type',
      aggregateId: roomTypeId,
      payload,
    });
    const low = nights.filter((c) => c.crossedLowThreshold).map((c) => c.date.toString());
    const full = nights.filter((c) => c.becameFull).map((c) => c.date.toString());
    if (low.length > 0) {
      await writeOutbox(tx, {
        tenantId: ctx.tenantId,
        type: 'availability.low',
        aggregateType: 'room_type',
        aggregateId: roomTypeId,
        payload: { ...payload, dates: low },
      });
    }
    if (full.length > 0) {
      await writeOutbox(tx, {
        tenantId: ctx.tenantId,
        type: 'availability.full',
        aggregateType: 'room_type',
        aggregateId: roomTypeId,
        payload: { ...payload, dates: full },
      });
    }
  }

  return { changes: changed, overrideUsed: changed.some((c) => c.overrideUsed) };
}
