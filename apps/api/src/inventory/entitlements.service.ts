import { Injectable } from '@nestjs/common';
import type { DbTransaction } from '@staydesk/db';
import { ApiError } from '../common/api-error.js';

/** Limit keys used by plans (docs/04 §3.1). Missing entitlements mean "unlimited". */
export type LimitKey = 'limit.properties' | 'limit.rooms' | 'limit.staff' | 'limit.agencies';

/**
 * Effective entitlements: tenant override, else the current plan's value, else unlimited.
 * Nothing about plans is hard-coded (BR-23).
 */
@Injectable()
export class EntitlementsService {
  async limit(tx: DbTransaction, tenantId: string, key: LimitKey): Promise<number | null> {
    const override = await tx.tenantEntitlementOverride.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (override && override.intValue !== null) return override.intValue;
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { currentSubscription: { select: { planId: true } } },
    });
    const planId = tenant?.currentSubscription?.planId;
    if (!planId) return null;
    const entitlement = await tx.planEntitlement.findUnique({
      where: { planId_key: { planId, key } },
    });
    return entitlement?.intValue ?? null;
  }

  /** Throws PLAN_LIMIT_REACHED when `wouldBe` exceeds the limit. Downgrades never delete data. */
  async assertWithin(
    tx: DbTransaction,
    tenantId: string,
    key: LimitKey,
    current: number,
    wouldBe: number,
    noun: string,
  ): Promise<void> {
    if (wouldBe <= current) return;
    const max = await this.limit(tx, tenantId, key);
    if (max !== null && wouldBe > max) {
      throw new ApiError('PLAN_LIMIT_REACHED', `Your plan allows up to ${max} ${noun}`, {
        meta: { limit: key, max, current },
      });
    }
  }

  /** Rooms counted against limit.rooms: total inventory of every non-archived room type. */
  async roomCount(
    tx: DbTransaction,
    tenantId: string,
    excludingRoomTypeId?: string,
  ): Promise<number> {
    const result = await tx.roomType.aggregate({
      where: {
        tenantId,
        archivedAt: null,
        ...(excludingRoomTypeId ? { id: { not: excludingRoomTypeId } } : {}),
      },
      _sum: { totalInventory: true },
    });
    return result._sum.totalInventory ?? 0;
  }
}
