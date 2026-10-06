import type { MfaState, Portal, PortalContext } from '@staydesk/contracts';
import type { PermissionKey } from '@staydesk/domain';

/** Who is making the request and what they may do. Built fresh for every request. */
export interface Principal {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  context: PortalContext;
  tenantId: string | null;
  agencyId: string | null;
  membershipId: string | null;
  isOwner: boolean;
  roleKey: string | null;
  permissions: ReadonlySet<PermissionKey>;
  allProperties: boolean;
  propertyIds: readonly string[];
  tenantStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | null;
  mfa: MfaState;
  supportGrantId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    portal?: Portal;
  }
}
