import type { DbTransaction } from '@staydesk/db';
import type { LocalDate } from '@staydesk/domain';
import { ApiError } from '../common/api-error.js';
import { isoDateOf } from '../common/dates.js';

/**
 * The one way a room type's total inventory changes (docs/08 §8). Locks the room type row
 * FOR UPDATE — which also excludes concurrent inventory-ledger writers, who hold it FOR SHARE —
 * rejects totals that would leave any future night consuming more than it has (BR-09), and
 * keeps future inventory_day rows in step. Past rows keep their historical totals.
 */
export async function setRoomTypeTotal(
  tx: DbTransaction,
  input: { tenantId: string; roomTypeId: string; total: number; businessDate: LocalDate },
): Promise<{ previous: number }> {
  const { tenantId, roomTypeId, total, businessDate } = input;
  const locked = await tx.$queryRaw<Array<{ total_inventory: number }>>`
    SELECT total_inventory FROM room_type
    WHERE id = ${roomTypeId}::uuid AND tenant_id = ${tenantId}::uuid
    FOR UPDATE`;
  const current = locked[0];
  if (!current) throw new ApiError('NOT_FOUND', 'No such room type');
  if (current.total_inventory === total) return { previous: total };

  const conflicts = await tx.$queryRaw<Array<{ date: Date; consumed: number }>>`
    SELECT date, (booked + held + blocked + out_of_service)::int AS consumed
    FROM inventory_day
    WHERE room_type_id = ${roomTypeId}::uuid
      AND date >= ${businessDate.toString()}::date
      AND booked + held + blocked + out_of_service > ${total}
    ORDER BY date
    LIMIT 31`;
  if (conflicts.length > 0) {
    const nights = conflicts.map((c) => ({ date: isoDateOf(c.date), consumed: c.consumed }));
    throw new ApiError(
      'INVENTORY_CONFLICT',
      `Cannot reduce to ${total}: ${nights.length === 31 ? 'more than 30' : nights.length} upcoming night(s) already have more rooms booked, held or blocked, starting ${nights[0]!.date}`,
      { meta: { nights } },
    );
  }

  await tx.$executeRaw`
    UPDATE room_type SET total_inventory = ${total}, version = version + 1, updated_at = now()
    WHERE id = ${roomTypeId}::uuid`;
  await tx.$executeRaw`
    UPDATE inventory_day
    SET total = ${total}, updated_at = now(),
        overbook_allowance = GREATEST(0, booked + held + blocked + out_of_service - ${total})
    WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${businessDate.toString()}::date`;
  return { previous: current.total_inventory };
}

/** For room types that track physical rooms: total = number of ACTIVE rooms (C4). */
export async function syncTrackedTotal(
  tx: DbTransaction,
  input: { tenantId: string; roomTypeId: string; businessDate: LocalDate },
): Promise<void> {
  const active = await tx.room.count({ where: { roomTypeId: input.roomTypeId, status: 'ACTIVE' } });
  await setRoomTypeTotal(tx, { ...input, total: active });
}
