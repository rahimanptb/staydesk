import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window limiter keyed by purpose + subject (docs/06 §4). */
export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** DI token. */
export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Shared across API instances; atomic INCR + first-hit EXPIRE. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const results = await this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSeconds, 'NX')
      .ttl(redisKey)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Math.max(1, Number(results?.[2]?.[1] ?? windowSeconds));
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: count <= limit ? 0 : ttl,
    };
  }
}

/** Single-process limiter for tests and local tooling. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    const allowed = window.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - window.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetAt - now) / 1000),
    };
  }
}
