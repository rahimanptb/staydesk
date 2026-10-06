import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  inventoryTargets,
  rollInventoryHorizon,
  runReconciliation,
  type DbClient,
} from '@staydesk/db';
import { WORKER_ENV, type WorkerEnv } from '../env.js';
import { WORKER_DB } from '../tokens.js';

const QUEUE = 'inventory';
export const HORIZON_JOB = 'inventory.horizon';
export const RECONCILE_JOB = 'inventory.reconcile';

/**
 * Scheduled inventory jobs (docs/05 §6). BullMQ job schedulers make each run happen once across
 * all worker instances; a failing property is logged and does not stop the others.
 */
@Injectable()
export class InventoryJobs implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('InventoryJobs');
  private connection: Redis | undefined;
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_DB) private readonly db: DbClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // BullMQ workers block on Redis and need unlimited retries per request.
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
    await this.queue.upsertJobScheduler(
      HORIZON_JOB,
      { pattern: this.env.INVENTORY_HORIZON_CRON, tz: 'UTC' },
      { name: HORIZON_JOB, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    await this.queue.upsertJobScheduler(
      RECONCILE_JOB,
      { pattern: this.env.INVENTORY_RECONCILE_CRON, tz: 'UTC' },
      { name: RECONCILE_JOB, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    this.worker = new Worker(QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name ?? '?'} failed: ${error.message}`),
    );
    this.logger.log('Inventory jobs scheduled');
  }

  async process(job: Job): Promise<{ properties: number; failed: number; detail: number }> {
    const targets = await inventoryTargets(this.db);
    let failed = 0;
    let detail = 0;
    for (const target of targets) {
      try {
        if (job.name === HORIZON_JOB) {
          detail += await rollInventoryHorizon(this.db, target);
        } else if (job.name === RECONCILE_JOB) {
          const run = await runReconciliation(this.db, target, { trigger: 'SCHEDULED' });
          if (run.mismatchCount > 0) {
            detail += run.mismatchCount;
            this.logger.error(
              `INCIDENT: inventory reconciliation found ${run.mismatchCount} mismatch(es) for property ${target.propertyId} (run ${run.id})`,
            );
          }
        }
      } catch (error) {
        failed++;
        this.logger.error(
          `${job.name} failed for property ${target.propertyId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(
      `${job.name}: ${targets.length} properties, ${failed} failed, ${
        job.name === HORIZON_JOB ? `${detail} rows created` : `${detail} mismatches`
      }`,
    );
    if (failed > 0) throw new Error(`${failed} of ${targets.length} properties failed`);
    return { properties: targets.length, failed, detail };
  }

  /** Before the database disconnects: lets a running job finish. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
