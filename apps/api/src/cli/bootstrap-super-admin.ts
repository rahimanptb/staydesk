/**
 * Creates (or re-invites) a Super Admin and prints a one-time setup link.
 *
 *   pnpm --filter @staydesk/api bootstrap:super-admin --email you@example.com --name "Your Name"
 *
 * The person opens the link, chooses a password, then signs in on the admin portal and must
 * enrol two-factor authentication. No password ever passes through the command line.
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { emailSchema, personNameSchema } from '@staydesk/contracts';
import { envFields, parseEnv } from '@staydesk/config';
import { createDbClient } from '@staydesk/db';
import { bootstrapSuperAdmin } from '../platform/bootstrap-super-admin.js';

const env = parseEnv(
  z.object({ PLATFORM_DATABASE_URL: envFields.postgresUrl, ADMIN_ORIGIN: envFields.url }),
);
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const args = z.object({ email: emailSchema, name: personNameSchema }).safeParse(values);
if (!args.success) {
  process.stderr.write('Usage: bootstrap:super-admin --email you@example.com --name "Your Name"\n');
  process.exit(1);
}

const db = createDbClient({
  connectionString: env.PLATFORM_DATABASE_URL,
  max: 1,
  applicationName: 'staydesk-cli',
});
try {
  const token = await bootstrapSuperAdmin(db, args.data);
  process.stdout.write(
    `Super Admin invitation created for ${args.data.email}.\nOpen this link within 72 hours to choose a password:\n\n  ${env.ADMIN_ORIGIN}/invitation#${token}\n\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
