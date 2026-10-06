import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateRoomTypeRequest,
  RoomTypeView,
  UpdateRoomTypeRequest,
} from '@staydesk/contracts';
import type { DbTransaction, Prisma, RoomType } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import { writeOutbox } from '../audit/outbox.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { dateColumn } from '../common/dates.js';
import { TenantDb } from '../database/database.module.js';
import { EntitlementsService } from './entitlements.service.js';
import { setRoomTypeTotal, syncTrackedTotal } from './inventory-total.js';
import { businessDateOf, requireProperty, userActor } from './property-access.js';

type RoomTypeRow = RoomType & { _count?: { rooms: number } };

/** Field-level visibility: rates need booking.viewFinancials, notes booking.viewInternalNotes. */
export function roomTypeView(r: RoomTypeRow, principal: Principal): RoomTypeView {
  return {
    id: r.id,
    propertyId: r.propertyId,
    name: r.name,
    code: r.code,
    description: r.description,
    maxAdults: r.maxAdults,
    maxChildren: r.maxChildren,
    maxOccupancy: r.maxOccupancy,
    trackRooms: r.trackRooms,
    totalInventory: r.totalInventory,
    ...(principal.permissions.has('booking.viewFinancials')
      ? { baseRateMinor: r.baseRateMinor === null ? null : Number(r.baseRateMinor) }
      : {}),
    status: r.status,
    sortOrder: r.sortOrder,
    ...(principal.permissions.has('booking.viewInternalNotes')
      ? { internalNotes: r.internalNotes }
      : {}),
    version: r.version,
    roomCount: r._count?.rooms ?? 0,
  };
}

const activeRooms = { _count: { select: { rooms: { where: { status: 'ACTIVE' as const } } } } };

/** Parses `If-Match: "v3"` (docs/06 §1). */
export function versionFrom(ifMatch: string | undefined): number {
  if (!ifMatch)
    throw new ApiError(
      'PRECONDITION_REQUIRED',
      'Send the If-Match header with the version you edited',
    );
  const match = /^(?:W\/)?"v(\d+)"$/.exec(ifMatch.trim());
  if (!match) throw new ApiError('PRECONDITION_FAILED', 'Malformed If-Match header');
  return Number(match[1]);
}

@Injectable()
export class RoomTypesService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  private run<T>(p: Principal, fn: (tx: DbTransaction) => Promise<T>) {
    return this.tenantDb.run({ tenantId: p.tenantId!, userId: p.userId }, fn);
  }

  async list(
    principal: Principal,
    propertyId: string,
    includeArchived = false,
  ): Promise<RoomTypeView[]> {
    const rows = await this.run(principal, async (tx) => {
      await requireProperty(tx, principal, propertyId);
      return tx.roomType.findMany({
        where: { propertyId, ...(includeArchived ? {} : { archivedAt: null }) },
        include: activeRooms,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    });
    return rows.map((r) => roomTypeView(r, principal));
  }

  async get(principal: Principal, propertyId: string, roomTypeId: string): Promise<RoomTypeView> {
    const row = await this.run(principal, async (tx) => {
      await requireProperty(tx, principal, propertyId);
      return tx.roomType.findFirst({ where: { id: roomTypeId, propertyId }, include: activeRooms });
    });
    if (!row) throw new ApiError('NOT_FOUND', 'No such room type');
    return roomTypeView(row, principal);
  }

  private async assertCodeFree(
    tx: DbTransaction,
    propertyId: string,
    code: string,
    excludeId?: string,
  ) {
    const taken = await tx.roomType.count({
      where: { propertyId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (taken > 0) {
      throw new ApiError('ALREADY_EXISTS', 'Another room type in this property uses this code', {
        errors: [{ path: 'code', code: 'taken', message: 'This code is taken' }],
      });
    }
  }

  private assertFinancialsAllowed(principal: Principal, input: { baseRateMinor?: number | null }) {
    if (
      input.baseRateMinor !== undefined &&
      input.baseRateMinor !== null &&
      !principal.permissions.has('booking.viewFinancials')
    ) {
      throw new ApiError('FORBIDDEN', 'You cannot set rates');
    }
  }

  async create(
    principal: Principal,
    propertyId: string,
    input: CreateRoomTypeRequest,
  ): Promise<RoomTypeView> {
    this.assertFinancialsAllowed(principal, input);
    const tenantId = principal.tenantId!;
    const id = await this.run(principal, async (tx) => {
      await requireProperty(tx, principal, propertyId);
      await this.assertCodeFree(tx, propertyId, input.code);
      // Tracked room types start at 0 and grow as rooms are added.
      const total = input.trackRooms ? 0 : input.totalInventory;
      const rooms = await this.entitlements.roomCount(tx, tenantId);
      await this.entitlements.assertWithin(
        tx,
        tenantId,
        'limit.rooms',
        rooms,
        rooms + total,
        'rooms',
      );
      const created = await tx.roomType.create({
        data: {
          ...input,
          totalInventory: total,
          baseRateMinor: input.baseRateMinor === null ? null : BigInt(input.baseRateMinor),
          tenantId,
          propertyId,
        },
      });
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: created.id,
        actor: userActor(principal),
        action: 'room_type.create',
        entityType: 'room_type',
        entityId: created.id,
        summary: `${principal.name} added the room type ${created.name} (${created.trackRooms ? 'individual rooms' : `${total} rooms`})`,
        after: {
          name: created.name,
          code: created.code,
          trackRooms: created.trackRooms,
          totalInventory: total,
        },
      });
      return created.id;
    });
    return this.get(principal, propertyId, id);
  }

  async update(
    principal: Principal,
    propertyId: string,
    roomTypeId: string,
    expectedVersion: number,
    input: UpdateRoomTypeRequest,
  ): Promise<RoomTypeView> {
    this.assertFinancialsAllowed(principal, input);
    const tenantId = principal.tenantId!;
    await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const before = await tx.roomType.findFirst({
        where: { id: roomTypeId, propertyId, archivedAt: null },
      });
      if (!before) throw new ApiError('NOT_FOUND', 'No such room type');
      if (before.version !== expectedVersion) {
        throw new ApiError(
          'PRECONDITION_FAILED',
          'This room type was changed by someone else; reload and try again',
          {
            meta: { currentVersion: before.version },
          },
        );
      }
      if (input.code && input.code !== before.code)
        await this.assertCodeFree(tx, propertyId, input.code, roomTypeId);

      const merged = {
        maxAdults: input.maxAdults ?? before.maxAdults,
        maxChildren: input.maxChildren ?? before.maxChildren,
        maxOccupancy: input.maxOccupancy ?? before.maxOccupancy,
      };
      if (merged.maxOccupancy > merged.maxAdults + merged.maxChildren) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'Maximum guests cannot exceed maximum adults plus children',
          {
            errors: [
              {
                path: 'maxOccupancy',
                code: 'too_big',
                message: 'Too many guests for the adult/child limits',
              },
            ],
          },
        );
      }

      const { totalInventory, baseRateMinor, ...fields } = input;
      const data: Prisma.RoomTypeUncheckedUpdateInput = { ...fields, version: { increment: 1 } };
      if (baseRateMinor !== undefined)
        data.baseRateMinor = baseRateMinor === null ? null : BigInt(baseRateMinor);
      // Optimistic concurrency: only the editor holding the current version wins.
      const updated = await tx.roomType.updateMany({
        where: { id: roomTypeId, version: expectedVersion },
        data,
      });
      if (updated.count !== 1)
        throw new ApiError('PRECONDITION_FAILED', 'This room type was changed by someone else');

      const trackRooms = input.trackRooms ?? before.trackRooms;
      const businessDate = businessDateOf(property);
      if (trackRooms && !before.trackRooms) {
        await syncTrackedTotal(tx, { tenantId, roomTypeId, businessDate });
      } else if (
        !trackRooms &&
        totalInventory !== undefined &&
        totalInventory !== before.totalInventory
      ) {
        const rooms = await this.entitlements.roomCount(tx, tenantId, roomTypeId);
        await this.entitlements.assertWithin(
          tx,
          tenantId,
          'limit.rooms',
          rooms + before.totalInventory,
          rooms + totalInventory,
          'rooms',
        );
        await setRoomTypeTotal(tx, { tenantId, roomTypeId, total: totalInventory, businessDate });
      } else if (
        trackRooms &&
        totalInventory !== undefined &&
        totalInventory !== before.totalInventory
      ) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'This room type tracks individual rooms; add or remove rooms instead',
          {
            errors: [
              {
                path: 'totalInventory',
                code: 'derived',
                message: 'Set by the number of active rooms',
              },
            ],
          },
        );
      }

      const after = await tx.roomType.findUniqueOrThrow({ where: { id: roomTypeId } });
      const auditKeys = [
        'name',
        'code',
        'description',
        'maxAdults',
        'maxChildren',
        'maxOccupancy',
        'trackRooms',
        'totalInventory',
        'status',
        'sortOrder',
      ] as const;
      const changed = auditKeys.filter((k) => before[k] !== after[k]);
      if (changed.length > 0 || baseRateMinor !== undefined) {
        await writeAudit(tx, {
          tenantId,
          propertyId,
          roomTypeId,
          actor: userActor(principal),
          action: 'room_type.update',
          entityType: 'room_type',
          entityId: roomTypeId,
          summary: `${principal.name} updated the room type ${after.name}${changed.includes('totalInventory') ? ` (inventory ${before.totalInventory} → ${after.totalInventory})` : ''}`,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        });
      }
      if (changed.includes('totalInventory')) {
        await writeOutbox(tx, {
          tenantId,
          type: 'inventory.changed',
          aggregateType: 'room_type',
          aggregateId: roomTypeId,
          payload: { propertyId, from: businessDate.toString(), reason: 'total_changed' },
        });
      }
    });
    return this.get(principal, propertyId, roomTypeId);
  }

  /** BR-10: only without upcoming bookings or blocks. Its rooms are archived with it. */
  async archive(principal: Principal, propertyId: string, roomTypeId: string): Promise<void> {
    const tenantId = principal.tenantId!;
    await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const roomType = await tx.roomType.findFirst({
        where: { id: roomTypeId, propertyId, archivedAt: null },
      });
      if (!roomType) throw new ApiError('NOT_FOUND', 'No such room type');
      const businessDate = businessDateOf(property);
      const today = dateColumn(businessDate);
      const [bookings, blocks] = await Promise.all([
        tx.bookingRoom.count({
          where: { roomTypeId, inventoryBucket: { not: 'NONE' }, invTo: { gt: today } },
        }),
        tx.roomBlock.count({ where: { roomTypeId, status: 'ACTIVE', endDate: { gt: today } } }),
      ]);
      if (bookings + blocks > 0) {
        throw new ApiError(
          'INVENTORY_CONFLICT',
          'This room type has upcoming bookings or blocks; it cannot be archived',
          {
            meta: { bookings, blocks },
          },
        );
      }
      const now = new Date();
      await tx.room.updateMany({
        where: { roomTypeId, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED', archivedAt: now },
      });
      await setRoomTypeTotal(tx, { tenantId, roomTypeId, total: 0, businessDate });
      await tx.roomType.update({
        where: { id: roomTypeId },
        data: { status: 'ARCHIVED', archivedAt: now },
      });
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId,
        actor: userActor(principal),
        action: 'room_type.archive',
        entityType: 'room_type',
        entityId: roomTypeId,
        summary: `${principal.name} archived the room type ${roomType.name}`,
      });
    });
  }
}
