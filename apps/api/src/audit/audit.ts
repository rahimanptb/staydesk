import type { DbTransaction, Prisma } from '@staydesk/db';
import { requestMeta } from '../common/request-context.js';

export type AuditActorType = 'USER' | 'SYSTEM' | 'PLATFORM_ADMIN' | 'AGENT' | 'API_KEY';

export interface AuditActor {
  type: AuditActorType;
  userId?: string | null;
  agencyId?: string | null;
  supportGrantId?: string | null;
}

export interface AuditEntry {
  /** The tenant the record belongs to; null only for platform/agency-level actions. */
  tenantId: string | null;
  propertyId?: string | null;
  actor: AuditActor;
  /** Stable action key, e.g. "user.invited". */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Human-readable sentence shown in the audit log. */
  summary: string;
  before?: unknown;
  after?: unknown;
  bookingId?: string | null;
  roomTypeId?: string | null;
}

const SECRET_FIELD = /password|token|secret|hash|recovery/i;

/** Removes credentials from audit diffs; they must never be stored, even hashed. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_FIELD.test(k) ? '[redacted]' : redactSecrets(v),
      ]),
    );
  }
  return value;
}

const json = (value: unknown) =>
  value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(redactSecrets(value))) as Prisma.InputJsonValue);

/**
 * Appends an audit entry in the caller's transaction (BR-22): the change and its audit record
 * commit or roll back together. The database role cannot update or delete audit rows.
 */
export async function writeAudit(tx: DbTransaction, entry: AuditEntry): Promise<void> {
  const meta = requestMeta();
  const before = json(entry.before);
  const after = json(entry.after);
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      propertyId: entry.propertyId ?? null,
      actorType: entry.actor.type,
      actorUserId: entry.actor.userId ?? null,
      actorAgencyId: entry.actor.agencyId ?? null,
      supportGrantId: entry.actor.supportGrantId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      bookingId: entry.bookingId ?? null,
      roomTypeId: entry.roomTypeId ?? null,
      summary: entry.summary,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      requestId: meta?.requestId ?? null,
    },
  });
}
