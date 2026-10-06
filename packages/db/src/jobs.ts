import { LocalDate } from '@staydesk/domain';
import { withDbContext, type DbClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import { uuidv7 } from './ids.js';
import { extendInventoryHorizon } from './inventory.js';
import {
  reconcileProperty,
  repairPropertyInventory,
  type ReconciliationResult,
} from './reconciliation.js';

/**
 * Inventory jobs run by the worker (sd_worker role). Each property is processed in its own
 * tenant RLS context; the property list comes from the narrow definer function
 * worker_inventory_targets(), the worker's only cross-tenant read.
 */

export interface InventoryTarget {
  tenantId: string;
  propertyId: string;
  timezone: string;
  bookingHorizonDays: number;
}

export async function inventoryTargets(db: DbClient): Promise<InventoryTarget[]> {
  const rows = await db.$queryRaw<
    Array<{
      tenant_id: string;
      property_id: string;
      timezone: string;
      booking_horizon_days: number;
    }>
  >`SELECT tenant_id, property_id, timezone, booking_horizon_days FROM worker_inventory_targets()`;
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    propertyId: r.property_id,
    timezone: r.timezone,
    bookingHorizonDays: r.booking_horizon_days,
  }));
}

/** Keeps rows ready for [today, today + horizon] (docs/08 §14). Returns rows created. */
export async function rollInventoryHorizon(db: DbClient, target: InventoryTarget): Promise<number> {
  const today = LocalDate.todayIn(target.timezone);
  return withDbContext(db, { tenantId: target.tenantId }, (tx) =>
    extendInventoryHorizon(tx, {
      propertyId: target.propertyId,
      from: today.toString(),
      to: today.plusDays(target.bookingHorizonDays + 1).toString(),
    }),
  );
}

export interface ReconciliationRun extends ReconciliationResult {
  id: string;
}

/**
 * Checks one property and records the run. A mismatch is an incident: an outbox event raises
 * the alert, and nothing is changed automatically.
 */
export async function runReconciliation(
  db: DbClient,
  target: InventoryTarget,
  options: { trigger: 'SCHEDULED' | 'MANUAL'; actor?: string; reason?: string } = {
    trigger: 'SCHEDULED',
  },
): Promise<ReconciliationRun> {
  const startedAt = new Date();
  return withDbContext(
    db,
    { tenantId: target.tenantId },
    async (tx) => {
      const result = await reconcileProperty(tx, target.propertyId);
      const id = uuidv7();
      await tx.inventoryReconciliation.createMany({
        data: {
          id,
          tenantId: target.tenantId,
          propertyId: target.propertyId,
          trigger: options.trigger,
          mismatchCount: result.mismatchCount,
          mismatches: result.mismatches as unknown as Prisma.InputJsonValue,
          actor: options.actor ?? null,
          reason: options.reason ?? null,
          startedAt,
          finishedAt: new Date(),
        },
      });
      if (result.mismatchCount > 0) {
        await tx.outboxEvent.createMany({
          data: {
            tenantId: target.tenantId,
            type: 'inventory.reconciliation_failed',
            aggregateType: 'property',
            aggregateId: target.propertyId,
            payload: {
              propertyId: target.propertyId,
              reconciliationId: id,
              mismatchCount: result.mismatchCount,
            },
          },
        });
      }
      return { id, ...result };
    },
    { timeoutMs: 60_000 },
  );
}

/**
 * The explicit, audited repair (docs/08 §12): rewrites the projection from the oracle under the
 * normal lock order, then proves the result. Only run by an operator after investigation.
 */
export async function repairInventory(
  db: DbClient,
  target: InventoryTarget,
  options: { actor: string; reason: string },
): Promise<{ before: ReconciliationResult; rowsChanged: number; after: ReconciliationResult }> {
  if (options.reason.trim().length < 5) throw new Error('A repair needs a reason');
  const startedAt = new Date();
  return withDbContext(
    db,
    { tenantId: target.tenantId },
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '10s', true)`;
      const before = await reconcileProperty(tx, target.propertyId, { limit: 1000 });
      const rowsChanged = await repairPropertyInventory(tx, target.propertyId);
      const after = await reconcileProperty(tx, target.propertyId);
      if (after.mismatchCount > 0) {
        throw new Error(`Repair left ${after.mismatchCount} mismatches; rolled back`);
      }
      await tx.inventoryReconciliation.createMany({
        data: {
          id: uuidv7(),
          tenantId: target.tenantId,
          propertyId: target.propertyId,
          trigger: 'REPAIR',
          mismatchCount: before.mismatchCount,
          mismatches: before.mismatches as unknown as Prisma.InputJsonValue,
          actor: options.actor,
          reason: options.reason,
          startedAt,
          finishedAt: new Date(),
        },
      });
      await tx.auditLog.createMany({
        data: {
          id: uuidv7(),
          tenantId: target.tenantId,
          propertyId: target.propertyId,
          actorType: 'SYSTEM',
          action: 'inventory.repair',
          entityType: 'property',
          entityId: target.propertyId,
          summary: `Inventory counters were rebuilt from bookings and blocks by ${options.actor} (${before.mismatchCount} mismatch${before.mismatchCount === 1 ? '' : 'es'} fixed): ${options.reason}`,
          after: { rowsChanged, mismatchCount: before.mismatchCount },
        },
      });
      await tx.outboxEvent.createMany({
        data: {
          tenantId: target.tenantId,
          type: 'inventory.changed',
          aggregateType: 'property',
          aggregateId: target.propertyId,
          payload: { propertyId: target.propertyId, reason: 'repair' },
        },
      });
      return { before, rowsChanged, after };
    },
    { timeoutMs: 120_000 },
  );
}
