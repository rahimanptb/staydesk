import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDbClient, type DbClient } from '@staydesk/db';
import { startTestDatabase, type TestDatabase } from '@staydesk/db/testing';
import { AppModule } from '../../src/app.module.js';
import { FASTIFY_OPTIONS, configureApp } from '../../src/bootstrap.js';
import { generateRequestId } from '../../src/common/http.js';
import { loadApiEnv } from '../../src/config/env.js';
import { MAILER, MemoryMailer } from '../../src/mail/mailer.js';
import { MemoryRateLimiter, RATE_LIMITER } from '../../src/ratelimit/rate-limiter.js';
import { PasswordHasher } from '../../src/security/password-hasher.js';

export const HOSTS = {
  hotel: 'app.localhost:3000',
  agent: 'agent.localhost:3000',
  admin: 'admin.localhost:3000',
} as const;

export interface Harness {
  app: NestFastifyApplication;
  database: TestDatabase;
  platformDb: DbClient;
  mailer: MemoryMailer;
  clock: { now: number };
  stop(): Promise<void>;
}

/** Boots the real API (all modules, guard, filters) against a throwaway PostgreSQL. */
export async function startHarness(): Promise<Harness> {
  const database = await startTestDatabase();
  const env = loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: database.url('sd_app'),
    PLATFORM_DATABASE_URL: database.url('sd_platform'),
    REDIS_URL: 'redis://unused.invalid:6379',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    PASSWORD_PEPPER: 'test-password-pepper-0123456789abcd',
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    COOKIE_SECURE: 'false',
    TRUST_PROXY: 'false',
    HOTEL_ORIGIN: `http://${HOSTS.hotel}`,
    AGENT_ORIGIN: `http://${HOSTS.agent}`,
    ADMIN_ORIGIN: `http://${HOSTS.admin}`,
    SMTP_URL: 'smtp://unused.invalid:25',
  });
  const mailer = new MemoryMailer();
  const clock = { now: Date.now() };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(RATE_LIMITER)
    .useValue(new MemoryRateLimiter(() => clock.now))
    .overrideProvider(PasswordHasher)
    .useValue(
      new PasswordHasher(Buffer.from(env.PASSWORD_PEPPER), {
        memory: 1024,
        passes: 1,
        parallelism: 1,
      }),
    )
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({
      ...FASTIFY_OPTIONS,
      genReqId: generateRequestId,
      // Set TEST_LOG=1 to see server-side errors while debugging a failing test.
      logger: process.env.TEST_LOG ? { level: 'error' } : false,
    }),
    { logger: ['error'] },
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const platformDb = createDbClient({ connectionString: database.url('sd_platform'), max: 2 });

  return {
    app,
    database,
    platformDb,
    mailer,
    clock,
    async stop() {
      await app.close();
      await platformDb.$disconnect();
      await database.stop();
    },
  };
}

export interface ApiResponse {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

/**
 * A browser on one portal host: keeps the session cookie and CSRF token like the web app does,
 * and sends same-origin Origin headers on unsafe requests.
 */
export class Browser {
  private cookie: string | undefined;
  csrfToken: string | undefined;

  constructor(
    private readonly harness: Harness,
    readonly host: string,
  ) {}

  /** Low-level request with full header control (for attack tests). */
  async raw(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: { body?: unknown; headers?: Record<string, string>; cookie?: string | null } = {},
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { host: this.host, ...options.headers };
    const cookie = options.cookie === undefined ? this.cookie : options.cookie;
    if (cookie) headers.cookie = cookie;
    const res = await this.harness.app.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
    const setCookie = res.headers['set-cookie'];
    for (const line of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair] = String(line).split(';');
      const [name, value] = pair!.split('=');
      if (name === 'sd_session') this.cookie = value ? `${name}=${value}` : undefined;
    }
    const body = res.body ? safeJson(res.body) : undefined;
    if (body && typeof body === 'object' && typeof body.csrfToken === 'string')
      this.csrfToken = body.csrfToken;
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown> };
  }

  request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { ...extraHeaders };
    if (method !== 'GET') {
      headers.origin = `http://${this.host}`;
      if (this.csrfToken) headers['x-csrf-token'] = this.csrfToken;
    }
    return this.raw(method, path, { body, headers });
  }

  get(path: string) {
    return this.request('GET', path);
  }

  post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return this.request('POST', path, body, headers);
  }

  patch(path: string, body: unknown) {
    return this.request('PATCH', path, body);
  }

  put(path: string, body: unknown) {
    return this.request('PUT', path, body);
  }

  get sessionCookie(): string | undefined {
    return this.cookie;
  }

  async login(email: string, password: string): Promise<ApiResponse> {
    return this.post('/auth/login', { email, password });
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The token from the most recent invitation/reset link emailed to `to`. */
export function tokenFromMail(mailer: MemoryMailer, to: string): string {
  const message = mailer.lastTo(to);
  const match = message?.text.match(/#([A-Za-z0-9_-]{30,})/);
  if (!match) throw new Error(`No tokenised link emailed to ${to}`);
  return match[1]!;
}
