import { z } from 'zod';
import { envFields, parseEnv } from '@staydesk/config';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

export const apiEnvSchema = z.object({
  NODE_ENV: envFields.nodeEnv,
  LOG_LEVEL: envFields.logLevel,
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: envFields.port.default(4000),
  APP_VERSION: z.string().default('0.0.0-dev'),

  /** sd_app: tenant and agency contexts, row-level security applies. */
  DATABASE_URL: envFields.postgresUrl,
  /** sd_platform: platform administration only; no access to operational tables. */
  PLATFORM_DATABASE_URL: envFields.postgresUrl,
  REDIS_URL: envFields.redisUrl,

  /**
   * Which proxies to trust for X-Forwarded-*: "loopback" (Next dev server / local Caddy),
   * a comma-separated list of addresses/CIDRs, "true" or "false".
   */
  TRUST_PROXY: z
    .string()
    .default('loopback')
    .transform((v): boolean | string => (v === 'true' ? true : v === 'false' ? false : v)),

  SESSION_SECRET: envFields.secret,
  PASSWORD_PEPPER: envFields.secret,
  TOTP_ENCRYPTION_KEY: base64Key32,
  /** Secure cookies (`__Host-` prefix). Only disable for plain-HTTP local development. */
  COOKIE_SECURE: bool('true'),

  /** Public origins of each portal, used in email links. */
  HOTEL_ORIGIN: envFields.url,
  AGENT_ORIGIN: envFields.url,
  ADMIN_ORIGIN: envFields.url,

  SMTP_URL: z.string().regex(/^smtps?:\/\//, 'must be an smtp:// or smtps:// URL'),
  MAIL_FROM: z.string().default('StayDesk <no-reply@staydesk.local>'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** DI token for the validated environment. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
