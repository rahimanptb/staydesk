/**
 * The PostgreSQL SQLSTATE behind an error from Prisma, the driver adapter or `pg` itself, if
 * any. Prisma wraps driver errors (raw queries: P2010 with `meta.driverAdapterError`), so the
 * code is looked for in each known place.
 */
export function sqlStateOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
    cause?: { originalCode?: unknown; code?: unknown };
  };
  const fromAdapter = e.meta?.driverAdapterError?.cause?.originalCode ?? e.cause?.originalCode;
  if (typeof fromAdapter === 'string') return fromAdapter;
  // Prisma's own code for a write conflict or deadlock on model operations.
  if (e.code === 'P2034') return '40001';
  if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return undefined;
}

/** Deadlock, serialisation failure or lock timeout: the whole unit of work may be retried. */
export const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40P01', '40001', '55P03']);

export function isRetryableDbError(error: unknown): boolean {
  const state = sqlStateOf(error);
  return state !== undefined && RETRYABLE_SQLSTATES.has(state);
}
