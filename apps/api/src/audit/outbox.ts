import type { DbTransaction, Prisma } from '@staydesk/db';

export interface OutboxEventInput {
  tenantId: string | null;
  /** e.g. "user.invited", "tenant.created" (docs/05 §7). */
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Records a domain event in the caller's transaction (transactional outbox). The worker
 * delivers it at least once after commit; consumers deduplicate by event id.
 *
 * Uses createMany because it inserts without RETURNING: the API's database roles may append
 * outbox rows but not read them, and RETURNING would need read access.
 */
export async function writeOutbox(tx: DbTransaction, event: OutboxEventInput): Promise<void> {
  await tx.outboxEvent.createMany({
    data: {
      tenantId: event.tenantId,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
}
