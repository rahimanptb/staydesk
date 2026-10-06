import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import { FASTIFY_OPTIONS, configureApp } from './bootstrap.js';
import { LOG_REDACT_PATHS, generateRequestId } from './common/http.js';
import { PinoNestLogger } from './common/pino-nest-logger.js';
import { loadApiEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'api', version: env.APP_VERSION },
    redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
  });

  const adapter = new FastifyAdapter({
    ...FASTIFY_OPTIONS,
    loggerInstance: logger,
    genReqId: generateRequestId,
    trustProxy: env.TRUST_PROXY,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    logger: new PinoNestLogger(logger),
  });
  await configureApp(app);

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  logger.info({ port: env.API_PORT, host: env.API_HOST }, 'StayDesk API listening');
}

bootstrap().catch((error: unknown) => {
  // Boot failures (e.g. invalid environment) must be visible even before logging is set up.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
