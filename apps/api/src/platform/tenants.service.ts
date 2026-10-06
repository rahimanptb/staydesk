import { Inject, Injectable } from '@nestjs/common';
import type { CreateTenantRequest } from '@staydesk/contracts';
import { SYSTEM_ROLES } from '@staydesk/domain';
import { Prisma, uuidv7, type DbClient } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import { writeOutbox } from '../audit/outbox.js';
import type { Principal } from '../auth/principal.js';
import { InvitationsService } from '../auth/invitations.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM_DB } from '../database/database.module.js';

export interface PlatformTenantView {
  id: string;
  name: string;
  slug: string;
  status: string;
  country: string;
  legalName: string | null;
  billingEmail: string | null;
  plan: { id: string; code: string; name: string } | null;
  subscriptionStatus: string | null;
  createdAt: string;
}

const tenantInclude = { currentSubscription: { include: { plan: true } } } as const;
type TenantWithPlan = Prisma.TenantGetPayload<{ include: typeof tenantInclude }>;

function view(t: TenantWithPlan): PlatformTenantView {
  const sub = t.currentSubscription;
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    country: t.country,
    legalName: t.legalName,
    billingEmail: t.billingEmail,
    plan: sub ? { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name } : null,
    subscriptionStatus: sub?.status ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

const actor = (p: Principal) => ({ type: 'PLATFORM_ADMIN' as const, userId: p.userId });

/** Platform-side tenant lifecycle (docs/03 F1). Runs as sd_platform. */
@Injectable()
export class TenantsService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: DbClient,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  async list(): Promise<PlatformTenantView[]> {
    const tenants = await this.db.tenant.findMany({
      include: tenantInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return tenants.map(view);
  }

  async get(id: string): Promise<PlatformTenantView> {
    const tenant = await this.db.tenant.findUnique({ where: { id }, include: tenantInclude });
    if (!tenant) throw new ApiError('NOT_FOUND', 'No such tenant');
    return view(tenant);
  }

  /**
   * Creates a tenant with its subscription, system roles and an invited owner, in one
   * transaction; the invitation email is sent after commit.
   */
  async create(principal: Principal, input: CreateTenantRequest): Promise<PlatformTenantView> {
    const plan = await this.db.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) throw new ApiError('VALIDATION_FAILED', 'Choose an active plan');

    let invitation: { token: string; email: string } | undefined;
    let tenantId: string;
    try {
      tenantId = await this.db.$transaction(async (tx) => {
        const now = new Date();
        const tenant = await tx.tenant.create({
          data: {
            // Explicit id: Tenant's primary key is part of its composite subscription relation,
            // which stops Prisma from generating it.
            id: uuidv7(),
            name: input.name,
            slug: input.slug,
            country: input.country,
            legalName: input.legalName ?? null,
            billingEmail: input.billingEmail ?? null,
            status: 'ACTIVE',
            activatedAt: now,
          },
        });
        const subscription = await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: input.trialEndsAt ? 'TRIALING' : 'ACTIVE',
            trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
            currentPeriodStart: now,
          },
        });
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { currentSubscriptionId: subscription.id },
        });

        const roles = new Map<string, string>();
        for (const template of SYSTEM_ROLES.filter((r) => r.context === 'TENANT')) {
          const role = await tx.role.create({
            data: {
              tenantId: tenant.id,
              context: 'TENANT',
              key: template.key,
              name: template.name,
              isSystem: true,
              isEditable: template.editable,
              ...(template.editable
                ? {
                    permissions: {
                      create: template.permissions.map((permissionKey) => ({ permissionKey })),
                    },
                  }
                : {}),
            },
          });
          roles.set(template.key, role.id);
        }

        const owner =
          (await tx.user.findUnique({ where: { email: input.owner.email } })) ??
          (await tx.user.create({
            data: { email: input.owner.email, name: input.owner.name, status: 'INVITED' },
          }));
        const membership = await tx.tenantMembership.create({
          data: {
            tenantId: tenant.id,
            userId: owner.id,
            roleId: roles.get('HOTEL_ADMIN')!,
            isOwner: true,
            status: 'INVITED',
            invitedById: principal.userId,
          },
        });
        const token = await this.invitations.issue(tx, {
          userId: owner.id,
          email: owner.email,
          payload: { kind: 'TENANT', tenantId: tenant.id, membershipId: membership.id },
        });
        invitation = { token, email: owner.email };

        await writeAudit(tx, {
          tenantId: tenant.id,
          actor: actor(principal),
          action: 'tenant.create',
          entityType: 'tenant',
          entityId: tenant.id,
          summary: `${principal.name} created the account "${tenant.name}" on plan ${plan.name} and invited ${owner.email} as owner`,
          after: {
            name: tenant.name,
            slug: tenant.slug,
            planCode: plan.code,
            ownerEmail: owner.email,
          },
        });
        await writeOutbox(tx, {
          tenantId: tenant.id,
          type: 'tenant.created',
          aggregateType: 'tenant',
          aggregateId: tenant.id,
          payload: { planId: plan.id },
        });
        return tenant.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError('ALREADY_EXISTS', 'A tenant with this slug already exists', {
          errors: [{ path: 'slug', code: 'taken', message: 'This slug is taken' }],
        });
      }
      throw error;
    }

    if (invitation) {
      await this.invitations.send({
        email: invitation.email,
        token: invitation.token,
        portal: 'hotel',
        organizationName: input.name,
        inviterName: null,
      });
    }
    return this.get(tenantId);
  }

  async update(
    principal: Principal,
    id: string,
    input: { name?: string; legalName?: string | null; billingEmail?: string | null },
  ): Promise<PlatformTenantView> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id } });
      if (!before) throw new ApiError('NOT_FOUND', 'No such tenant');
      const after = await tx.tenant.update({ where: { id }, data: input });
      await writeAudit(tx, {
        tenantId: id,
        actor: actor(principal),
        action: 'tenant.update',
        entityType: 'tenant',
        entityId: id,
        summary: `${principal.name} updated the account details`,
        before: {
          name: before.name,
          legalName: before.legalName,
          billingEmail: before.billingEmail,
        },
        after: { name: after.name, legalName: after.legalName, billingEmail: after.billingEmail },
      });
    });
    return this.get(id);
  }

  /** Activate, suspend (read-only, BR-24) or deactivate (signed out, data retained). */
  async setStatus(
    principal: Principal,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED',
    reason: string,
  ): Promise<PlatformTenantView> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id } });
      if (!before) throw new ApiError('NOT_FOUND', 'No such tenant');
      if (before.status === status) return;
      const now = new Date();
      await tx.tenant.update({
        where: { id },
        data: {
          status,
          ...(status === 'ACTIVE'
            ? { activatedAt: now, suspendedAt: null, suspensionReason: null }
            : {}),
          ...(status === 'SUSPENDED' ? { suspendedAt: now, suspensionReason: reason } : {}),
          ...(status === 'DEACTIVATED' ? { deactivatedAt: now, suspensionReason: reason } : {}),
        },
      });
      if (status === 'DEACTIVATED') {
        await tx.session.updateMany({
          where: { tenantId: id, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'tenant deactivated' },
        });
      }
      const verb = { ACTIVE: 'activated', SUSPENDED: 'suspended', DEACTIVATED: 'deactivated' }[
        status
      ];
      await writeAudit(tx, {
        tenantId: id,
        actor: actor(principal),
        action: `tenant.${verb}`,
        entityType: 'tenant',
        entityId: id,
        summary: `${principal.name} ${verb} the account: ${reason}`,
        before: { status: before.status },
        after: { status },
      });
      await writeOutbox(tx, {
        tenantId: id,
        type: 'tenant.statusChanged',
        aggregateType: 'tenant',
        aggregateId: id,
        payload: { from: before.status, to: status },
      });
    });
    return this.get(id);
  }
}
