import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { HealthResponse } from '@staydesk/contracts';
import type { DbClient } from '@staydesk/db';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { DB_CLIENT } from '../database/database.module.js';

const DB_CHECK_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Liveness: the process is up. No dependencies, so restarts aren't triggered by a DB outage. */
  @Get('live')
  live(): HealthResponse {
    return { status: 'ok', version: this.env.APP_VERSION, checks: {} };
  }

  /** Readiness: can serve traffic. Returns 503 when the database is unreachable. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const database = await this.checkDatabase();
    if (database === 'fail') void reply.status(503);
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      version: this.env.APP_VERSION,
      checks: { database },
    };
  }

  private async checkDatabase(): Promise<'ok' | 'fail'> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.db.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('database check timed out')),
            DB_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return 'ok';
    } catch {
      return 'fail';
    } finally {
      clearTimeout(timer);
    }
  }
}
