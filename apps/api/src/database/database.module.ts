import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDbClient, withDbContext, type DbClient, type DbTransaction } from '@staydesk/db';
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

/** Runs work inside the tenant's row-level-security context (docs/10 §4, layer 4). */
@Injectable()
export class TenantDb {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  run<T>(scope: TenantScope, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return withDbContext(
      this.db,
      { tenantId: scope.tenantId, ...(scope.userId ? { userId: scope.userId } : {}) },
      fn,
    );
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
