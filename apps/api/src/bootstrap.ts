import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { registerSecurityHeaders } from './common/http.js';

export const API_PREFIX = 'api/v1';

/** App-wide configuration shared by main.ts and the e2e tests, so tests run the real setup. */
export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  registerSecurityHeaders(app.getHttpAdapter().getInstance());
}

export const FASTIFY_OPTIONS = {
  bodyLimit: 1_048_576,
} as const;
