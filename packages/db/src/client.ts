import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface DbClientOptions {
  connectionString: string;
  /** Pool size per process. */
  max?: number;
  applicationName?: string;
}

/**
 * Creates a Prisma client over node-postgres. Each process creates exactly one per database
 * role it uses (sd_app, sd_worker, sd_platform) and shares it.
 */
export function createDbClient(options: DbClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'staydesk',
  });
  return new PrismaClient({ adapter });
}

export type DbClient = PrismaClient;
export type DbTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Who the current database work is for. Drives row-level security (docs/10 §4, layer 4). */
export interface DbContext {
  tenantId?: string;
  agencyId?: string;
  userId?: string;
}

/**
 * Runs `fn` in a transaction with the RLS context set (transaction-local, so it is safe with
 * pooled connections). All tenant/agency-scoped database access goes through this function.
 */
export async function withDbContext<T>(
  db: PrismaClient,
  context: DbContext,
  fn: (tx: DbTransaction) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.tenant_id', ${context.tenantId ?? ''}, true),
        set_config('app.agency_id', ${context.agencyId ?? ''}, true),
        set_config('app.user_id', ${context.userId ?? ''}, true)`;
      return fn(tx);
    },
    // Under bursts, wait for a pooled connection rather than failing after Prisma's 2 s default.
    { timeout: options.timeoutMs ?? 10_000, maxWait: 10_000 },
  );
}

/** Shorthand for the common tenant-only context. */
export function withTenant<T>(
  db: PrismaClient,
  tenantId: string,
  fn: (tx: DbTransaction) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return withDbContext(db, { tenantId }, fn, options);
}
