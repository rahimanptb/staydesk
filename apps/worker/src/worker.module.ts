import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDbClient, type DbClient } from '@staydesk/db';
import { WORKER_ENV, type WorkerEnv } from './env.js';

/** DI token for the sd_worker Prisma client. */
export const WORKER_DB = Symbol('WORKER_DB');

/**
 * Keeps the process observable until real jobs are registered (outbox dispatcher, hold expiry,
 * reconciliation — docs/05 §6).
 */
@Injectable()
class Heartbeat implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Heartbeat');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_DB) private readonly db: DbClient,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log('Worker started');
    this.timer = setInterval(
      () => this.logger.debug('Worker alive'),
      this.env.HEARTBEAT_SECONDS * 1000,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.db.$disconnect();
    this.logger.log('Worker stopped');
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        {
          provide: WORKER_DB,
          useFactory: (): DbClient =>
            createDbClient({
              connectionString: env.WORKER_DATABASE_URL,
              applicationName: 'staydesk-worker',
            }),
        },
        Heartbeat,
      ],
    };
  }
}
