import { Inject, Injectable, Logger } from '@nestjs/common';
import { brand } from '@staydesk/config';
import type { InvitationPreview, Portal } from '@staydesk/contracts';
import { passwordPolicyViolation } from '@staydesk/domain';
import {
  withDbContext,
  type AuthToken,
  type DbClient,
  type DbTransaction,
  type User,
} from '@staydesk/db';
import { ApiError } from '../common/api-error.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { writeAudit } from '../audit/audit.js';
import { DB_CLIENT, PLATFORM_DB } from '../database/database.module.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { RATE_LIMITER, type RateLimiter } from '../ratelimit/rate-limiter.js';
import { requestMeta } from '../common/request-context.js';
import { invitationEmail } from '../mail/templates.js';
import { randomToken, sha256, toBytes } from '../security/crypto.js';
import { PasswordHasher } from '../security/password-hasher.js';
import { AUTH_RATE_LIMITS, INVITATION_TTL_MS } from './auth.constants.js';

export type InvitationPayload =
  | { kind: 'TENANT'; tenantId: string; membershipId: string }
  | { kind: 'PLATFORM'; membershipId: string };

const INVALID = () => new ApiError('NOT_FOUND', 'This invitation is no longer valid');

/**
 * Creates an invitation token in the caller's transaction (any database role with auth_token
 * access), revoking earlier unused invitations for the same membership. Returns the raw token.
 */
export async function issueInvitationToken(
  tx: DbTransaction,
  input: { userId: string; email: string; payload: InvitationPayload },
): Promise<string> {
  const now = new Date();
  await tx.authToken.updateMany({
    where: {
      purpose: 'INVITATION',
      usedAt: null,
      revokedAt: null,
      payload: { path: ['membershipId'], equals: input.payload.membershipId },
    },
    data: { revokedAt: now },
  });
  const token = randomToken(32);
  await tx.authToken.create({
    data: {
      userId: input.userId,
      email: input.email,
      purpose: 'INVITATION',
      tokenHash: toBytes(sha256(token)),
      payload: input.payload,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    },
  });
  return token;
}

/** Invitation tokens: issued by tenant admins and platform admins, accepted publicly. */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger('Invitations');

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(PLATFORM_DB) private readonly platformDb: DbClient,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  /** Creates a token in the caller's transaction, revoking earlier ones for the same membership. */
  issue(
    tx: DbTransaction,
    input: { userId: string; email: string; payload: InvitationPayload },
  ): Promise<string> {
    return issueInvitationToken(tx, input);
  }

  /** Sends after commit. Failures are logged, not thrown: the invitation can be re-sent. */
  async send(input: {
    email: string;
    token: string;
    portal: Portal;
    organizationName: string;
    inviterName: string | null;
  }): Promise<void> {
    const origin = input.portal === 'admin' ? this.env.ADMIN_ORIGIN : this.env.HOTEL_ORIGIN;
    try {
      await this.mailer.send({
        to: input.email,
        ...invitationEmail({
          organizationName: input.organizationName,
          inviterName: input.inviterName,
          url: `${origin}/invitation#${input.token}`,
          expiresInHours: INVITATION_TTL_MS / 3_600_000,
        }),
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to send invitation email');
    }
  }

  private async validToken(
    token: string,
  ): Promise<{ record: AuthToken; payload: InvitationPayload }> {
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.tokenPerIp;
    const check = await this.limiter.consume(
      `token:ip:${requestMeta()?.ip ?? 'unknown'}`,
      limit,
      windowSeconds,
    );
    if (!check.allowed) {
      throw new ApiError('RATE_LIMITED', 'Too many attempts, please try again later', {
        meta: { retryAfterSeconds: check.retryAfterSeconds },
      });
    }
    const record = await this.db.authToken.findUnique({
      where: { tokenHash: toBytes(sha256(token)) },
    });
    if (
      !record ||
      record.purpose !== 'INVITATION' ||
      record.usedAt ||
      record.revokedAt ||
      record.expiresAt <= new Date() ||
      !record.userId
    ) {
      throw INVALID();
    }
    return { record, payload: record.payload as InvitationPayload };
  }

  async preview(token: string): Promise<InvitationPreview> {
    const { record, payload } = await this.validToken(token);
    const user = await this.db.user.findUnique({ where: { id: record.userId! } });
    if (!user) throw INVALID();
    let organizationName: string = brand.productName;
    if (payload.kind === 'TENANT') {
      const tenant = await withDbContext(this.db, { tenantId: payload.tenantId }, (tx) =>
        tx.tenant.findUnique({ where: { id: payload.tenantId }, select: { name: true } }),
      );
      if (!tenant) throw INVALID();
      organizationName = tenant.name;
    }
    return {
      email: record.email,
      organizationName,
      kind: payload.kind,
      existingAccount: user.passwordHash !== null,
    };
  }

  async accept(token: string, input: { name?: string; password: string }): Promise<void> {
    const { record, payload } = await this.validToken(token);
    const userId = record.userId!;
    const run = <T>(fn: (tx: DbTransaction) => Promise<T>) =>
      payload.kind === 'TENANT'
        ? withDbContext(this.db, { tenantId: payload.tenantId, userId }, fn)
        : this.platformDb.$transaction(fn);

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw INVALID();
    const credentials = await this.credentialUpdate(user, input);

    await run(async (tx) => {
      const now = new Date();
      // Re-check inside the transaction so a token cannot be used twice concurrently.
      const used = await tx.authToken.updateMany({
        where: { id: record.id, usedAt: null, revokedAt: null },
        data: { usedAt: now },
      });
      if (used.count !== 1) throw INVALID();

      await tx.user.update({
        where: { id: userId },
        data: {
          ...credentials,
          status: 'ACTIVE',
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      });

      if (payload.kind === 'TENANT') {
        const activated = await tx.tenantMembership.updateMany({
          where: { id: payload.membershipId, userId, status: 'INVITED' },
          data: { status: 'ACTIVE', acceptedAt: now },
        });
        if (activated.count !== 1) throw INVALID();
        await writeAudit(tx, {
          tenantId: payload.tenantId,
          actor: { type: 'USER', userId },
          action: 'user.joined',
          entityType: 'tenant_membership',
          entityId: payload.membershipId,
          summary: `${credentials.name ?? user.name} accepted the invitation`,
        });
      } else {
        const activated = await tx.platformMembership.updateMany({
          where: { id: payload.membershipId, userId, status: 'INVITED' },
          data: { status: 'ACTIVE' },
        });
        if (activated.count !== 1) throw INVALID();
        await writeAudit(tx, {
          tenantId: null,
          actor: { type: 'PLATFORM_ADMIN', userId },
          action: 'platform_user.joined',
          entityType: 'platform_membership',
          entityId: payload.membershipId,
          summary: `${credentials.name ?? user.name} activated their platform account`,
        });
      }
    });
  }

  /**
   * New users choose a password (policy-checked); existing users prove ownership by entering
   * their current password, so an invitation link alone cannot take over an account.
   */
  private async credentialUpdate(
    user: User,
    input: { name?: string; password: string },
  ): Promise<{ name?: string; passwordHash?: string; passwordChangedAt?: Date }> {
    if (user.passwordHash) {
      if (!(await this.hasher.verify(user.passwordHash, input.password))) {
        throw new ApiError('UNAUTHENTICATED', 'The password is incorrect');
      }
      return {};
    }
    const name = input.name ?? user.name;
    const violation = passwordPolicyViolation(input.password, { email: user.email, name });
    if (violation) {
      throw new ApiError('VALIDATION_FAILED', violation, {
        errors: [{ path: 'password', code: 'weak_password', message: violation }],
      });
    }
    return {
      name,
      passwordHash: await this.hasher.hash(input.password),
      passwordChangedAt: new Date(),
    };
  }
}
