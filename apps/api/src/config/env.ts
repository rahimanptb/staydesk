import { z } from 'zod';
import { envFields, parseEnv } from '@staydesk/config';

export const apiEnvSchema = z.object({
  NODE_ENV: envFields.nodeEnv,
  LOG_LEVEL: envFields.logLevel,
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: envFields.port.default(4000),
  DATABASE_URL: envFields.postgresUrl,
  /** Only behind a reverse proxy that sets X-Forwarded-* (Caddy / load balancer). */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  APP_VERSION: z.string().default('0.0.0-dev'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** DI token for the validated environment. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
