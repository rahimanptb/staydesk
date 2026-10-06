import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PORTAL_CONTEXT, portalForHost, type PortalContext } from '@staydesk/contracts';
import { PERMISSIONS } from '@staydesk/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { safeEqual } from '../security/crypto.js';
import { CSRF_HEADER, sessionCookieName } from './auth.constants.js';
import { ACCESS_KEY, CONTEXT_KEY, type AccessRule } from './decorators.js';
import { PrincipalLoader } from './principal-loader.service.js';
import { SessionsService } from './sessions.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when the request comes from a page on the same origin (CSRF origin check, docs/10 §5). */
export function isSameOrigin(request: FastifyRequest): boolean {
  const expected = `${request.protocol}://${request.host}`;
  const origin = request.headers.origin;
  if (origin) return origin === expected;
  const referer = request.headers.referer;
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

/**
 * Global, deny-by-default authorization (docs/02 §6). Every route must declare an AccessRule;
 * undeclared routes are refused. Order: portal → origin → session → CSRF token → principal →
 * MFA → context → permissions → tenant suspension.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('AuthGuard');
  private readonly cookieName: string;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(PrincipalLoader) private readonly principals: PrincipalLoader,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.cookieName = sessionCookieName(env.COOKIE_SECURE);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, targets);
    const requiredContext = this.reflector.getAllAndOverride<PortalContext | undefined>(
      CONTEXT_KEY,
      targets,
    );
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    if (!rule) {
      this.logger.error(`Route ${request.method} ${request.url} has no access rule; refusing`);
      throw new ApiError('FORBIDDEN', 'This action is not available');
    }

    const portal = portalForHost(request.host);
    if (!portal) throw new ApiError('NOT_FOUND', 'No such resource');
    request.portal = portal;

    const unsafe = !SAFE_METHODS.has(request.method);
    if (unsafe && !isSameOrigin(request)) {
      throw new ApiError('CSRF_FAILED', 'This request did not come from the StayDesk app');
    }
    if (rule.level === 'PUBLIC') return true;

    const token = request.cookies?.[this.cookieName];
    if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in');
    const session = await this.sessions.resolve(token);
    if (!session || session.context !== PORTAL_CONTEXT[portal]) {
      void reply.clearCookie(this.cookieName, { path: '/' });
      throw new ApiError('UNAUTHENTICATED', 'Please sign in');
    }

    if (unsafe) {
      const presented = request.headers[CSRF_HEADER];
      if (
        typeof presented !== 'string' ||
        !safeEqual(presented, this.sessions.csrfToken(session.id))
      ) {
        throw new ApiError('CSRF_FAILED', 'Missing or invalid CSRF token');
      }
    }

    const principal = await this.principals.load(session);
    request.principal = principal;

    if (rule.level === 'SESSION') {
      if (principal.mfa !== 'NONE' && !rule.allowPendingMfa) {
        throw new ApiError('MFA_REQUIRED', 'Two-factor authentication is required', {
          meta: { mfa: principal.mfa },
        });
      }
      return true;
    }

    // CONTEXT level
    if (principal.mfa !== 'NONE') {
      throw new ApiError('MFA_REQUIRED', 'Two-factor authentication is required', {
        meta: { mfa: principal.mfa },
      });
    }
    if (!requiredContext || requiredContext !== principal.context) {
      throw new ApiError('NOT_FOUND', 'No such resource');
    }
    if (principal.context === 'TENANT' && !principal.tenantId) {
      throw new ApiError('CONTEXT_REQUIRED', 'Choose a hotel account first');
    }
    if (principal.context === 'AGENCY' && !principal.agencyId) {
      throw new ApiError('CONTEXT_REQUIRED', 'Choose an agency first');
    }
    for (const permission of rule.permissions) {
      const def = PERMISSIONS[permission];
      if (!principal.permissions.has(permission) || ('ownerOnly' in def && !principal.isOwner)) {
        throw new ApiError('FORBIDDEN', 'You do not have permission to do this');
      }
    }
    if (unsafe && principal.tenantStatus === 'SUSPENDED') {
      throw new ApiError(
        'TENANT_SUSPENDED',
        'This hotel account is suspended; changes are disabled',
      );
    }
    return true;
  }
}
