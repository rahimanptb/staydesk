import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createDbClient,
  isRetryableDbError,
  withDbContext,
  type DbClient,
  type DbTransaction,
} from '@staydesk/db';
import { ApiError } from '../common/api-error.js';
import { API_ENV, type ApiEnv } from '../config/env.js';

/** DI token for the sd_app Prisma client (tenant/agency contexts; RLS applies). */
export const DB_CLIENT = Symbol('DB_CLIENT');
/** DI token for the sd_platform Prisma client (platform administration only). */
export const PLATFORM_DB = Symbol('PLATFORM_DB');

/** What tenant-context work is scoped to; normally taken from the request's principal. */
export interface TenantScope {
  tenantId: string;
  userId?: string | null;
}

/** Retries after the first attempt for deadlocks / lock timeouts (docs/08 §5). */
const LOCK_RETRIES = 3;

/** Runs work inside the tenant's row-level-security context (docs/10 §4, layer 4). */
@Injectable()
export class TenantDb {
  private readonly logger = new Logger('TenantDb');

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  run<T>(scope: TenantScope, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return withDbContext(
      this.db,
      { tenantId: scope.tenantId, ...(scope.userId ? { userId: scope.userId } : {}) },
      fn,
    );
  }

  /**
   * For units of work that lock inventory: bounded lock waits, and the whole unit retried with
   * jittered backoff on deadlock, serialisation failure or lock timeout. After the retries the
   * caller gets CONFLICT_RETRY (503), which is safe to retry with the same Idempotency-Key.
   */
  async runLocked<T>(scope: TenantScope, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.run(scope, async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true),
                                      set_config('statement_timeout', '10s', true)`;
          return fn(tx);
        });
      } catch (error) {
        if (!isRetryableDbError(error)) throw error;
        if (attempt >= LOCK_RETRIES) {
          throw new ApiError(
            'CONFLICT_RETRY',
            'Inventory is busy right now; please try again in a moment',
          );
        }
        // Contention signal for operations: frequent retries mean hot inventory rows.
        this.logger.warn(`Inventory lock conflict, retrying (attempt ${attempt + 1})`);
        await sleep(50 + Math.floor(Math.random() * 350));
      }
    }
  }
}

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(PLATFORM_DB) private readonly platformDb: DbClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.db.$disconnect(), this.platformDb.$disconnect()]);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB_CLIENT,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): DbClient =>
        createDbClient({ connectionString: env.DATABASE_URL, applicationName: 'staydesk-api' }),
    },
    {
      provide: PLATFORM_DB,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): DbClient =>
        createDbClient({
          connectionString: env.PLATFORM_DATABASE_URL,
          applicationName: 'staydesk-api-platform',
          max: 5,
        }),
    },
    TenantDb,
    DatabaseLifecycle,
  ],
  exports: [DB_CLIENT, PLATFORM_DB, TenantDb],
})
export class DatabaseModule {}
