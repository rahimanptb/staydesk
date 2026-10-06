import { Inject, Injectable } from '@nestjs/common';
import type { CreateRoomsRequest, RoomView, UpdateRoomRequest } from '@staydesk/contracts';
import type { DbTransaction, Room } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { dateColumn } from '../common/dates.js';
import { TenantDb } from '../database/database.module.js';
import { EntitlementsService } from './entitlements.service.js';
import { syncTrackedTotal } from './inventory-total.js';
import { businessDateOf, requireProperty, userActor } from './property-access.js';

const view = (r: Room): RoomView => ({
  id: r.id,
  propertyId: r.propertyId,
  roomTypeId: r.roomTypeId,
  number: r.number,
  floor: r.floor,
  building: r.building,
  status: r.status,
  housekeeping: r.housekeeping,
  notes: r.notes,
});

/** Physical rooms of room types that track them (C4). Totals follow the active room count. */
@Injectable()
export class RoomsService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  private run<T>(p: Principal, fn: (tx: DbTransaction) => Promise<T>) {
    return this.tenantDb.run({ tenantId: p.tenantId!, userId: p.userId }, fn);
  }

  async list(principal: Principal, propertyId: string, roomTypeId?: string): Promise<RoomView[]> {
    const rows = await this.run(principal, async (tx) => {
      await requireProperty(tx, principal, propertyId);
      return tx.room.findMany({
        where: { propertyId, archivedAt: null, ...(roomTypeId ? { roomTypeId } : {}) },
      });
    });
    return rows
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
      .map(view);
  }

  private async trackedType(tx: DbTransaction, propertyId: string, roomTypeId: string) {
    const roomType = await tx.roomType.findFirst({
      where: { id: roomTypeId, propertyId, archivedAt: null },
    });
    if (!roomType) {
      throw new ApiError('VALIDATION_FAILED', 'Choose a room type of this property', {
        errors: [{ path: 'roomTypeId', code: 'invalid', message: 'Unknown room type' }],
      });
    }
    if (!roomType.trackRooms) {
      throw new ApiError('VALIDATION_FAILED', `${roomType.name} does not track individual rooms`, {
        errors: [
          {
            path: 'roomTypeId',
            code: 'not_tracked',
            message: 'Turn on "track individual rooms" first',
          },
        ],
      });
    }
    return roomType;
  }

  async create(
    principal: Principal,
    propertyId: string,
    input: CreateRoomsRequest,
  ): Promise<RoomView[]> {
    const tenantId = principal.tenantId!;
    const numbers = input.rooms.map((r) => r.number);
    const created = await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const roomType = await this.trackedType(tx, propertyId, input.roomTypeId);
      // Numbers are unique per property, including archived rooms (they keep history).
      const existing = await tx.room.findMany({
        where: { propertyId, number: { in: numbers, mode: 'insensitive' } },
        select: { number: true },
      });
      if (existing.length > 0) {
        throw new ApiError(
          'ALREADY_EXISTS',
          `Room numbers already in use: ${existing.map((r) => r.number).join(', ')}`,
          {
            meta: { numbers: existing.map((r) => r.number) },
          },
        );
      }
      const rooms = await this.entitlements.roomCount(tx, tenantId);
      await this.entitlements.assertWithin(
        tx,
        tenantId,
        'limit.rooms',
        rooms,
        rooms + numbers.length,
        'rooms',
      );

      await tx.room.createMany({
        data: input.rooms.map((r) => ({
          tenantId,
          propertyId,
          roomTypeId: roomType.id,
          number: r.number,
          floor: r.floor ?? null,
          building: r.building ?? null,
        })),
      });
      await syncTrackedTotal(tx, {
        tenantId,
        roomTypeId: roomType.id,
        businessDate: businessDateOf(property),
      });
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: roomType.id,
        actor: userActor(principal),
        action: 'room.create',
        entityType: 'room_type',
        entityId: roomType.id,
        summary: `${principal.name} added ${numbers.length} ${roomType.name} room(s): ${numbers.slice(0, 20).join(', ')}${numbers.length > 20 ? '…' : ''}`,
        after: { numbers },
      });
      return tx.room.findMany({ where: { propertyId, number: { in: numbers } } });
    });
    return created.map(view);
  }

  async update(
    principal: Principal,
    propertyId: string,
    roomId: string,
    input: UpdateRoomRequest,
  ): Promise<RoomView> {
    const tenantId = principal.tenantId!;
    const room = await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const before = await tx.room.findFirst({
        where: { id: roomId, propertyId, archivedAt: null },
      });
      if (!before) throw new ApiError('NOT_FOUND', 'No such room');
      if (input.number && input.number.toLowerCase() !== before.number.toLowerCase()) {
        const taken = await tx.room.count({
          where: {
            propertyId,
            number: { equals: input.number, mode: 'insensitive' },
            id: { not: roomId },
          },
        });
        if (taken > 0) throw new ApiError('ALREADY_EXISTS', `Room ${input.number} already exists`);
      }
      if (input.roomTypeId && input.roomTypeId !== before.roomTypeId) {
        await this.trackedType(tx, propertyId, input.roomTypeId);
      }
      const after = await tx.room.update({ where: { id: roomId }, data: input });

      const businessDate = businessDateOf(property);
      // Recount affected types in id order (consistent lock order, docs/08 §5).
      const affected = [...new Set([before.roomTypeId, after.roomTypeId])].sort();
      if (before.status !== after.status || before.roomTypeId !== after.roomTypeId) {
        for (const roomTypeId of affected)
          await syncTrackedTotal(tx, { tenantId, roomTypeId, businessDate });
      }
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: after.roomTypeId,
        actor: userActor(principal),
        action: 'room.update',
        entityType: 'room',
        entityId: roomId,
        summary: `${principal.name} ${
          before.roomTypeId !== after.roomTypeId
            ? `moved room ${after.number} to a different room type`
            : before.status !== after.status
              ? `${after.status === 'ACTIVE' ? 'activated' : 'deactivated'} room ${after.number}`
              : before.number !== after.number
                ? `renumbered room ${before.number} to ${after.number}`
                : `updated room ${after.number}`
        }`,
        before: {
          number: before.number,
          floor: before.floor,
          status: before.status,
          roomTypeId: before.roomTypeId,
        },
        after: {
          number: after.number,
          floor: after.floor,
          status: after.status,
          roomTypeId: after.roomTypeId,
        },
      });
      return after;
    });
    return view(room);
  }

  /** Archive keeps history (C12); refused while the room is allocated to an upcoming stay. */
  async archive(principal: Principal, propertyId: string, roomId: string): Promise<void> {
    const tenantId = principal.tenantId!;
    await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const room = await tx.room.findFirst({ where: { id: roomId, propertyId, archivedAt: null } });
      if (!room) throw new ApiError('NOT_FOUND', 'No such room');
      const businessDate = businessDateOf(property);
      const upcoming = await tx.roomAllocation.count({
        where: { roomId, endDate: { gt: dateColumn(businessDate) } },
      });
      if (upcoming > 0) {
        throw new ApiError(
          'INVENTORY_CONFLICT',
          `Room ${room.number} is assigned to upcoming stays or blocks`,
        );
      }
      await tx.room.update({
        where: { id: roomId },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await syncTrackedTotal(tx, { tenantId, roomTypeId: room.roomTypeId, businessDate });
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: room.roomTypeId,
        actor: userActor(principal),
        action: 'room.archive',
        entityType: 'room',
        entityId: roomId,
        summary: `${principal.name} archived room ${room.number}`,
      });
    });
  }
}
