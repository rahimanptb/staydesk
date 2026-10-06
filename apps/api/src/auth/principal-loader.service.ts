import { Inject, Injectable } from '@nestjs/common';
import type { MfaState } from '@staydesk/contracts';
import { effectivePermissions, type PermissionKey, type RoleContext } from '@staydesk/domain';
import { withDbContext, type DbClient, type Role, type RolePermission } from '@staydesk/db';
import { ApiError } from '../common/api-error.js';
import { DB_CLIENT, PLATFORM_DB } from '../database/database.module.js';
import type { Principal } from './principal.js';
import { SessionsService, type SessionWithUser } from './sessions.service.js';

type RoleWithPermissions = Role & { permissions?: RolePermission[] };

function permissionsOf(role: RoleWithPermissions): Set<PermissionKey> {
  return new Set(
    effectivePermissions(
      {
        key: role.key,
        context: role.context as RoleContext,
        isSystem: role.isSystem,
        isEditable: role.isEditable,
      },
      (role.permissions ?? []).map((p) => p.permissionKey),
    ),
  );
}

/**
 * Resolves a session into a Principal by loading the membership, role and account status on
 * every request, so suspensions and role changes take effect immediately (PE-4).
 */
@Injectable()
export class PrincipalLoader {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(PLATFORM_DB) private readonly platformDb: DbClient,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async load(session: SessionWithUser): Promise<Principal> {
    const { user } = session;
    if (user.status !== 'ACTIVE') {
      await this.sessions.revoke(session.id, 'account not active');
      throw new ApiError('UNAUTHENTICATED', 'Please sign in again');
    }

    const base = {
      sessionId: session.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      context: session.context,
      tenantId: null,
      agencyId: null,
      membershipId: null,
      isOwner: false,
      roleKey: null,
      permissions: new Set<PermissionKey>(),
      allProperties: false,
      propertyIds: [] as string[],
      tenantStatus: null,
      supportGrantId: session.supportGrantId,
    } satisfies Omit<Principal, 'mfa'>;

    const totpEnabled = user.totpEnabledAt !== null;
    const mfa = (enrollmentRequired: boolean): MfaState =>
      totpEnabled
        ? session.mfaVerifiedAt
          ? 'NONE'
          : 'VERIFY'
        : enrollmentRequired
          ? 'ENROLL'
          : 'NONE';

    switch (session.context) {
      case 'PLATFORM': {
        const membership = await this.platformDb.platformMembership.findUnique({
          where: { userId: user.id },
          include: { role: true },
        });
        if (!membership || membership.status !== 'ACTIVE') return this.reject(session);
        return {
          ...base,
          membershipId: membership.id,
          roleKey: membership.role.key,
          permissions: permissionsOf(membership.role),
          // Platform accounts always require two-factor authentication (docs/10 §2).
          mfa: mfa(true),
        };
      }

      case 'TENANT': {
        if (!session.tenantId) return { ...base, mfa: mfa(false) };
        const tenantId = session.tenantId;
        const membership = await withDbContext(this.db, { tenantId, userId: user.id }, (tx) =>
          tx.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            include: { role: { include: { permissions: true } }, properties: true, tenant: true },
          }),
        );
        if (!membership || membership.status !== 'ACTIVE') return this.reject(session);
        const { tenant } = membership;
        if (tenant.status !== 'ACTIVE' && tenant.status !== 'SUSPENDED') {
          await this.sessions.revoke(session.id, 'tenant not active');
          throw new ApiError('TENANT_SUSPENDED', 'This hotel account is not active');
        }
        return {
          ...base,
          tenantId,
          membershipId: membership.id,
          isOwner: membership.isOwner,
          roleKey: membership.role.key,
          permissions: permissionsOf(membership.role),
          allProperties: membership.allProperties,
          propertyIds: membership.properties.map((p) => p.propertyId),
          tenantStatus: tenant.status,
          mfa: mfa(tenant.requireStaff2fa),
        };
      }

      case 'AGENCY': {
        if (!session.agencyId) return { ...base, mfa: mfa(false) };
        const agencyId = session.agencyId;
        const membership = await withDbContext(this.db, { agencyId, userId: user.id }, (tx) =>
          tx.agencyMembership.findUnique({
            where: { agencyId_userId: { agencyId, userId: user.id } },
            include: { role: true, agency: true },
          }),
        );
        if (
          !membership ||
          membership.status !== 'ACTIVE' ||
          membership.agency.status !== 'ACTIVE'
        ) {
          return this.reject(session);
        }
        return {
          ...base,
          agencyId,
          membershipId: membership.id,
          roleKey: membership.role.key,
          permissions: permissionsOf(membership.role),
          mfa: mfa(false),
        };
      }
    }
  }

  private async reject(session: SessionWithUser): Promise<never> {
    await this.sessions.revoke(session.id, 'membership not active');
    throw new ApiError('UNAUTHENTICATED', 'Please sign in again');
  }
}
