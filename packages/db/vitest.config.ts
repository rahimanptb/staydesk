import { defineConfig } from 'vitest/config';

// Integration tests start PostgreSQL in Docker (Testcontainers); they need a running Docker engine.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
