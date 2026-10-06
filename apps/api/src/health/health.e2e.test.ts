import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { FASTIFY_OPTIONS, configureApp } from '../bootstrap.js';
import { generateRequestId } from '../common/http.js';
import { loadApiEnv } from '../config/env.js';
import { DB_CLIENT } from '../database/database.module.js';

const env = loadApiEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  PLATFORM_DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  REDIS_URL: 'redis://unused.invalid:6379',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  PASSWORD_PEPPER: 'test-password-pepper-0123456789abcd',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  HOTEL_ORIGIN: 'http://app.localhost:3000',
  AGENT_ORIGIN: 'http://agent.localhost:3000',
  ADMIN_ORIGIN: 'http://admin.localhost:3000',
  SMTP_URL: 'smtp://unused.invalid:25',
  APP_VERSION: '1.2.3-test',
});

let app: NestFastifyApplication | undefined;

async function startApp(dbHealthy: boolean): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DB_CLIENT)
    .useValue({
      $queryRaw: () =>
        dbHealthy ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('down')),
      $disconnect: () => Promise.resolve(),
    })
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ ...FASTIFY_OPTIONS, genReqId: generateRequestId }),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health endpoints', () => {
  it('reports liveness with security headers and a request id', async () => {
    const server = await startApp(true);
    const res = await server.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: '1.2.3-test', checks: {} });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reports readiness based on the database', async () => {
    const healthy = await startApp(true);
    expect(
      (await healthy.inject({ method: 'GET', url: '/api/v1/health/ready' })).json(),
    ).toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
    });
    await healthy.close();

    const unhealthy = await startApp(false);
    const res = await unhealthy.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { database: 'fail' } });
  });

  it('answers unknown routes with problem+json and echoes a valid request id', async () => {
    const server = await startApp(true);
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/does-not-exist',
      headers: { host: 'app.localhost:3000', 'x-request-id': 'trace-abc-12345' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND', requestId: 'trace-abc-12345' });
  });
});
