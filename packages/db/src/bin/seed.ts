import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createDbClient } from '../client.js';
import { seedCatalog } from '../seed/catalog.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  process.stderr.write('MIGRATE_DATABASE_URL is not set\n');
  process.exit(1);
}

const db = createDbClient({ connectionString: url, applicationName: 'staydesk-seed', max: 2 });
try {
  const result = await seedCatalog(db);
  process.stdout.write(
    `Seeded ${result.permissions} permissions and ${result.globalRoles} global roles\n`,
  );
} finally {
  await db.$disconnect();
}
