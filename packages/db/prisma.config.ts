import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The repository keeps a single .env at its root.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

/**
 * The Prisma CLI runs migrations as the schema owner (MIGRATE_DATABASE_URL).
 * Applications never use that role: they connect as sd_app / sd_worker / sd_platform.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? '',
  },
});
