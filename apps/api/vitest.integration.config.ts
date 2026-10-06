import { defineConfig } from 'vitest/config';

// End-to-end tests against PostgreSQL in Docker (Testcontainers); needs a running Docker engine.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
