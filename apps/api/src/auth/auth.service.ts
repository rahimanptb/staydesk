import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { brand } from '@staydesk/config';
import {
  PORTAL_CONTEXT,
  type ContextOption,
  type LoginRequest,
  type Portal,
  type PortalContext,
  type SessionInfo,
  type TotpSetup,
} from '@staydesk/contracts';
import { passwordPolicyViolation } from '@staydesk/domain';
import { withDbContext, type DbClient } from '@staydesk/db';
import { ApiError } from '../common/api-error.js';
import { requestMeta } from '../common/request-context.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { DB_CLIENT, PLATFORM_DB } from '../database/database.module.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { passwordChangedEmail, passwordResetEmail } from '../mail/templates.js';
import { RATE_LIMITER, type RateLimiter } from '../ratelimit/rate-limiter.js';
import { SecretBox, hmacSha256, randomToken, sha256, toBytes } from '../security/crypto.js';
import { PasswordHasher } from '../security/password-hasher.js';
import { generateTotpSecret, base32Encode, otpauthUri, verifyTotp } from '../security/totp.js';
import {
  AUTH_RATE_LIMITS,
  LOCKOUT_DURATION_MS,
  LOCKOUT_THRESHOLD,
  PASSWORD_RESET_TTL_MS,
  RECOVERY_CODE_COUNT,
} from './auth.constants.js';
import type { Principal } from './principal.js';
import { PrincipalLoader } from './principal-loader.service.js';
import { SessionsService } from './sessions.service.js';

export interface SessionResult {
  /** New session token to set as the cookie. */
  token: string;
  info: SessionInfo;
}

const INVALID_CREDENTIALS = () => new ApiError('UNAUTHENTICATED', 'Email or password is incorrect');
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function recoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly secretBox: SecretBox;
  private readonly pepper: Buffer;

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(PLATFORM_DB) private readonly platformDb: DbClient,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(PrincipalLoader) private readonly principals: PrincipalLoader,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.secretBox = new SecretBox(Buffer.from(env.TOTP_ENCRYPTION_KEY, 'base64'));
    this.pepper = Buffer.from(env.PASSWORD_PEPPER);
  }

  private async limit(key: string, rule: { limit: number; windowSeconds: number }): Promise<void> {
    const result = await this.limiter.consume(key, rule.limit, rule.windowSeconds);
    if (!result.allowed) {
      this.logger.warn({ key: key.split(':').slice(0, 2).join(':') }, 'Rate limit hit');
      throw new ApiError('RATE_LIMITED', 'Too many attempts, please try again later', {
        meta: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }
  }

  private subjectKey(value: string): string {
    return hmacSha256(this.pepper, value).toString('hex').slice(0, 32);
  }

  // ───────────────────────────── Sign-in ─────────────────────────────

  async login(portal: Portal, input: LoginRequest): Promise<SessionResult> {
    const context = PORTAL_CONTEXT[portal];
    const ip = requestMeta()?.ip ?? 'unknown';
    await this.limit(`login:ip:${ip}`, AUTH_RATE_LIMITS.loginPerIp);
    await this.limit(
      `login:acct:${this.subjectKey(input.email)}`,
      AUTH_RATE_LIMITS.loginPerAccount,
    );

    const now = new Date();
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    if (
      !user ||
      !user.passwordHash ||
      user.status === 'DISABLED' ||
      user.status === 'INVITED' ||
      (user.lockedUntil && user.lockedUntil > now)
    ) {
      await this.hasher.verifyDummy(input.password);
      throw INVALID_CREDENTIALS();
    }

    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= LOCKOUT_THRESHOLD;
      await this.db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failures,
          ...(lock ? { lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MS) } : {}),
        },
      });
      this.logger.warn({ userId: user.id, locked: lock }, 'Failed sign-in');
      throw INVALID_CREDENTIALS();
    }

    await this.db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(this.hasher.needsRehash(user.passwordHash)
          ? { passwordHash: await this.hasher.hash(input.password) }
          : {}),
      },
    });

    const options = await this.contextOptions(context, user.id);
    if (context === 'PLATFORM') {
      const membership = await this.platformDb.platformMembership.findUnique({
        where: { userId: user.id },
      });
      if (!membership || membership.status !== 'ACTIVE') throw this.noAccess(portal);
    } else if (options.length === 0) {
      throw this.noAccess(portal);
    }

    const only = options.length === 1 ? options[0]!.id : null;
    const issued = await this.sessions.create({
      userId: user.id,
      context,
      tenantId: context === 'TENANT' ? only : null,
      agencyId: context === 'AGENCY' ? only : null,
    });
    this.logger.log({ userId: user.id, context }, 'Signed in');
    return this.result(issued.token, issued.session.id, options);
  }

  private noAccess(portal: Portal): ApiError {
    return new ApiError('FORBIDDEN', `Your account does not have access to the ${portal} portal`);
  }

  async selectContext(
    principal: Principal,
    input: { tenantId?: string; agencyId?: string },
  ): Promise<SessionResult> {
    const id =
      principal.context === 'TENANT'
        ? input.tenantId
        : principal.context === 'AGENCY'
          ? input.agencyId
          : undefined;
    if (!id) throw new ApiError('VALIDATION_FAILED', 'This portal has no account to choose');
    const options = await this.contextOptions(principal.context, principal.userId);
    if (!options.some((o) => o.id === id)) throw new ApiError('NOT_FOUND', 'No such account');

    const session = await this.db.session.findUniqueOrThrow({ where: { id: principal.sessionId } });
    const issued = await this.sessions.rotate(
      session,
      principal.context === 'TENANT' ? { tenantId: id } : { agencyId: id },
    );
    return this.result(issued.token, issued.session.id, options);
  }

  async logout(principal: Principal): Promise<void> {
    await this.sessions.revoke(principal.sessionId, 'signed out');
  }

  /** The tenants/agencies a user can work in on this portal. */
  async contextOptions(context: PortalContext, userId: string): Promise<ContextOption[]> {
    if (context === 'TENANT') {
      const memberships = await withDbContext(this.db, { userId }, (tx) =>
        tx.tenantMembership.findMany({
          where: { userId, status: 'ACTIVE', tenant: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
          include: { tenant: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      );
      return memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name, isOwner: m.isOwner }));
    }
    if (context === 'AGENCY') {
      const memberships = await withDbContext(this.db, { userId }, (tx) =>
        tx.agencyMembership.findMany({
          where: { userId, status: 'ACTIVE', agency: { status: 'ACTIVE' } },
          include: { agency: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      );
      return memberships.map((m) => ({ id: m.agency.id, name: m.agency.name }));
    }
    return [];
  }

  private async result(
    token: string,
    sessionId: string,
    options?: ContextOption[],
  ): Promise<SessionResult> {
    const session = await this.sessions.resolve(token);
    if (!session || session.id !== sessionId)
      throw new ApiError('INTERNAL_ERROR', 'Session not found');
    const principal = await this.principals.load(session);
    return { token, info: await this.info(principal, options) };
  }

  async info(principal: Principal, knownOptions?: ContextOption[]): Promise<SessionInfo> {
    const options =
      knownOptions ?? (await this.contextOptions(principal.context, principal.userId));
    const selectedId = principal.tenantId ?? principal.agencyId;
    const current: ContextOption | null =
      principal.context === 'PLATFORM'
        ? { id: 'platform', name: `${brand.productName} platform` }
        : (options.find((o) => o.id === selectedId) ?? null);
    return {
      user: { id: principal.userId, name: principal.name, email: principal.email },
      context: principal.context,
      current,
      options,
      mfa: principal.mfa,
      permissions: [...principal.permissions].sort(),
      csrfToken: this.sessions.csrfToken(principal.sessionId),
    };
  }

  // ─────────────────────────── Two-factor ───────────────────────────

  async totpSetup(principal: Principal): Promise<TotpSetup> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (user.totpEnabledAt)
      throw new ApiError('ALREADY_EXISTS', 'Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.db.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: toBytes(this.secretBox.seal(secret)), totpLastStep: null },
    });
    return {
      secret: base32Encode(secret),
      otpauthUri: otpauthUri(secret, user.email, brand.productName),
    };
  }

  async totpEnable(
    principal: Principal,
    code: string,
  ): Promise<{ result: SessionResult; recoveryCodes: string[] }> {
    await this.limit(`mfa:${principal.sessionId}`, AUTH_RATE_LIMITS.mfaPerSession);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (user.totpEnabledAt)
      throw new ApiError('ALREADY_EXISTS', 'Two-factor authentication is already enabled');
    if (!user.totpSecretEnc)
      throw new ApiError('VALIDATION_FAILED', 'Start two-factor setup first');
    const secret = this.secretBox.open(Buffer.from(user.totpSecretEnc));
    const step = verifyTotp(secret, code, Date.now(), null);
    if (step === null)
      throw new ApiError(
        'VALIDATION_FAILED',
        'That code is not valid; check your device time and try again',
      );

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    const now = new Date();
    await this.db.$transaction([
      this.db.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: now, totpLastStep: step },
      }),
      this.db.recoveryCode.deleteMany({ where: { userId: user.id } }),
      this.db.recoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: this.recoveryHash(c) })),
      }),
    ]);
    const result = await this.rotateVerified(principal, now);
    return { result, recoveryCodes };
  }

  async mfaVerify(
    principal: Principal,
    input: { code?: string; recoveryCode?: string },
  ): Promise<SessionResult> {
    await this.limit(`mfa:${principal.sessionId}`, AUTH_RATE_LIMITS.mfaPerSession);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!user.totpEnabledAt || !user.totpSecretEnc) {
      throw new ApiError('VALIDATION_FAILED', 'Two-factor authentication is not set up');
    }
    const invalid = () => new ApiError('UNAUTHENTICATED', 'That code is not valid');

    if (input.code) {
      const secret = this.secretBox.open(Buffer.from(user.totpSecretEnc));
      const step = verifyTotp(secret, input.code, Date.now(), user.totpLastStep);
      if (step === null) throw invalid();
      // Conditional update: a concurrent request with the same code cannot also succeed.
      const updated = await this.db.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      if (updated.count !== 1) throw invalid();
    } else if (input.recoveryCode) {
      const used = await this.db.recoveryCode.updateMany({
        where: { userId: user.id, codeHash: this.recoveryHash(input.recoveryCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw invalid();
    }
    return this.rotateVerified(principal, new Date());
  }

  private recoveryHash(code: string): string {
    return hmacSha256(this.pepper, `recovery:${code.toUpperCase()}`).toString('hex');
  }

  private async rotateVerified(principal: Principal, at: Date): Promise<SessionResult> {
    const session = await this.db.session.findUniqueOrThrow({ where: { id: principal.sessionId } });
    const issued = await this.sessions.rotate(session, { mfaVerifiedAt: at });
    return this.result(issued.token, issued.session.id);
  }

  // ─────────────────────────── Passwords ───────────────────────────

  /** Always succeeds from the caller's view, so it cannot reveal which emails have accounts. */
  async forgotPassword(portal: Portal, email: string): Promise<void> {
    const ip = requestMeta()?.ip ?? 'unknown';
    await this.limit(`forgot:ip:${ip}`, AUTH_RATE_LIMITS.forgotPerIp);
    const perEmail = await this.limiter.consume(
      `forgot:acct:${this.subjectKey(email)}`,
      AUTH_RATE_LIMITS.forgotPerEmail.limit,
      AUTH_RATE_LIMITS.forgotPerEmail.windowSeconds,
    );
    if (!perEmail.allowed) return;

    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.status !== 'ACTIVE') return;

    const now = new Date();
    const token = randomToken(32);
    await this.db.$transaction([
      this.db.authToken.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.db.authToken.create({
        data: {
          userId: user.id,
          email: user.email,
          purpose: 'PASSWORD_RESET',
          tokenHash: toBytes(sha256(token)),
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        },
      }),
    ]);
    const origin = {
      hotel: this.env.HOTEL_ORIGIN,
      agent: this.env.AGENT_ORIGIN,
      admin: this.env.ADMIN_ORIGIN,
    }[portal];
    try {
      await this.mailer.send({
        to: user.email,
        ...passwordResetEmail({
          url: `${origin}/reset-password#${token}`,
          expiresInMinutes: PASSWORD_RESET_TTL_MS / 60_000,
        }),
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to send password reset email');
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const ip = requestMeta()?.ip ?? 'unknown';
    await this.limit(`token:ip:${ip}`, AUTH_RATE_LIMITS.tokenPerIp);
    const record = await this.db.authToken.findUnique({
      where: { tokenHash: toBytes(sha256(token)) },
    });
    const now = new Date();
    if (
      !record ||
      record.purpose !== 'PASSWORD_RESET' ||
      record.usedAt ||
      record.revokedAt ||
      record.expiresAt <= now ||
      !record.userId
    ) {
      throw new ApiError('NOT_FOUND', 'This reset link is no longer valid; request a new one');
    }
    const user = await this.db.user.findUniqueOrThrow({ where: { id: record.userId } });
    const violation = passwordPolicyViolation(password, { email: user.email, name: user.name });
    if (violation) {
      throw new ApiError('VALIDATION_FAILED', violation, {
        errors: [{ path: 'password', code: 'weak_password', message: violation }],
      });
    }
    const passwordHash = await this.hasher.hash(password);
    await this.db.$transaction(async (tx) => {
      const used = await tx.authToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (used.count !== 1) throw new ApiError('NOT_FOUND', 'This reset link is no longer valid');
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
      });
    });
    await this.sessions.revokeAllForUser(user.id, 'password reset');
    this.logger.log({ userId: user.id }, 'Password reset');
    try {
      await this.mailer.send({ to: user.email, ...passwordChangedEmail() });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to send password changed email');
    }
  }
}
