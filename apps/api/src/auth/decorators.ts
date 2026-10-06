import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PortalContext } from '@staydesk/contracts';
import type { PermissionKey } from '@staydesk/domain';
import type { FastifyRequest } from 'fastify';
import type { Principal } from './principal.js';

export const ACCESS_KEY = 'staydesk:access';
export const CONTEXT_KEY = 'staydesk:context';

export type AccessRule =
  /** No session needed (sign-in, password reset, health). CSRF origin checks still apply. */
  | { level: 'PUBLIC' }
  /** A valid session on this portal, even before MFA/context selection when allowed. */
  | { level: 'SESSION'; allowPendingMfa: boolean }
  /** A fully established session in the controller's context, holding all permissions. */
  | { level: 'CONTEXT'; permissions: readonly PermissionKey[] };

export const Public = () => SetMetadata(ACCESS_KEY, { level: 'PUBLIC' } satisfies AccessRule);

export const SessionOnly = (options: { allowPendingMfa?: boolean } = {}) =>
  SetMetadata(ACCESS_KEY, {
    level: 'SESSION',
    allowPendingMfa: options.allowPendingMfa ?? false,
  } satisfies AccessRule);

/** Requires every listed permission. With no arguments: any signed-in member of the context. */
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(ACCESS_KEY, { level: 'CONTEXT', permissions } satisfies AccessRule);

/** Which session context a controller serves (TENANT / AGENCY / PLATFORM). */
export const ForContext = (context: PortalContext) => SetMetadata(CONTEXT_KEY, context);

/** The authenticated principal (set by AuthGuard). */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<FastifyRequest>().principal;
    if (!principal) throw new Error('CurrentPrincipal used on a route without authentication');
    return principal;
  },
);
