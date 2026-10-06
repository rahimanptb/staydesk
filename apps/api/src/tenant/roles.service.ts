import { Inject, Injectable } from '@nestjs/common';
import type { RoleView } from '@staydesk/contracts';
import {
  PERMISSIONS,
  effectivePermissions,
  isPermissionKey,
  permissionsFor,
  ungrantablePermissions,
  type PermissionKey,
  type RoleContext,
} from '@staydesk/domain';
import type { Prisma } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { TenantDb } from '../database/database.module.js';

type RoleRow = Prisma.RoleGetPayload<{ include: { permissions: true } }>;

const permissionsOf = (r: RoleRow) =>
  effectivePermissions(
    {
      key: r.key,
      context: r.context as RoleContext,
      isSystem: r.isSystem,
      isEditable: r.isEditable,
    },
    r.permissions.map((p) => p.permissionKey),
  ).sort();

const view = (r: RoleRow): RoleView => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  isEditable: r.isEditable,
  permissions: permissionsOf(r),
});

export interface PermissionView {
  key: PermissionKey;
  category: string;
  description: string;
  ownerOnly: boolean;
}

@Injectable()
export class RolesService {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  catalogue(): PermissionView[] {
    return permissionsFor('TENANT').map((key) => {
      const def = PERMISSIONS[key];
      return {
        key,
        category: def.category,
        description: def.description,
        ownerOnly: 'ownerOnly' in def,
      };
    });
  }

  async list(principal: Principal): Promise<RoleView[]> {
    const roles = await this.tenantDb.run(
      { tenantId: principal.tenantId!, userId: principal.userId },
      (tx) =>
        tx.role.findMany({
          where: { tenantId: principal.tenantId!, context: 'TENANT' },
          include: { permissions: true },
          orderBy: { createdAt: 'asc' },
        }),
    );
    return roles.map(view);
  }

  /** Replaces an editable role's permissions. PE-1: only permissions the editor holds. */
  async setPermissions(
    principal: Principal,
    roleId: string,
    requested: string[],
  ): Promise<RoleView> {
    const unknown = requested.filter(
      (k) => !isPermissionKey(k) || PERMISSIONS[k].context !== 'TENANT',
    );
    if (unknown.length > 0) {
      throw new ApiError('VALIDATION_FAILED', `Unknown permissions: ${unknown.join(', ')}`);
    }
    const keys = [...new Set(requested as PermissionKey[])];
    if (ungrantablePermissions(principal.permissions, keys, 'TENANT').length > 0) {
      throw new ApiError('FORBIDDEN', 'You cannot grant permissions you do not have');
    }

    const role = await this.tenantDb.run(
      { tenantId: principal.tenantId!, userId: principal.userId },
      async (tx) => {
        const before = await tx.role.findFirst({
          where: { id: roleId, tenantId: principal.tenantId!, context: 'TENANT' },
          include: { permissions: true },
        });
        if (!before) throw new ApiError('NOT_FOUND', 'No such role');
        if (!before.isEditable)
          throw new ApiError('FORBIDDEN', `The ${before.name} role cannot be edited`);
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (keys.length > 0) {
          await tx.rolePermission.createMany({
            data: keys.map((permissionKey) => ({ roleId, permissionKey })),
          });
        }
        const after = await tx.role.findUniqueOrThrow({
          where: { id: roleId },
          include: { permissions: true },
        });
        await writeAudit(tx, {
          tenantId: principal.tenantId,
          actor: {
            type: 'USER',
            userId: principal.userId,
            supportGrantId: principal.supportGrantId,
          },
          action: 'role.permissions_changed',
          entityType: 'role',
          entityId: roleId,
          summary: `${principal.name} changed the permissions of the ${before.name} role`,
          before: { permissions: permissionsOf(before) },
          after: { permissions: permissionsOf(after) },
        });
        return after;
      },
    );
    return view(role);
  }
}
