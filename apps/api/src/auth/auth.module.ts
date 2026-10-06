import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { MAILER, SmtpMailer } from '../mail/mailer.js';
import { RATE_LIMITER, RedisRateLimiter } from '../ratelimit/rate-limiter.js';
import { PasswordHasher } from '../security/password-hasher.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { InvitationsService } from './invitations.service.js';
import { PrincipalLoader } from './principal-loader.service.js';
import { SessionsService } from './sessions.service.js';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end' && this.redis.status !== 'wait') await this.redis.quit();
  }
}

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: REDIS,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
        }),
    },
    RedisLifecycle,
    {
      provide: RATE_LIMITER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisRateLimiter(redis),
    },
    {
      provide: MAILER,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new SmtpMailer(env.SMTP_URL, env.MAIL_FROM),
    },
    {
      provide: PasswordHasher,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new PasswordHasher(Buffer.from(env.PASSWORD_PEPPER)),
    },
    SessionsService,
    PrincipalLoader,
    AuthService,
    InvitationsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionsService, InvitationsService, PasswordHasher, RATE_LIMITER, MAILER],
})
export class AuthModule {}
