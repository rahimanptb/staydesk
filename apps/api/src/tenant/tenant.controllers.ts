import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  auditLogQuerySchema,
  inviteUserSchema,
  updateMembershipSchema,
  updateRolePermissionsSchema,
  updateTenantProfileSchema,
  type AuditLogView,
  type MembershipView,
  type RoleView,
} from '@staydesk/contracts';
import { writeAudit } from '../audit/audit.js';
import { CurrentPrincipal, ForContext, RequirePermission } from '../auth/decorators.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { parseInput } from '../common/validation.js';
import { TenantDb } from '../database/database.module.js';
import { RolesService, type PermissionView } from './roles.service.js';
import { UsersService } from './users.service.js';

const uuid = new ParseUUIDPipe({ version: '7', errorHttpStatusCode: 404 });
const scope = (p: Principal) => ({ tenantId: p.tenantId!, userId: p.userId });

export interface TenantProfileView {
  id: string;
  name: string;
  slug: string;
  status: string;
  legalName: string | null;
  billingEmail: string | null;
  country: string;
  requireStaff2fa: boolean;
}

@Controller('tenant')
@ForContext('TENANT')
export class TenantProfileController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  private async load(p: Principal): Promise<TenantProfileView> {
    const t = await this.tenantDb.run(scope(p), (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: p.tenantId! } }),
    );
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      legalName: t.legalName,
      billingEmail: t.billingEmail,
      country: t.country,
      requireStaff2fa: t.requireStaff2fa,
    };
  }

  @Get()
  @RequirePermission()
  get(@CurrentPrincipal() principal: Principal): Promise<TenantProfileView> {
    return this.load(principal);
  }

  @Patch()
  @RequirePermission('tenant.manage')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<TenantProfileView> {
    const input = parseInput(updateTenantProfileSchema, body);
    await this.tenantDb.run(scope(principal), async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: principal.tenantId! } });
      const after = await tx.tenant.update({ where: { id: principal.tenantId! }, data: input });
      await writeAudit(tx, {
        tenantId: principal.tenantId,
        actor: { type: 'USER', userId: principal.userId, supportGrantId: principal.supportGrantId },
        action: 'tenant.profile_updated',
        entityType: 'tenant',
        entityId: principal.tenantId,
        summary: `${principal.name} updated the account profile`,
        before: {
          name: before.name,
          legalName: before.legalName,
          billingEmail: before.billingEmail,
          requireStaff2fa: before.requireStaff2fa,
        },
        after: {
          name: after.name,
          legalName: after.legalName,
          billingEmail: after.billingEmail,
          requireStaff2fa: after.requireStaff2fa,
        },
      });
    });
    return this.load(principal);
  }
}

@Controller('users')
@ForContext('TENANT')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user.view')
  list(@CurrentPrincipal() principal: Principal): Promise<MembershipView[]> {
    return this.users.list(principal);
  }

  @Post('invitations')
  @RequirePermission('user.manage')
  invite(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<MembershipView> {
    return this.users.invite(principal, parseInput(inviteUserSchema, body));
  }

  @Get(':membershipId')
  @RequirePermission('user.view')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('membershipId', uuid) id: string,
  ): Promise<MembershipView> {
    return this.users.get(principal, id);
  }

  @Patch(':membershipId')
  @RequirePermission('user.manage')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('membershipId', uuid) id: string,
    @Body() body: unknown,
  ): Promise<MembershipView> {
    return this.users.update(principal, id, parseInput(updateMembershipSchema, body));
  }

  @Post(':membershipId/suspend')
  @RequirePermission('user.manage')
  @HttpCode(204)
  suspend(
    @CurrentPrincipal() p: Principal,
    @Param('membershipId', uuid) id: string,
  ): Promise<void> {
    return this.users.setStatus(p, id, 'SUSPENDED');
  }

  @Post(':membershipId/reactivate')
  @RequirePermission('user.manage')
  @HttpCode(204)
  reactivate(
    @CurrentPrincipal() p: Principal,
    @Param('membershipId', uuid) id: string,
  ): Promise<void> {
    return this.users.setStatus(p, id, 'ACTIVE');
  }

  @Post(':membershipId/revoke')
  @RequirePermission('user.manage')
  @HttpCode(204)
  revoke(@CurrentPrincipal() p: Principal, @Param('membershipId', uuid) id: string): Promise<void> {
    return this.users.setStatus(p, id, 'REVOKED');
  }
}

@Controller()
@ForContext('TENANT')
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermission('user.view')
  list(@CurrentPrincipal() principal: Principal): Promise<RoleView[]> {
    return this.roles.list(principal);
  }

  @Put('roles/:roleId/permissions')
  @RequirePermission('role.manage')
  setPermissions(
    @CurrentPrincipal() principal: Principal,
    @Param('roleId', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RoleView> {
    return this.roles.setPermissions(
      principal,
      id,
      parseInput(updateRolePermissionsSchema, body).permissions,
    );
  }

  @Get('permissions')
  @RequirePermission('user.view')
  catalogue(): PermissionView[] {
    return this.roles.catalogue();
  }
}

@Controller('audit-logs')
@ForContext('TENANT')
export class AuditLogController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  /** Newest first. UUIDv7 ids are time-ordered, so the id alone is a stable cursor. */
  @Get()
  @RequirePermission('auditLog.view')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: unknown,
  ): Promise<{ data: AuditLogView[]; nextCursor: string | null }> {
    const q = parseInput(auditLogQuerySchema, query);
    if (q.cursor && !/^[0-9a-f-]{36}$/.test(q.cursor))
      throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
    const rows = await this.tenantDb.run(scope(principal), (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: principal.tenantId!,
          ...(q.entityType ? { entityType: q.entityType } : {}),
          ...(q.entityId ? { entityId: q.entityId } : {}),
          ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
          ...(q.action ? { action: q.action } : {}),
          ...(q.cursor ? { id: { lt: q.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
      }),
    );
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorType: r.actorType,
        actorUserId: r.actorUserId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: r.summary,
        before: r.before,
        after: r.after,
      })),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
