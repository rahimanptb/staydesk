import type { DbTransaction, Prisma } from '@staydesk/db';
import { sha256, toBytes } from '../security/crypto.js';
import { ApiError } from './api-error.js';

/**
 * Idempotency-Key handling (docs/06 §1). The record is written in the same transaction as the
 * work, so it commits or rolls back with it: a failed attempt leaves nothing behind and may be
 * retried, and a duplicate sent while the original is running waits on the record's key, then
 * replays the stored response. Keys are scoped to the tenant and kept for 24 hours.
 */

const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;
const TTL_HOURS = 24;

export function idempotencyKeyFrom(header: string | undefined): string {
  if (!header) {
    throw new ApiError(
      'PRECONDITION_REQUIRED',
      'Send an Idempotency-Key header so the request can be retried safely',
    );
  }
  if (!KEY.test(header)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'Idempotency-Key must be 8–128 letters, digits or ._:- characters',
    );
  }
  return header;
}

/** Stable JSON: object keys sorted, so equal payloads hash equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface IdempotentResult<T> {
  body: T;
  /** True when this is a replay of an earlier, completed request. */
  replayed: boolean;
}

export async function withIdempotency<T>(
  tx: DbTransaction,
  input: { tenantId: string; userId: string; key: string; route: string; request: unknown },
  work: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const hash = toBytes(sha256(`${input.route}\n${canonical(input.request)}`));
  await tx.$executeRaw`
    DELETE FROM idempotency_record
    WHERE tenant_id = ${input.tenantId}::uuid AND key = ${input.key} AND expires_at < now()`;
  const inserted = await tx.$executeRaw`
    INSERT INTO idempotency_record (tenant_id, key, user_id, route, request_hash, status, expires_at)
    VALUES (${input.tenantId}::uuid, ${input.key}, ${input.userId}::uuid, ${input.route}, ${hash},
            'IN_PROGRESS', now() + make_interval(hours => ${TTL_HOURS}))
    ON CONFLICT (tenant_id, key) DO NOTHING`;

  if (inserted === 0) {
    const existing = await tx.idempotencyRecord.findUnique({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
    });
    if (!existing) {
      throw new ApiError('CONFLICT_RETRY', 'Please retry the request');
    }
    const sameRequest =
      existing.userId === input.userId &&
      existing.route === input.route &&
      Buffer.from(existing.requestHash).equals(Buffer.from(hash));
    if (!sameRequest) {
      throw new ApiError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
      );
    }
    if (existing.status !== 'DONE') {
      throw new ApiError('IDEMPOTENCY_IN_PROGRESS', 'The original request is still running');
    }
    return { body: existing.responseBody as T, replayed: true };
  }

  const body = await work();
  await tx.idempotencyRecord.update({
    where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
    data: {
      status: 'DONE',
      responseStatus: 201,
      responseBody: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
    },
  });
  return { body, replayed: false };
}
