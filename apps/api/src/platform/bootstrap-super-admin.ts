import type { DbClient } from '@staydesk/db';
import { writeAudit } from '../audit/audit.js';
import { issueInvitationToken } from '../auth/invitations.service.js';

/**
 * Creates (or re-invites) a Super Admin and returns a one-time invitation token. Runs as
 * sd_platform. Used by the bootstrap CLI and the end-to-end tests.
 */
export async function bootstrapSuperAdmin(
  db: DbClient,
  input: { email: string; name: string },
): Promise<string> {
  return db.$transaction(async (tx) => {
    const role = await tx.role.findFirst({ where: { tenantId: null, key: 'SUPER_ADMIN' } });
    if (!role) {
      throw new Error(
        'SUPER_ADMIN role missing — run `pnpm db:migrate` (which seeds the catalogue) first',
      );
    }
    const user =
      (await tx.user.findUnique({ where: { email: input.email } })) ??
      (await tx.user.create({ data: { email: input.email, name: input.name, status: 'INVITED' } }));
    const existing = await tx.platformMembership.findUnique({ where: { userId: user.id } });
    if (existing && existing.status === 'ACTIVE') {
      throw new Error(`${input.email} is already an active platform user`);
    }
    const membership =
      existing ??
      (await tx.platformMembership.create({
        data: { userId: user.id, roleId: role.id, status: 'INVITED' },
      }));

    const token = await issueInvitationToken(tx, {
      userId: user.id,
      email: user.email,
      payload: { kind: 'PLATFORM', membershipId: membership.id },
    });
    await writeAudit(tx, {
      tenantId: null,
      actor: { type: 'SYSTEM' },
      action: 'platform_user.bootstrap',
      entityType: 'platform_membership',
      entityId: membership.id,
      summary: `Super Admin invitation created for ${input.email} from the command line`,
    });
    return token;
  });
}
