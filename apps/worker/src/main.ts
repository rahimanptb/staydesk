import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { pino } from 'pino';
import { loadWorkerEnv } from './env.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'worker', version: env.APP_VERSION },
  });

  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    logger: {
      log: (message: unknown, context?: string) => logger.info({ context }, String(message)),
      error: (message: unknown, trace?: string, context?: string) =>
        logger.error({ context, trace }, String(message)),
      warn: (message: unknown, context?: string) => logger.warn({ context }, String(message)),
      debug: (message: unknown, context?: string) => logger.debug({ context }, String(message)),
      verbose: (message: unknown, context?: string) => logger.trace({ context }, String(message)),
    },
  });
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
