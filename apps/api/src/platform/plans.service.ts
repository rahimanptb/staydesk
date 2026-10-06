import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type DbClient } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM_DB } from '../database/database.module.js';

export interface PlanView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  entitlements: Array<{ key: string; intValue: number | null; boolValue: boolean | null }>;
}

type PlanWithEntitlements = Prisma.PlanGetPayload<{ include: { entitlements: true } }>;

const view = (p: PlanWithEntitlements): PlanView => ({
  id: p.id,
  code: p.code,
  name: p.name,
  description: p.description,
  isPublic: p.isPublic,
  isActive: p.isActive,
  sortOrder: p.sortOrder,
  entitlements: p.entitlements
    .map((e) => ({ key: e.key, intValue: e.intValue, boolValue: e.boolValue }))
    .sort((a, b) => a.key.localeCompare(b.key)),
});

const actor = (p: Principal) => ({ type: 'PLATFORM_ADMIN' as const, userId: p.userId });

/** Subscription plans and their configurable limits — nothing about pricing is hard-coded. */
@Injectable()
export class PlansService {
  constructor(@Inject(PLATFORM_DB) private readonly db: DbClient) {}

  async list(): Promise<PlanView[]> {
    const plans = await this.db.plan.findMany({
      include: { entitlements: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return plans.map(view);
  }

  private async get(id: string): Promise<PlanView> {
    const plan = await this.db.plan.findUnique({ where: { id }, include: { entitlements: true } });
    if (!plan) throw new ApiError('NOT_FOUND', 'No such plan');
    return view(plan);
  }

  async create(
    principal: Principal,
    input: {
      code: string;
      name: string;
      description?: string;
      isPublic: boolean;
      isActive: boolean;
      sortOrder: number;
    },
  ): Promise<PlanView> {
    try {
      const id = await this.db.$transaction(async (tx) => {
        const plan = await tx.plan.create({
          data: { ...input, description: input.description ?? null },
        });
        await writeAudit(tx, {
          tenantId: null,
          actor: actor(principal),
          action: 'plan.create',
          entityType: 'plan',
          entityId: plan.id,
          summary: `${principal.name} created plan ${plan.name}`,
          after: input,
        });
        return plan.id;
      });
      return this.get(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError('ALREADY_EXISTS', 'A plan with this code already exists');
      }
      throw error;
    }
  }

  async update(
    principal: Principal,
    id: string,
    input: Record<string, unknown>,
  ): Promise<PlanView> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id } });
      if (!before) throw new ApiError('NOT_FOUND', 'No such plan');
      const after = await tx.plan.update({ where: { id }, data: input });
      await writeAudit(tx, {
        tenantId: null,
        actor: actor(principal),
        action: 'plan.update',
        entityType: 'plan',
        entityId: id,
        summary: `${principal.name} updated plan ${after.name}`,
        before,
        after,
      });
    });
    return this.get(id);
  }

  /** Replaces the plan's entitlement set (limits and feature flags). */
  async setEntitlements(
    principal: Principal,
    id: string,
    entitlements: Array<{ key: string; intValue?: number; boolValue?: boolean }>,
  ): Promise<PlanView> {
    const keys = entitlements.map((e) => e.key);
    if (new Set(keys).size !== keys.length)
      throw new ApiError('VALIDATION_FAILED', 'Each entitlement key may appear once');
    await this.db.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id }, include: { entitlements: true } });
      if (!before) throw new ApiError('NOT_FOUND', 'No such plan');
      await tx.planEntitlement.deleteMany({ where: { planId: id } });
      await tx.planEntitlement.createMany({
        data: entitlements.map((e) => ({
          planId: id,
          key: e.key,
          intValue: e.intValue ?? null,
          boolValue: e.boolValue ?? null,
        })),
      });
      await writeAudit(tx, {
        tenantId: null,
        actor: actor(principal),
        action: 'plan.entitlements',
        entityType: 'plan',
        entityId: id,
        summary: `${principal.name} changed the limits of plan ${before.name}`,
        before: view(before).entitlements,
        after: entitlements,
      });
    });
    return this.get(id);
  }
}
