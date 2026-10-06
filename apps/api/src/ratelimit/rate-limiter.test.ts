import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from './rate-limiter.js';

describe('MemoryRateLimiter', () => {
  it('allows up to the limit per window, then reports retry-after', async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect((await limiter.consume('k', 3, 60)).allowed).toBe(true);
    const blocked = await limiter.consume('k', 3, 60);
    expect(blocked).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect((await limiter.consume('other', 3, 60)).allowed).toBe(true);
    now = 60_000;
    expect((await limiter.consume('k', 3, 60)).allowed).toBe(true);
  });
});
