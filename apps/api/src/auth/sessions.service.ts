import { Inject, Injectable } from '@nestjs/common';
import type { PortalContext } from '@staydesk/contracts';
import type { DbClient, Session, User } from '@staydesk/db';
import { requestMeta } from '../common/request-context.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { DB_CLIENT } from '../database/database.module.js';
import { csrfTokenFor, randomToken, sha256, toBytes } from '../security/crypto.js';
import { SESSION_POLICY, SESSION_TOUCH_INTERVAL_MS } from './auth.constants.js';

export type SessionWithUser = Session & { user: User };

export interface NewSession {
  userId: string;
  context: PortalContext;
  tenantId?: string | null;
  agencyId?: string | null;
  mfaVerifiedAt?: Date | null;
}

export interface IssuedSession {
  /** Opaque token for the cookie; only its hash is stored. */
  token: string;
  session: Session;
}

/** Server-side sessions (docs/10 §2). */
@Injectable()
export class SessionsService {
  private readonly csrfSecret: Buffer;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.csrfSecret = Buffer.from(env.SESSION_SECRET);
  }

  async create(input: NewSession, now = new Date()): Promise<IssuedSession> {
    const token = randomToken(32);
    const policy = SESSION_POLICY[input.context];
    const meta = requestMeta();
    const session = await this.db.session.create({
      data: {
        userId: input.userId,
        tokenHash: toBytes(sha256(token)),
        context: input.context,
        tenantId: input.tenantId ?? null,
        agencyId: input.agencyId ?? null,
        mfaVerifiedAt: input.mfaVerifiedAt ?? null,
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + policy.idleMs),
        absoluteExpiresAt: new Date(now.getTime() + policy.absoluteMs),
      },
    });
    return { token, session };
  }

  /** The live session for a token, or null if unknown, revoked or expired. Touches idle expiry. */
  async resolve(token: string, now = new Date()): Promise<SessionWithUser | null> {
    if (token.length < 20 || token.length > 100) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: toBytes(sha256(token)) },
      include: { user: true },
    });
    if (!session || session.revokedAt) return null;
    if (session.absoluteExpiresAt <= now || session.idleExpiresAt <= now) return null;

    if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      const policy = SESSION_POLICY[session.context];
      const idleExpiresAt = new Date(
        Math.min(now.getTime() + policy.idleMs, session.absoluteExpiresAt.getTime()),
      );
      await this.db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, idleExpiresAt },
      });
      return { ...session, lastSeenAt: now, idleExpiresAt };
    }
    return session;
  }

  /**
   * Replaces a session with a new token, carrying its context over with `changes` applied.
   * Used whenever privileges change (MFA verified, tenant chosen) to prevent session fixation.
   */
  async rotate(
    session: Session,
    changes: Partial<Pick<NewSession, 'tenantId' | 'agencyId' | 'mfaVerifiedAt'>>,
  ): Promise<IssuedSession> {
    await this.revoke(session.id, 'rotated');
    return this.create({
      userId: session.userId,
      context: session.context,
      tenantId: changes.tenantId !== undefined ? changes.tenantId : session.tenantId,
      agencyId: changes.agencyId !== undefined ? changes.agencyId : session.agencyId,
      mfaVerifiedAt:
        changes.mfaVerifiedAt !== undefined ? changes.mfaVerifiedAt : session.mfaVerifiedAt,
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  /** Signs a user out everywhere (password change/reset, account disabled). */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return result.count;
  }

  /** Signs a user out of one tenant (membership suspended, revoked or changed — PE-4). */
  async revokeForTenantMember(userId: string, tenantId: string, reason: string): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  csrfToken(sessionId: string): string {
    return csrfTokenFor(this.csrfSecret, sessionId);
  }
}
