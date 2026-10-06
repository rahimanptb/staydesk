import { Inject, Injectable } from '@nestjs/common';
import type { CreateStopSellRequest, StopSellView, UserRef } from '@staydesk/contracts';
import {
  ensureInventoryDays,
  lockInventoryDays,
  lockPropertyClosures,
  refreshClosures,
  uuidv7,
  type DbTransaction,
  type StopSell,
} from '@staydesk/db';
import { LocalDate } from '@staydesk/domain';
import { writeAudit } from '../audit/audit.js';
import { writeOutbox } from '../audit/outbox.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { dateColumn, isoDateOf } from '../common/dates.js';
import { TenantDb } from '../database/database.module.js';
import { describeRange } from './labels.js';
import {
  assertInventoryDates,
  businessDateOf,
  requireProperty,
  userActor,
} from './property-access.js';

type StopSellRow = StopSell & { roomType: { name: string } | null };

const SCOPE_LABEL = { ALL_CHANNELS: 'all sales', AGENTS_ONLY: 'travel-agent sales' } as const;

/**
 * Stop-sell (docs/08 §3): closes nights for sale without touching counts. The flags live on the
 * inventory rows (closed_all / closed_agents) and are always recomputed from the active
 * stop-sells, so overlapping stop-sells and lifts stay exact. Blocks are not sales and ignore it.
 */
@Injectable()
export class StopSellsService {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  private scope(p: Principal) {
    return { tenantId: p.tenantId!, userId: p.userId };
  }

  private async views(tx: DbTransaction, rows: StopSellRow[]): Promise<StopSellView[]> {
    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.createdById, r.liftedById]).filter((x): x is string => x !== null),
      ),
    ];
    const users = new Map<string, UserRef>(
      ids.length === 0
        ? []
        : (
            await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
          ).map((u) => [u.id, u]),
    );
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      roomTypeId: r.roomTypeId,
      roomTypeName: r.roomType?.name ?? null,
      startDate: isoDateOf(r.startDate),
      endDate: isoDateOf(r.endDate),
      scope: r.scope,
      reason: r.reason,
      createdBy: users.get(r.createdById) ?? null,
      createdAt: r.createdAt.toISOString(),
      liftedBy: r.liftedById ? (users.get(r.liftedById) ?? null) : null,
      liftedAt: r.liftedAt?.toISOString() ?? null,
    }));
  }

  /** The room types a stop-sell covers: one, or every non-archived type of the property. */
  private async coveredTypes(tx: DbTransaction, propertyId: string, roomTypeId: string | null) {
    const types = await tx.roomType.findMany({
      where: { propertyId, archivedAt: null, ...(roomTypeId ? { id: roomTypeId } : {}) },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    if (roomTypeId && types.length === 0) throw new ApiError('NOT_FOUND', 'No such room type');
    return types;
  }

  async list(
    principal: Principal,
    propertyId: string,
    status: 'active' | 'all',
  ): Promise<StopSellView[]> {
    return this.tenantDb.run(this.scope(principal), async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const rows = await tx.stopSell.findMany({
        where: {
          propertyId,
          ...(status === 'active'
            ? { liftedAt: null, endDate: { gt: dateColumn(businessDateOf(property)) } }
            : {}),
        },
        include: { roomType: { select: { name: true } } },
        orderBy: status === 'active' ? [{ startDate: 'asc' }] : [{ startDate: 'desc' }],
        take: 500,
      });
      return this.views(tx, rows);
    });
  }

  async create(
    principal: Principal,
    propertyId: string,
    input: CreateStopSellRequest,
  ): Promise<StopSellView> {
    const tenantId = principal.tenantId!;
    return this.tenantDb.runLocked(this.scope(principal), async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const start = LocalDate.parse(input.startDate);
      const end = LocalDate.parse(input.endDate);
      assertInventoryDates(property, start, end);
      await lockPropertyClosures(tx, propertyId);

      const types = await this.coveredTypes(tx, propertyId, input.roomTypeId);
      const range = {
        roomTypeIds: types.map((t) => t.id),
        from: input.startDate,
        to: input.endDate,
      };
      // Rows exist and are locked before the stop-sell becomes visible, so no concurrent writer
      // can create a row for these nights with stale flags.
      await ensureInventoryDays(tx, range);
      await lockInventoryDays(tx, range);

      const id = uuidv7();
      await tx.stopSell.create({
        data: {
          id,
          tenantId,
          propertyId,
          roomTypeId: input.roomTypeId,
          startDate: dateColumn(start),
          endDate: dateColumn(end),
          scope: input.scope,
          reason: input.reason ?? null,
          createdById: principal.userId,
        },
      });
      await refreshClosures(tx, range);

      const target = input.roomTypeId ? types[0]!.name : 'every room type';
      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: input.roomTypeId,
        actor: userActor(principal),
        action: 'stop_sell.create',
        entityType: 'stop_sell',
        entityId: id,
        summary: `${principal.name} stopped ${SCOPE_LABEL[input.scope]} of ${target} for ${describeRange(start, end)}${input.reason ? `: ${input.reason}` : ''}`,
        after: {
          roomTypeId: input.roomTypeId,
          startDate: input.startDate,
          endDate: input.endDate,
          scope: input.scope,
          reason: input.reason ?? null,
        },
      });
      await this.announce(tx, tenantId, propertyId, id, range);
      const row = await tx.stopSell.findUniqueOrThrow({
        where: { id },
        include: { roomType: { select: { name: true } } },
      });
      return (await this.views(tx, [row]))[0]!;
    });
  }

  async lift(principal: Principal, propertyId: string, stopSellId: string): Promise<StopSellView> {
    const tenantId = principal.tenantId!;
    return this.tenantDb.runLocked(this.scope(principal), async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      await lockPropertyClosures(tx, propertyId);
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM stop_sell WHERE id = ${stopSellId}::uuid AND property_id = ${propertyId}::uuid
        FOR UPDATE`;
      if (locked.length === 0) throw new ApiError('NOT_FOUND', 'No such stop-sell');
      const stopSell = await tx.stopSell.findUniqueOrThrow({
        where: { id: stopSellId },
        include: { roomType: { select: { name: true } } },
      });
      if (stopSell.liftedAt) {
        throw new ApiError('INVALID_STATUS_TRANSITION', 'This stop-sell was already lifted');
      }
      if (stopSell.endDate <= dateColumn(businessDateOf(property))) {
        throw new ApiError('INVALID_STATUS_TRANSITION', 'This stop-sell has already ended');
      }

      const types = await this.coveredTypes(tx, propertyId, stopSell.roomTypeId);
      const range = {
        roomTypeIds: types.map((t) => t.id),
        from: isoDateOf(stopSell.startDate),
        to: isoDateOf(stopSell.endDate),
      };
      await lockInventoryDays(tx, range);
      await tx.stopSell.update({
        where: { id: stopSellId },
        data: { liftedAt: new Date(), liftedById: principal.userId },
      });
      await refreshClosures(tx, range);

      await writeAudit(tx, {
        tenantId,
        propertyId,
        roomTypeId: stopSell.roomTypeId,
        actor: userActor(principal),
        action: 'stop_sell.lift',
        entityType: 'stop_sell',
        entityId: stopSellId,
        summary: `${principal.name} lifted the stop on ${SCOPE_LABEL[stopSell.scope]} of ${stopSell.roomType?.name ?? 'every room type'} for ${describeRange(LocalDate.parse(range.from), LocalDate.parse(range.to))}`,
      });
      await this.announce(tx, tenantId, propertyId, stopSellId, range);
      const row = await tx.stopSell.findUniqueOrThrow({
        where: { id: stopSellId },
        include: { roomType: { select: { name: true } } },
      });
      return (await this.views(tx, [row]))[0]!;
    });
  }

  private async announce(
    tx: DbTransaction,
    tenantId: string,
    propertyId: string,
    stopSellId: string,
    range: { roomTypeIds: string[]; from: string; to: string },
  ): Promise<void> {
    await writeOutbox(tx, {
      tenantId,
      type: 'inventory.changed',
      aggregateType: 'stop_sell',
      aggregateId: stopSellId,
      payload: { propertyId, roomTypeIds: range.roomTypeIds, from: range.from, to: range.to },
    });
  }
}
