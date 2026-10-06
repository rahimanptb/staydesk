import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const rolesScript = fileURLToPath(
  new URL('../../../infra/postgres/init/01-roles.sh', import.meta.url),
);
const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));

/** Throwaway credentials for the disposable test container only. */
const PASSWORDS = {
  sd_owner: 'owner_test',
  sd_app: 'app_test',
  sd_worker: 'worker_test',
  sd_platform: 'platform_test',
  sd_readonly: 'readonly_test',
} as const;

export type DbRole = keyof typeof PASSWORDS;

export interface TestDatabase {
  connect(role: DbRole): Promise<pg.Client>;
  /** Runs the Prisma CLI against this database as the schema owner. */
  prisma(args: string[]): { status: number | null; output: string };
  stop(): Promise<void>;
}

/**
 * Starts PostgreSQL 16 in Docker, initialises it with the same role script used locally and on
 * servers, and applies every migration. The result mirrors production's database layout.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('postgres')
    .withPassword('postgres_test')
    .withDatabase('postgres')
    .withEnvironment({
      STAYDESK_DB: 'staydesk',
      SD_OWNER_PASSWORD: PASSWORDS.sd_owner,
      SD_APP_PASSWORD: PASSWORDS.sd_app,
      SD_WORKER_PASSWORD: PASSWORDS.sd_worker,
      SD_PLATFORM_PASSWORD: PASSWORDS.sd_platform,
      SD_READONLY_PASSWORD: PASSWORDS.sd_readonly,
    })
    .withCopyFilesToContainer([
      { source: rolesScript, target: '/docker-entrypoint-initdb.d/01-roles.sh', mode: 0o755 },
    ])
    .start();

  const url = (role: DbRole) =>
    `postgresql://${role}:${PASSWORDS[role]}@${container.getHost()}:${container.getPort()}/staydesk`;

  const prisma = (args: string[]) => {
    const run = spawnSync(process.execPath, [prismaCli, ...args], {
      cwd: packageDir,
      env: { ...process.env, MIGRATE_DATABASE_URL: url('sd_owner') },
      encoding: 'utf8',
    });
    return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
  };

  const migrate = prisma(['migrate', 'deploy']);
  if (migrate.status !== 0) {
    await container.stop();
    throw new Error(`prisma migrate deploy failed:\n${migrate.output}`);
  }

  const clients: pg.Client[] = [];
  return {
    prisma,
    async connect(role) {
      const client = new pg.Client({ connectionString: url(role) });
      await client.connect();
      clients.push(client);
      return client;
    },
    async stop() {
      await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
      await container.stop();
    },
  };
}

/** Runs `fn` in a rolled-back transaction with the RLS context set, like `withDbContext`. */
export async function inContext<T>(
  client: pg.Client,
  context: { tenantId?: string; agencyId?: string; userId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.agency_id', $2, true),
              set_config('app.user_id', $3, true)`,
      [context.tenantId ?? '', context.agencyId ?? '', context.userId ?? ''],
    );
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** The PostgreSQL error code a promise rejects with (e.g. 42501 insufficient_privilege). */
export async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
