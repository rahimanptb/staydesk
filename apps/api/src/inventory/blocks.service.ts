import { Inject, Injectable } from '@nestjs/common';
import {
  BLOCK_REASON_LABELS,
  type BlockListQuery,
  type BlockReleaseResult,
  type BlockView,
  type CreateBlockRequest,
  type ReleaseBlockRequest,
  type UserRef,
} from '@staydesk/contracts';
import { sqlStateOf, uuidv7, type DbTransaction, type Prisma, type RoomBlock } from '@staydesk/db';
import { LocalDate, bucketOfBlock, planBlockRelease, type PermissionKey } from '@staydesk/domain';
import { writeAudit } from '../audit/audit.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { dateColumn, isoDateOf, localDateOf } from '../common/dates.js';
import { withIdempotency } from '../common/idempotency.js';
import { TenantDb } from '../database/database.module.js';
import { applyInventory } from './ledger.js';
import { describeRange, describeDay } from './labels.js';
import {
  assertInventoryDates,
  businessDateOf,
  requireProperty,
  userActor,
} from './property-access.js';

type BlockRow = RoomBlock & { roomType: { name: string }; room: { number: string } | null };

const withNames = { roomType: { select: { name: true } }, room: { select: { number: true } } };

async function userRefs(
  tx: DbTransaction,
  ids: Array<string | null>,
): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

function view(b: BlockRow, users: Map<string, UserRef>): BlockView {
  return {
    id: b.id,
    propertyId: b.propertyId,
    roomTypeId: b.roomTypeId,
    roomTypeName: b.roomType.name,
    roomId: b.roomId,
    roomNumber: b.room?.number ?? null,
    kind: b.kind,
    reason: b.reason,
    quantity: b.quantity,
    startDate: isoDateOf(b.startDate),
    endDate: isoDateOf(b.endDate),
    originalEndDate: isoDateOf(b.originalEndDate),
    originalQuantity: b.originalQuantity,
    status: b.status,
    notes: b.notes,
    overrideUsed: b.overrideUsed,
    splitFromId: b.splitFromId,
    createdBy: users.get(b.createdById) ?? null,
    createdAt: b.createdAt.toISOString(),
    releasedBy: b.releasedById ? (users.get(b.releasedById) ?? null) : null,
    releasedAt: b.releasedAt?.toISOString() ?? null,
    releaseReason: b.releaseReason,
  };
}

async function views(tx: DbTransaction, rows: BlockRow[]): Promise<BlockView[]> {
  const users = await userRefs(
    tx,
    rows.flatMap((r) => [r.createdById, r.releasedById]),
  );
  return rows.map((r) => view(r, users));
}

/** Who may touch which kind (docs/02): OOS has its own permission. */
function requireKindPermission(
  principal: Principal,
  kind: RoomBlock['kind'],
  action: 'create' | 'release',
): void {
  const needed: PermissionKey =
    kind === 'OUT_OF_SERVICE'
      ? 'room.outOfService'
      : action === 'create'
        ? 'block.create'
        : 'block.release';
  if (!principal.permissions.has(needed)) {
    throw new ApiError(
      'FORBIDDEN',
      kind === 'OUT_OF_SERVICE'
        ? 'You cannot manage out-of-service periods'
        : `You cannot ${action} blocks`,
    );
  }
}

const what = (b: { kind: RoomBlock['kind'] }) =>
  b.kind === 'BLOCK' ? 'block' : 'out-of-service period';

/**
 * Room blocks and out-of-service periods (docs/08 §7, BR-08). Count-level blocks take rooms of
 * a type; room-specific ones also hold the physical room through room_allocation, so it cannot
 * be assigned to guests on those dates.
 */
@Injectable()
export class BlocksService {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  private scope(p: Principal) {
    return { tenantId: p.tenantId!, userId: p.userId };
  }

  async list(
    principal: Principal,
    propertyId: string,
    query: BlockListQuery,
  ): Promise<BlockView[]> {
    return this.tenantDb.run(this.scope(principal), async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const today = dateColumn(businessDateOf(property));
      const where: Prisma.RoomBlockWhereInput = {
        propertyId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
        ...(query.status === 'active'
          ? { status: 'ACTIVE', endDate: { gt: today } }
          : query.status === 'released'
            ? { OR: [{ status: 'RELEASED' }, { endDate: { lte: today } }] }
            : {}),
      };
      const rows = await tx.roomBlock.findMany({
        where,
        include: withNames,
        orderBy:
          query.status === 'active'
            ? [{ startDate: 'asc' }, { id: 'asc' }]
            : [{ startDate: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      return views(tx, rows);
    });
  }

  async get(principal: Principal, propertyId: string, blockId: string): Promise<BlockView> {
    return this.tenantDb.run(this.scope(principal), async (tx) => {
      await requireProperty(tx, principal, propertyId);
      const row = await tx.roomBlock.findFirst({
        where: { id: blockId, propertyId },
        include: withNames,
      });
      if (!row) throw new ApiError('NOT_FOUND', 'No such block');
      return (await views(tx, [row]))[0]!;
    });
  }

  async create(
    principal: Principal,
    propertyId: string,
    idempotencyKey: string,
    input: CreateBlockRequest,
  ): Promise<{ block: BlockView; replayed: boolean }> {
    requireKindPermission(principal, input.kind, 'create');
    const tenantId = principal.tenantId!;
    const result = await this.tenantDb.runLocked(this.scope(principal), (tx) =>
      withIdempotency(
        tx,
        {
          tenantId,
          userId: principal.userId,
          key: idempotencyKey,
          route: `POST /properties/${propertyId}/blocks`,
          request: input,
        },
        async () => {
          const property = await requireProperty(tx, principal, propertyId);
          if (input.override) await this.assertOverrideAllowed(tx, principal);
          const start = LocalDate.parse(input.startDate);
          const end = LocalDate.parse(input.endDate);
          const businessDate = assertInventoryDates(property, start, end);

          const roomType = await tx.roomType.findFirst({
            where: { id: input.roomTypeId, propertyId, archivedAt: null },
          });
          if (!roomType) throw new ApiError('NOT_FOUND', 'No such room type');
          let roomNumber: string | null = null;
          if (input.roomId) {
            const room = await tx.room.findFirst({
              where: { id: input.roomId, propertyId, archivedAt: null },
            });
            if (!room || room.roomTypeId !== roomType.id) {
              throw new ApiError('VALIDATION_FAILED', 'Choose a room of this room type', {
                errors: [{ path: 'roomId', code: 'mismatch', message: 'Not a room of this type' }],
              });
            }
            if (room.status !== 'ACTIVE') {
              throw new ApiError(
                'VALIDATION_FAILED',
                `Room ${room.number} is inactive, so it is already out of inventory`,
                { errors: [{ path: 'roomId', code: 'inactive', message: 'Room is inactive' }] },
              );
            }
            roomNumber = room.number;
          }

          const effect = await applyInventory(
            tx,
            [
              {
                roomTypeId: roomType.id,
                from: start,
                to: end,
                bucket: bucketOfBlock(input.kind),
                quantity: input.quantity,
              },
            ],
            {
              tenantId,
              propertyId,
              businessDate,
              lowAvailabilityThreshold: property.lowAvailabilityThreshold,
              channel: 'STAFF',
              override: Boolean(input.override),
              shortfallCode: 'INVENTORY_CONFLICT',
            },
          );

          const id = uuidv7();
          await tx.roomBlock.create({
            data: {
              id,
              tenantId,
              propertyId,
              roomTypeId: roomType.id,
              roomId: input.roomId ?? null,
              kind: input.kind,
              reason: input.reason,
              quantity: input.quantity,
              startDate: dateColumn(start),
              endDate: dateColumn(end),
              originalEndDate: dateColumn(end),
              originalQuantity: input.quantity,
              notes: input.notes ?? null,
              overrideUsed: effect.overrideUsed,
              createdById: principal.userId,
            },
          });
          if (input.roomId)
            await this.allocateRoom(tx, {
              tenantId,
              propertyId,
              blockId: id,
              roomId: input.roomId,
              roomNumber: roomNumber!,
              start,
              end,
            });

          const subject = input.roomId
            ? `room ${roomNumber}`
            : `${input.quantity} ${roomType.name} room${input.quantity === 1 ? '' : 's'}`;
          await writeAudit(tx, {
            tenantId,
            propertyId,
            roomTypeId: roomType.id,
            actor: userActor(principal),
            action: input.kind === 'BLOCK' ? 'block.create' : 'out_of_service.create',
            entityType: 'room_block',
            entityId: id,
            summary: `${principal.name} ${input.kind === 'BLOCK' ? 'blocked' : 'took out of service'} ${subject} for ${describeRange(start, end)}: ${BLOCK_REASON_LABELS[input.reason]}${effect.overrideUsed ? ' (exceeding availability)' : ''}`,
            after: {
              kind: input.kind,
              roomTypeId: roomType.id,
              roomId: input.roomId ?? null,
              quantity: input.quantity,
              startDate: input.startDate,
              endDate: input.endDate,
              reason: input.reason,
              ...(effect.overrideUsed ? { overrideReason: input.override!.reason } : {}),
            },
          });
          const row = await tx.roomBlock.findUniqueOrThrow({ where: { id }, include: withNames });
          return (await views(tx, [row]))[0]!;
        },
      ),
    );
    return { block: result.body, replayed: result.replayed };
  }

  /** Releases a block fully, from a date, or by quantity (BL-02). */
  async release(
    principal: Principal,
    propertyId: string,
    blockId: string,
    input: ReleaseBlockRequest,
  ): Promise<BlockReleaseResult> {
    const tenantId = principal.tenantId!;
    return this.tenantDb.runLocked(this.scope(principal), async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      // 1. The aggregate row first (global lock order).
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_block WHERE id = ${blockId}::uuid AND property_id = ${propertyId}::uuid
        FOR UPDATE`;
      if (locked.length === 0) throw new ApiError('NOT_FOUND', 'No such block');
      const block = await tx.roomBlock.findUniqueOrThrow({
        where: { id: blockId },
        include: withNames,
      });
      requireKindPermission(principal, block.kind, 'release');
      if (block.status !== 'ACTIVE') {
        throw new ApiError('INVALID_STATUS_TRANSITION', `This ${what(block)} was already released`);
      }

      const businessDate = businessDateOf(property);
      const start = localDateOf(block.startDate);
      const end = localDateOf(block.endDate);
      const plan = planBlockRelease(
        {
          roomTypeId: block.roomTypeId,
          kind: block.kind,
          quantity: block.quantity,
          startDate: start,
          endDate: end,
        },
        {
          ...(input.fromDate ? { fromDate: LocalDate.parse(input.fromDate) } : {}),
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        },
        businessDate,
      );

      await applyInventory(tx, [plan.delta], {
        tenantId,
        propertyId,
        businessDate,
        lowAvailabilityThreshold: property.lowAvailabilityThreshold,
        channel: 'STAFF',
      });

      const now = new Date();
      await tx.roomBlock.update({
        where: { id: blockId },
        data: {
          endDate: dateColumn(plan.original.endDate),
          quantity: plan.original.quantity,
          ...(plan.original.released
            ? {
                status: 'RELEASED',
                releasedById: principal.userId,
                releasedAt: now,
                releaseReason: input.reason,
              }
            : {}),
        },
      });
      if (block.roomId) {
        await tx.roomAllocation.updateMany({
          where: { roomBlockId: blockId },
          data: { endDate: dateColumn(plan.original.endDate) },
        });
      }
      let remainderId: string | null = null;
      if (plan.remainder) {
        remainderId = uuidv7();
        await tx.roomBlock.create({
          data: {
            id: remainderId,
            tenantId,
            propertyId,
            roomTypeId: block.roomTypeId,
            roomId: null,
            kind: block.kind,
            reason: block.reason,
            quantity: plan.remainder.quantity,
            startDate: dateColumn(plan.remainder.startDate),
            endDate: dateColumn(plan.remainder.endDate),
            originalEndDate: dateColumn(plan.remainder.endDate),
            originalQuantity: plan.remainder.quantity,
            notes: block.notes,
            overrideUsed: block.overrideUsed,
            createdById: block.createdById,
            splitFromId: blockId,
          },
        });
      }

      const rooms = block.roomId
        ? `room ${block.room?.number ?? ''}`.trim()
        : `${plan.quantity === block.quantity ? (block.quantity === 1 ? 'the' : `all ${block.quantity}`) : `${plan.quantity} of ${block.quantity}`} ${block.roomType.name} room${block.quantity === 1 ? '' : 's'}`;
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: block.roomTypeId,
        actor: userActor(principal),
        action: block.kind === 'BLOCK' ? 'block.release' : 'out_of_service.release',
        entityType: 'room_block',
        entityId: blockId,
        summary: `${principal.name} released ${rooms} from ${describeDay(plan.from)} of the ${what(block)} for ${describeRange(start, end)}. Reason: ${input.reason}`,
        before: { quantity: block.quantity, endDate: isoDateOf(block.endDate) },
        after: {
          quantity: plan.original.quantity,
          endDate: plan.original.endDate.toString(),
          released: plan.quantity,
          from: plan.from.toString(),
          ...(remainderId ? { remainderId } : {}),
        },
      });

      const rows = await tx.roomBlock.findMany({
        where: { id: { in: remainderId ? [blockId, remainderId] : [blockId] } },
        include: withNames,
      });
      const [updated, remainder] = await views(tx, [
        rows.find((r) => r.id === blockId)!,
        ...rows.filter((r) => r.id === remainderId),
      ]);
      return { block: updated!, remainder: remainder ?? null };
    });
  }

  private async assertOverrideAllowed(tx: DbTransaction, principal: Principal): Promise<void> {
    if (!principal.permissions.has('inventory.override')) {
      throw new ApiError('FORBIDDEN', 'You cannot exceed availability');
    }
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: principal.tenantId! },
      select: { overbookingEnabled: true },
    });
    if (!tenant.overbookingEnabled) {
      throw new ApiError('FORBIDDEN', 'Overbooking is turned off for this account');
    }
  }

  /** Holds the physical room; the exclusion constraint rejects overlaps (BR-11). */
  private async allocateRoom(
    tx: DbTransaction,
    input: {
      tenantId: string;
      propertyId: string;
      blockId: string;
      roomId: string;
      roomNumber: string;
      start: LocalDate;
      end: LocalDate;
    },
  ): Promise<void> {
    try {
      await tx.roomAllocation.createMany({
        data: {
          id: uuidv7(),
          tenantId: input.tenantId,
          propertyId: input.propertyId,
          roomId: input.roomId,
          startDate: dateColumn(input.start),
          endDate: dateColumn(input.end),
          roomBlockId: input.blockId,
        },
      });
    } catch (error) {
      if (sqlStateOf(error) === '23P01') {
        throw new ApiError(
          'ROOM_UNAVAILABLE',
          `Room ${input.roomNumber} is already assigned or blocked on some of those dates`,
        );
      }
      throw error;
    }
  }
}
