import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDbClient, type DbClient } from '@staydesk/db';
import { API_ENV, type ApiEnv } from '../config/env.js';

/** DI token for the sd_app Prisma client. */
export const DB_CLIENT = Symbol('DB_CLIENT');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
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
    DatabaseLifecycle,
  ],
  exports: [DB_CLIENT],
})
export class DatabaseModule {}
