import { Inject, Injectable } from '@nestjs/common';
import type { InviteUserRequest, MembershipView } from '@staydesk/contracts';
import { effectivePermissions, ungrantablePermissions, type RoleContext } from '@staydesk/domain';
import type { Prisma, DbTransaction } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import { writeOutbox } from '../audit/outbox.js';
import { InvitationsService } from '../auth/invitations.service.js';
import type { Principal } from '../auth/principal.js';
import { SessionsService } from '../auth/sessions.service.js';
import { ApiError } from '../common/api-error.js';
import { TenantDb } from '../database/database.module.js';

const membershipInclude = {
  user: { select: { id: true, name: true, email: true, status: true } },
  role: { select: { id: true, key: true, name: true } },
  properties: { select: { propertyId: true } },
} as const;
type MembershipRow = Prisma.TenantMembershipGetPayload<{ include: typeof membershipInclude }>;

const view = (m: MembershipRow): MembershipView => ({
  id: m.id,
  user: m.user,
  role: m.role,
  status: m.status,
  isOwner: m.isOwner,
  allProperties: m.allProperties,
  propertyIds: m.properties.map((p) => p.propertyId),
  createdAt: m.createdAt.toISOString(),
});

const actor = (p: Principal) => ({
  type: 'USER' as const,
  userId: p.userId,
  supportGrantId: p.supportGrantId,
});

/** Staff management with the privilege-escalation rules of docs/02 §7. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  private scope(p: Principal) {
    return { tenantId: p.tenantId!, userId: p.userId };
  }

  async list(principal: Principal): Promise<MembershipView[]> {
    const rows = await this.tenantDb.run(this.scope(principal), (tx) =>
      tx.tenantMembership.findMany({
        where: { tenantId: principal.tenantId!, status: { not: 'REVOKED' } },
        include: membershipInclude,
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(view);
  }

  /** PE-1 and PE-3: the role must be this tenant's, grantable by the actor. */
  private async assignableRole(tx: DbTransaction, principal: Principal, roleId: string) {
    const role = await tx.role.findFirst({
      where: { id: roleId, tenantId: principal.tenantId!, context: 'TENANT' },
      include: { permissions: true },
    });
    if (!role) {
      throw new ApiError('VALIDATION_FAILED', 'Choose a role of this account', {
        errors: [{ path: 'roleId', code: 'invalid_role', message: 'Unknown role' }],
      });
    }
    if (role.key === 'HOTEL_ADMIN' && !principal.isOwner) {
      throw new ApiError('FORBIDDEN', 'Only owners can grant the Hotel Admin role');
    }
    const permissions = effectivePermissions(
      {
        key: role.key,
        context: role.context as RoleContext,
        isSystem: role.isSystem,
        isEditable: role.isEditable,
      },
      role.permissions.map((p) => p.permissionKey),
    );
    if (ungrantablePermissions(principal.permissions, permissions, 'TENANT').length > 0) {
      throw new ApiError('FORBIDDEN', 'You cannot grant a role with permissions you do not have');
    }
    return role;
  }

  private async assertProperties(
    tx: DbTransaction,
    principal: Principal,
    propertyIds: readonly string[],
  ) {
    if (propertyIds.length === 0) return;
    const found = await tx.property.count({
      where: { tenantId: principal.tenantId!, id: { in: [...propertyIds] } },
    });
    if (found !== new Set(propertyIds).size) {
      throw new ApiError('VALIDATION_FAILED', 'One or more properties do not exist', {
        errors: [{ path: 'propertyIds', code: 'invalid_property', message: 'Unknown property' }],
      });
    }
  }

  async invite(principal: Principal, input: InviteUserRequest): Promise<MembershipView> {
    let sendTo: { email: string; token: string; organizationName: string } | undefined;
    const membershipId = await this.tenantDb.run(this.scope(principal), async (tx) => {
      const role = await this.assignableRole(tx, principal, input.roleId);
      const propertyIds = input.allProperties ? [] : input.propertyIds;
      await this.assertProperties(tx, principal, propertyIds);

      const user =
        (await tx.user.findUnique({ where: { email: input.email } })) ??
        (await tx.user.create({
          data: { email: input.email, name: input.name, status: 'INVITED' },
        }));

      const existing = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: principal.tenantId!, userId: user.id } },
      });
      if (existing && existing.status !== 'REVOKED' && existing.status !== 'INVITED') {
        throw new ApiError('ALREADY_EXISTS', 'This person is already a member of this account');
      }
      const data = {
        roleId: role.id,
        allProperties: input.allProperties,
        status: 'INVITED' as const,
        invitedById: principal.userId,
        acceptedAt: null,
      };
      const membership = existing
        ? await tx.tenantMembership.update({ where: { id: existing.id }, data })
        : await tx.tenantMembership.create({
            data: { ...data, tenantId: principal.tenantId!, userId: user.id, isOwner: false },
          });
      await tx.membershipProperty.deleteMany({ where: { membershipId: membership.id } });
      if (propertyIds.length > 0) {
        await tx.membershipProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            tenantId: principal.tenantId!,
            membershipId: membership.id,
            propertyId,
          })),
        });
      }

      const token = await this.invitations.issue(tx, {
        userId: user.id,
        email: user.email,
        payload: { kind: 'TENANT', tenantId: principal.tenantId!, membershipId: membership.id },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: principal.tenantId! },
        select: { name: true },
      });
      sendTo = { email: user.email, token, organizationName: tenant.name };

      await writeAudit(tx, {
        tenantId: principal.tenantId,
        actor: actor(principal),
        action: 'user.invited',
        entityType: 'tenant_membership',
        entityId: membership.id,
        summary: `${principal.name} invited ${user.email} as ${role.name}`,
        after: {
          email: user.email,
          role: role.key,
          allProperties: input.allProperties,
          propertyIds,
        },
      });
      await writeOutbox(tx, {
        tenantId: principal.tenantId,
        type: 'user.invited',
        aggregateType: 'tenant_membership',
        aggregateId: membership.id,
        payload: { userId: user.id },
      });
      return membership.id;
    });

    if (sendTo) {
      await this.invitations.send({ ...sendTo, portal: 'hotel', inviterName: principal.name });
    }
    return this.get(principal, membershipId);
  }

  async get(principal: Principal, membershipId: string): Promise<MembershipView> {
    const row = await this.tenantDb.run(this.scope(principal), (tx) =>
      tx.tenantMembership.findFirst({
        where: { id: membershipId, tenantId: principal.tenantId! },
        include: membershipInclude,
      }),
    );
    if (!row) throw new ApiError('NOT_FOUND', 'No such member');
    return view(row);
  }

  /**
   * Shared guard for changing someone else's membership: PE-2 (not yourself), PE-3 (admins and
   * owners are managed by owners only).
   */
  private async target(tx: DbTransaction, principal: Principal, membershipId: string) {
    const target = await tx.tenantMembership.findFirst({
      where: { id: membershipId, tenantId: principal.tenantId! },
      include: { role: true, user: true },
    });
    if (!target || target.status === 'REVOKED') throw new ApiError('NOT_FOUND', 'No such member');
    if (target.userId === principal.userId) {
      throw new ApiError('FORBIDDEN', 'You cannot change your own access');
    }
    if ((target.isOwner || target.role.key === 'HOTEL_ADMIN') && !principal.isOwner) {
      throw new ApiError('FORBIDDEN', 'Only owners can change Hotel Admins');
    }
    return target;
  }

  /** BR-30: an account always keeps at least one active owner. */
  private async assertNotLastOwner(tx: DbTransaction, principal: Principal, membershipId: string) {
    const otherOwners = await tx.tenantMembership.count({
      where: {
        tenantId: principal.tenantId!,
        isOwner: true,
        status: 'ACTIVE',
        id: { not: membershipId },
      },
    });
    if (otherOwners === 0)
      throw new ApiError('LAST_OWNER', 'An account must keep at least one active owner');
  }

  async update(
    principal: Principal,
    membershipId: string,
    input: { roleId?: string; allProperties?: boolean; propertyIds?: string[] },
  ): Promise<MembershipView> {
    const userId = await this.tenantDb.run(this.scope(principal), async (tx) => {
      const target = await this.target(tx, principal, membershipId);
      const role = input.roleId
        ? await this.assignableRole(tx, principal, input.roleId)
        : target.role;
      if (target.isOwner && role.key !== 'HOTEL_ADMIN')
        await this.assertNotLastOwner(tx, principal, target.id);

      const allProperties = input.allProperties ?? target.allProperties;
      const before = await tx.membershipProperty.findMany({ where: { membershipId: target.id } });
      const propertyIds = allProperties
        ? []
        : (input.propertyIds ?? before.map((p) => p.propertyId));
      if (!allProperties && propertyIds.length === 0) {
        throw new ApiError('VALIDATION_FAILED', 'Choose at least one property, or all properties');
      }
      await this.assertProperties(tx, principal, propertyIds);

      await tx.tenantMembership.update({
        where: { id: target.id },
        // An owner demoted from Hotel Admin stops being an owner.
        data: {
          roleId: role.id,
          allProperties,
          ...(role.key !== 'HOTEL_ADMIN' ? { isOwner: false } : {}),
        },
      });
      await tx.membershipProperty.deleteMany({ where: { membershipId: target.id } });
      if (propertyIds.length > 0) {
        await tx.membershipProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            tenantId: principal.tenantId!,
            membershipId: target.id,
            propertyId,
          })),
        });
      }
      await writeAudit(tx, {
        tenantId: principal.tenantId,
        actor: actor(principal),
        action: 'user.access_changed',
        entityType: 'tenant_membership',
        entityId: target.id,
        summary: `${principal.name} changed ${target.user.email}'s access to ${role.name}`,
        before: {
          role: target.role.key,
          allProperties: target.allProperties,
          propertyIds: before.map((p) => p.propertyId),
        },
        after: { role: role.key, allProperties, propertyIds },
      });
      return target.userId;
    });
    // PE-4: the member signs in again with the new access.
    await this.sessions.revokeForTenantMember(userId, principal.tenantId!, 'access changed');
    return this.get(principal, membershipId);
  }

  async setStatus(
    principal: Principal,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
  ): Promise<void> {
    const userId = await this.tenantDb.run(this.scope(principal), async (tx) => {
      const target = await this.target(tx, principal, membershipId);
      if (status === 'ACTIVE' && target.status !== 'SUSPENDED') {
        throw new ApiError(
          'INVALID_STATUS_TRANSITION',
          'Only suspended members can be reactivated',
        );
      }
      if (status !== 'ACTIVE' && target.isOwner)
        await this.assertNotLastOwner(tx, principal, target.id);
      await tx.tenantMembership.update({
        where: { id: target.id },
        data: { status, ...(status === 'REVOKED' ? { isOwner: false } : {}) },
      });
      if (status === 'REVOKED') {
        await tx.authToken.updateMany({
          where: {
            purpose: 'INVITATION',
            usedAt: null,
            revokedAt: null,
            payload: { path: ['membershipId'], equals: target.id },
          },
          data: { revokedAt: new Date() },
        });
      }
      const verb = { ACTIVE: 'reactivated', SUSPENDED: 'suspended', REVOKED: 'removed' }[status];
      await writeAudit(tx, {
        tenantId: principal.tenantId,
        actor: actor(principal),
        action: `user.${verb}`,
        entityType: 'tenant_membership',
        entityId: target.id,
        summary: `${principal.name} ${verb} ${target.user.email}`,
        before: { status: target.status },
        after: { status },
      });
      return target.userId;
    });
    if (status !== 'ACTIVE')
      await this.sessions.revokeForTenantMember(
        userId,
        principal.tenantId!,
        `membership ${status.toLowerCase()}`,
      );
  }
}
