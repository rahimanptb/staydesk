import { uuidv7, type DbTransaction } from '@staydesk/db';
import { LocalDate, type InventoryBucket } from '@staydesk/domain';
import { ApiError } from '../../src/common/api-error.js';
import { dateColumn, localDateOf } from '../../src/common/dates.js';
import { TenantDb } from '../../src/database/database.module.js';
import { applyInventory } from '../../src/inventory/ledger.js';
import type { Harness } from './harness.js';

/**
 * A minimal stand-in for the M4 booking engine, used to exercise the inventory ledger the way
 * bookings will: booking lines and their inventory change in one locked, retried transaction.
 * The lines are real booking_room rows, so reconciliation sees them as sources of truth.
 */

export interface StayLine {
  roomTypeId: string;
  rooms: number;
}

export interface StayRequest {
  tenantId: string;
  propertyId: string;
  checkIn: LocalDate;
  checkOut: LocalDate;
  lines: StayLine[];
  bucket?: Extract<InventoryBucket, 'BOOKED' | 'HELD'>;
  channel?: 'STAFF' | 'AGENT';
  override?: boolean;
  ignoreStopSell?: boolean;
}

export type StayOutcome =
  { ok: true; bookingId: string } | { ok: false; code: string; meta?: unknown };

let reference = 0;

async function guestFor(tx: DbTransaction, tenantId: string): Promise<string> {
  const existing = await tx.guest.findFirst({ where: { tenantId, lastName: 'Ledger' } });
  if (existing) return existing.id;
  const id = uuidv7();
  await tx.guest.createMany({ data: { id, tenantId, firstName: 'Test', lastName: 'Ledger' } });
  return id;
}

export class LedgerDriver {
  private readonly tenantDb: TenantDb;

  constructor(
    h: Harness,
    private readonly userId: string,
  ) {
    this.tenantDb = h.app.get(TenantDb);
  }

  async book(req: StayRequest): Promise<StayOutcome> {
    const bucket = req.bucket ?? 'BOOKED';
    try {
      const bookingId = await this.tenantDb.runLocked({ tenantId: req.tenantId }, async (tx) => {
        const property = await tx.property.findUniqueOrThrow({ where: { id: req.propertyId } });
        const businessDate = LocalDate.todayIn(property.timezone);
        await applyInventory(
          tx,
          req.lines.map((l) => ({
            roomTypeId: l.roomTypeId,
            from: req.checkIn,
            to: req.checkOut,
            bucket,
            quantity: l.rooms,
          })),
          {
            tenantId: req.tenantId,
            propertyId: req.propertyId,
            businessDate,
            lowAvailabilityThreshold: property.lowAvailabilityThreshold,
            channel: req.channel ?? 'STAFF',
            override: req.override ?? false,
            ignoreStopSell: req.ignoreStopSell ?? false,
          },
        );
        const id = uuidv7();
        const guestId = await guestFor(tx, req.tenantId);
        await tx.booking.createMany({
          data: {
            id,
            tenantId: req.tenantId,
            propertyId: req.propertyId,
            reference: `T-${process.pid}-${++reference}-${id.slice(-6)}`,
            status: bucket === 'HELD' ? 'TENTATIVE' : 'CONFIRMED',
            source: 'DIRECT',
            guestId,
            checkIn: dateColumn(req.checkIn),
            checkOut: dateColumn(req.checkOut),
            adults: 1,
            children: 0,
            currency: property.currency,
            createdById: this.userId,
          },
        });
        const types = await tx.roomType.findMany({
          where: { id: { in: req.lines.map((l) => l.roomTypeId) } },
        });
        await tx.bookingRoom.createMany({
          data: req.lines.flatMap((l) =>
            Array.from({ length: l.rooms }, () => {
              const type = types.find((t) => t.id === l.roomTypeId)!;
              return {
                id: uuidv7(),
                tenantId: req.tenantId,
                propertyId: req.propertyId,
                bookingId: id,
                roomTypeId: l.roomTypeId,
                roomTypeNameSnapshot: type.name,
                roomTypeCodeSnapshot: type.code,
                checkIn: dateColumn(req.checkIn),
                checkOut: dateColumn(req.checkOut),
                adults: 1,
                children: 0,
                invFrom: dateColumn(req.checkIn),
                invTo: dateColumn(req.checkOut),
                inventoryBucket: bucket,
              };
            }),
          ),
        });
        return id;
      });
      return { ok: true, bookingId };
    } catch (error) {
      if (error instanceof ApiError)
        return { ok: false, code: error.code, meta: error.details.meta };
      throw error;
    }
  }

  /** Releases a booking's remaining nights (from the business date), like a cancellation. */
  async cancel(tenantId: string, bookingId: string): Promise<void> {
    await this.tenantDb.runLocked({ tenantId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM booking WHERE id = ${bookingId}::uuid FOR UPDATE`;
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { rooms: true, property: true },
      });
      const businessDate = LocalDate.todayIn(booking.property.timezone);
      const lines = booking.rooms.filter((r) => r.inventoryBucket !== 'NONE');
      await applyInventory(
        tx,
        lines.map((r) => ({
          roomTypeId: r.roomTypeId,
          from: LocalDate.max(localDateOf(r.invFrom), businessDate),
          to: localDateOf(r.invTo),
          bucket: r.inventoryBucket as 'BOOKED' | 'HELD',
          quantity: -1,
        })),
        {
          tenantId,
          propertyId: booking.propertyId,
          businessDate,
          lowAvailabilityThreshold: booking.property.lowAvailabilityThreshold,
          channel: 'STAFF',
        },
      );
      for (const r of lines) {
        await tx.bookingRoom.update({
          where: { id: r.id },
          data: {
            status: 'CANCELLED',
            inventoryBucket: 'NONE',
            invTo: dateColumn(LocalDate.max(localDateOf(r.invFrom), businessDate)),
            cancelledAt: new Date(),
          },
        });
      }
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });
  }
}
