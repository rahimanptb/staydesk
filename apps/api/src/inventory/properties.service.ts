import { Inject, Injectable } from '@nestjs/common';
import type {
  CreatePropertyRequest,
  HolidayView,
  PropertyView,
  UpdatePropertyRequest,
} from '@staydesk/contracts';
import type { DbTransaction, Property } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { dateColumn, isoDateOf } from '../common/dates.js';
import { TenantDb } from '../database/database.module.js';
import { EntitlementsService } from './entitlements.service.js';
import { businessDateOf, requireProperty, userActor } from './property-access.js';

export function propertyView(p: Property): PropertyView {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    type: p.type,
    status: p.status,
    timezone: p.timezone,
    currency: p.currency,
    country: p.country,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    phone: p.phone,
    email: p.email,
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    childMaxAge: p.childMaxAge,
    tentativeHoldHours: p.tentativeHoldHours,
    lowAvailabilityThreshold: p.lowAvailabilityThreshold,
    bookingHorizonDays: p.bookingHorizonDays,
    maxStayNights: p.maxStayNights,
    bookingRefPrefix: p.bookingRefPrefix,
    agentDefaultVisibility: p.agentDefaultVisibility,
    agentCountCap: p.agentCountCap,
    agentRequestExpiryHours: p.agentRequestExpiryHours,
    isDiscoverable: p.isDiscoverable,
    businessDate: businessDateOf(p).toString(),
    createdAt: p.createdAt.toISOString(),
  };
}

const field = (path: string, message: string) => [{ path, code: 'invalid', message }];

@Injectable()
export class PropertiesService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  private run<T>(p: Principal, fn: (tx: DbTransaction) => Promise<T>) {
    return this.tenantDb.run({ tenantId: p.tenantId!, userId: p.userId }, fn);
  }

  async list(principal: Principal): Promise<PropertyView[]> {
    const rows = await this.run(principal, (tx) =>
      tx.property.findMany({
        where: {
          tenantId: principal.tenantId!,
          archivedAt: null,
          ...(principal.allProperties ? {} : { id: { in: [...principal.propertyIds] } }),
        },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map(propertyView);
  }

  async get(principal: Principal, propertyId: string): Promise<PropertyView> {
    return propertyView(
      await this.run(principal, (tx) => requireProperty(tx, principal, propertyId)),
    );
  }

  private async assertUnique(
    tx: DbTransaction,
    tenantId: string,
    values: { code?: string; bookingRefPrefix?: string },
    excludeId?: string,
  ) {
    const others = { tenantId, ...(excludeId ? { id: { not: excludeId } } : {}) };
    if (values.code && (await tx.property.count({ where: { ...others, code: values.code } }))) {
      throw new ApiError('ALREADY_EXISTS', 'Another property already uses this code', {
        errors: field('code', 'This code is taken'),
      });
    }
    if (
      values.bookingRefPrefix &&
      (await tx.property.count({ where: { ...others, bookingRefPrefix: values.bookingRefPrefix } }))
    ) {
      throw new ApiError('ALREADY_EXISTS', 'Another property already uses this booking prefix', {
        errors: field('bookingRefPrefix', 'This prefix is taken'),
      });
    }
  }

  async create(principal: Principal, input: CreatePropertyRequest): Promise<PropertyView> {
    const tenantId = principal.tenantId!;
    const bookingRefPrefix = input.bookingRefPrefix ?? input.code;
    const property = await this.run(principal, async (tx) => {
      const count = await tx.property.count({ where: { tenantId, archivedAt: null } });
      await this.entitlements.assertWithin(
        tx,
        tenantId,
        'limit.properties',
        count,
        count + 1,
        'properties',
      );
      await this.assertUnique(tx, tenantId, { code: input.code, bookingRefPrefix });
      const created = await tx.property.create({
        data: { ...input, bookingRefPrefix, tenantId, status: 'DRAFT' },
      });
      await tx.bookingSequence.create({ data: { propertyId: created.id, tenantId } });
      await writeAudit(tx, {
        tenantId,
        propertyId: created.id,
        actor: userActor(principal),
        action: 'property.create',
        entityType: 'property',
        entityId: created.id,
        summary: `${principal.name} added the property ${created.name}`,
        after: {
          name: created.name,
          code: created.code,
          timezone: created.timezone,
          currency: created.currency,
        },
      });
      return created;
    });
    return propertyView(property);
  }

  async update(
    principal: Principal,
    propertyId: string,
    input: UpdatePropertyRequest,
  ): Promise<PropertyView> {
    const tenantId = principal.tenantId!;
    const property = await this.run(principal, async (tx) => {
      const before = await requireProperty(tx, principal, propertyId);
      await this.assertUnique(
        tx,
        tenantId,
        { bookingRefPrefix: input.bookingRefPrefix },
        propertyId,
      );

      const frozen = (['currency', 'timezone', 'bookingRefPrefix'] as const).filter(
        (k) => input[k] !== undefined && input[k] !== before[k],
      );
      if (frozen.length > 0 && (await tx.booking.count({ where: { propertyId } })) > 0) {
        // BR-32 (currency), BR-27 (timezone shifts business dates), BR-19 (issued references).
        throw new ApiError(
          'VALIDATION_FAILED',
          'Currency, time zone and booking prefix cannot change once the property has bookings',
          {
            errors: frozen.map((k) => ({
              path: k,
              code: 'frozen',
              message: 'Fixed after the first booking',
            })),
          },
        );
      }

      const after = await tx.property.update({ where: { id: propertyId }, data: input });
      const changed = Object.keys(input).filter(
        (k) =>
          JSON.stringify(before[k as keyof Property]) !==
          JSON.stringify(after[k as keyof Property]),
      );
      if (changed.length > 0) {
        await writeAudit(tx, {
          tenantId,
          propertyId,
          actor: userActor(principal),
          action: 'property.update',
          entityType: 'property',
          entityId: propertyId,
          summary: `${principal.name} updated ${after.name}: ${changed.join(', ')}`,
          before: Object.fromEntries(changed.map((k) => [k, before[k as keyof Property]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k as keyof Property]])),
        });
      }
      return after;
    });
    return propertyView(property);
  }

  /** Archive (C12): only when nothing upcoming still depends on the property. */
  async archive(principal: Principal, propertyId: string): Promise<void> {
    await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const today = dateColumn(businessDateOf(property));
      const upcoming = await tx.bookingRoom.count({
        where: { propertyId, inventoryBucket: { not: 'NONE' }, invTo: { gt: today } },
      });
      if (upcoming > 0) {
        throw new ApiError(
          'INVENTORY_CONFLICT',
          'This property has upcoming bookings; it cannot be archived',
        );
      }
      await tx.property.update({
        where: { id: propertyId },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: principal.tenantId,
        propertyId,
        actor: userActor(principal),
        action: 'property.archive',
        entityType: 'property',
        entityId: propertyId,
        summary: `${principal.name} archived the property ${property.name}`,
      });
    });
  }

  // ───────────────────────────── Holidays ─────────────────────────────

  async holidays(principal: Principal, propertyId: string, year?: number): Promise<HolidayView[]> {
    const rows = await this.run(principal, async (tx) => {
      await requireProperty(tx, principal, propertyId);
      return tx.holiday.findMany({
        where: {
          tenantId: principal.tenantId!,
          OR: [{ propertyId }, { propertyId: null }],
          ...(year
            ? { date: { gte: dateColumn(`${year}-01-01`), lte: dateColumn(`${year}-12-31`) } }
            : {}),
        },
        orderBy: { date: 'asc' },
      });
    });
    return rows.map((h) => ({
      id: h.id,
      date: isoDateOf(h.date),
      name: h.name,
      propertyId: h.propertyId,
    }));
  }

  async addHoliday(
    principal: Principal,
    propertyId: string,
    input: { date: string; name: string },
  ): Promise<HolidayView> {
    const holiday = await this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const created = await tx.holiday.create({
        data: {
          tenantId: principal.tenantId!,
          propertyId,
          date: dateColumn(input.date),
          name: input.name,
        },
      });
      await writeAudit(tx, {
        tenantId: principal.tenantId,
        propertyId,
        actor: userActor(principal),
        action: 'holiday.create',
        entityType: 'holiday',
        entityId: created.id,
        summary: `${principal.name} added the holiday ${input.name} on ${input.date} at ${property.name}`,
      });
      return created;
    });
    return {
      id: holiday.id,
      date: isoDateOf(holiday.date),
      name: holiday.name,
      propertyId: holiday.propertyId,
    };
  }

  async removeHoliday(principal: Principal, propertyId: string, holidayId: string): Promise<void> {
    await this.run(principal, async (tx) => {
      await requireProperty(tx, principal, propertyId);
      const holiday = await tx.holiday.findFirst({ where: { id: holidayId, propertyId } });
      if (!holiday) throw new ApiError('NOT_FOUND', 'No such holiday');
      await tx.holiday.delete({ where: { id: holidayId } });
      await writeAudit(tx, {
        tenantId: principal.tenantId,
        propertyId,
        actor: userActor(principal),
        action: 'holiday.delete',
        entityType: 'holiday',
        entityId: holidayId,
        summary: `${principal.name} removed the holiday ${holiday.name} (${isoDateOf(holiday.date)})`,
      });
    });
  }
}
