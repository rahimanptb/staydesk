import { Inject, Injectable } from '@nestjs/common';
import type {
  AvailabilityGrid,
  AvailabilityNight,
  AvailabilityQuote,
  AvailabilityQuoteResult,
} from '@staydesk/contracts';
import type { DbTransaction } from '@staydesk/db';
import {
  Stay,
  aggregateOccupancyFits,
  available,
  classifyNight,
  stayPolicyViolations,
  worstStatus,
} from '@staydesk/domain';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { isoDateOf } from '../common/dates.js';
import { TenantDb } from '../database/database.module.js';
import { businessDateOf, requireProperty } from './property-access.js';

interface NightRow {
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

interface TypeRow {
  id: string;
  name: string;
  code: string;
  totalInventory: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
}

/**
 * Read paths of the engine (docs/08 §9). Reads take no locks and may be milliseconds stale;
 * every write re-validates under lock, so the UI says availability is confirmed on save.
 */
@Injectable()
export class AvailabilityService {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  private run<T>(p: Principal, fn: (tx: DbTransaction) => Promise<T>) {
    return this.tenantDb.run({ tenantId: p.tenantId!, userId: p.userId }, fn);
  }

  /** Active room types of the property with each night of [from, to). */
  private async load(
    tx: DbTransaction,
    propertyId: string,
    from: string,
    to: string,
    lowThreshold: number,
    roomTypeIds?: readonly string[],
  ): Promise<Array<{ type: TypeRow; nights: AvailabilityNight[] }>> {
    const types = await tx.roomType.findMany({
      where: {
        propertyId,
        status: 'ACTIVE',
        ...(roomTypeIds ? { id: { in: [...roomTypeIds] } } : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        totalInventory: true,
        maxAdults: true,
        maxChildren: true,
        maxOccupancy: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    if (types.length === 0) return [];
    const ids = types.map((t) => t.id);
    // A missing row means nothing has ever consumed that night: the room type's total applies.
    const rows = await tx.$queryRaw<NightRow[]>`
      SELECT rt.id AS room_type_id, d.date,
             COALESCE(i.total, rt.total_inventory) AS total,
             COALESCE(i.booked, 0) AS booked, COALESCE(i.held, 0) AS held,
             COALESCE(i.blocked, 0) AS blocked, COALESCE(i.out_of_service, 0) AS out_of_service,
             COALESCE(i.overbook_allowance, 0) AS overbook_allowance,
             COALESCE(i.closed_all, false) AS closed_all,
             COALESCE(i.closed_agents, false) AS closed_agents
      FROM room_type rt
      CROSS JOIN LATERAL (
        SELECT g::date AS date
        FROM generate_series(${from}::timestamp, ${to}::timestamp - interval '1 day', interval '1 day') g
      ) d
      LEFT JOIN inventory_day i ON i.room_type_id = rt.id AND i.date = d.date
      WHERE rt.id = ANY(${ids}::uuid[])
      ORDER BY rt.id, d.date`;

    const byType = new Map<string, AvailabilityNight[]>(ids.map((id) => [id, []]));
    for (const r of rows) {
      const counters = {
        total: r.total,
        booked: r.booked,
        held: r.held,
        blocked: r.blocked,
        outOfService: r.out_of_service,
        overbookAllowance: r.overbook_allowance,
      };
      byType.get(r.room_type_id)!.push({
        date: isoDateOf(r.date),
        total: r.total,
        booked: r.booked,
        held: r.held,
        blocked: r.blocked,
        outOfService: r.out_of_service,
        available: available(counters),
        closedAll: r.closed_all,
        closedAgents: r.closed_agents,
        status: classifyNight(
          { ...counters, closedAll: r.closed_all, closedAgents: r.closed_agents },
          lowThreshold,
          'STAFF',
        ),
      });
    }
    return types.map((type) => ({ type, nights: byType.get(type.id)! }));
  }

  async grid(
    principal: Principal,
    propertyId: string,
    query: { from: string; to: string; roomTypeIds?: string[] | undefined },
  ): Promise<AvailabilityGrid> {
    return this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const rows = await this.load(
        tx,
        propertyId,
        query.from,
        query.to,
        property.lowAvailabilityThreshold,
        query.roomTypeIds,
      );
      return {
        propertyId,
        from: query.from,
        to: query.to,
        businessDate: businessDateOf(property).toString(),
        lowAvailabilityThreshold: property.lowAvailabilityThreshold,
        roomTypes: rows.map(({ type, nights }) => ({
          roomTypeId: type.id,
          name: type.name,
          code: type.code,
          totalInventory: type.totalInventory,
          nights,
        })),
      };
    });
  }

  /** A staff stay quote: per room type, the stay's minimum availability and occupancy fit. */
  async check(
    principal: Principal,
    propertyId: string,
    input: {
      checkIn: string;
      checkOut: string;
      rooms: number;
      adults: number;
      children: number;
      roomTypeIds?: string[] | undefined;
    },
  ): Promise<AvailabilityQuote> {
    return this.run(principal, async (tx) => {
      const property = await requireProperty(tx, principal, propertyId);
      const stay = Stay.parse(input.checkIn, input.checkOut);
      const violation = stayPolicyViolations(
        stay,
        { horizonDays: property.bookingHorizonDays, maxStayNights: property.maxStayNights },
        {
          businessDate: businessDateOf(property),
          allowBackdate: principal.permissions.has('booking.backdate'),
        },
      )[0];
      if (violation) throw new ApiError(violation.code, violation.message);

      const rows = await this.load(
        tx,
        propertyId,
        input.checkIn,
        input.checkOut,
        property.lowAvailabilityThreshold,
        input.roomTypeIds,
      );
      const party = { rooms: input.rooms, adults: input.adults, children: input.children };
      const results: AvailabilityQuoteResult[] = rows.map(({ type, nights }) => {
        const minimum = Math.min(...nights.map((n) => n.available));
        const limiting = nights.find((n) => n.available === minimum)!;
        const closed = nights.some((n) => n.closedAll);
        const sellable = closed ? 0 : Math.max(0, minimum);
        const occupancyFits = aggregateOccupancyFits(party, type);
        return {
          roomTypeId: type.id,
          name: type.name,
          code: type.code,
          available: minimum,
          sellable,
          status: worstStatus(nights.map((n) => n.status)),
          occupancyFits,
          canBook: occupancyFits && sellable >= input.rooms,
          limitingDate: limiting.date,
          nights,
        };
      });
      return {
        propertyId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights: stay.nights,
        ...party,
        results,
      };
    });
  }
}
