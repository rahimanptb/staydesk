import { z } from 'zod';
import { envFields, parseEnv } from '@staydesk/config';

export const workerEnvSchema = z.object({
  NODE_ENV: envFields.nodeEnv,
  LOG_LEVEL: envFields.logLevel,
  WORKER_DATABASE_URL: envFields.postgresUrl,
  REDIS_URL: envFields.redisUrl,
  /** Cron (UTC) for rolling each property's inventory horizon forward (docs/08 §14). */
  INVENTORY_HORIZON_CRON: z.string().default('15 * * * *'),
  /** Cron (UTC) for the nightly inventory reconciliation (docs/08 §12). */
  INVENTORY_RECONCILE_CRON: z.string().default('30 21 * * *'),
  APP_VERSION: z.string().default('0.0.0-dev'),
  /** How often the worker logs that it is alive. */
  HEARTBEAT_SECONDS: z.coerce.number().int().min(5).default(60),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const WORKER_ENV = Symbol('WORKER_ENV');

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}
