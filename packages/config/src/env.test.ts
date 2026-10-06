import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, envFields, parseEnv } from './env.js';

const schema = z.object({
  PORT: envFields.port,
  DATABASE_URL: envFields.postgresUrl,
  SESSION_SECRET: envFields.secret,
});

describe('parseEnv', () => {
  it('parses and coerces valid values', () => {
    const env = parseEnv(schema, {
      PORT: '4000',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      SESSION_SECRET: 'x'.repeat(32),
    });
    expect(env.PORT).toBe(4000);
  });

  it('reports every problem without echoing values', () => {
    const secret = 'too-short-secret-value';
    try {
      parseEnv(schema, { PORT: 'abc', DATABASE_URL: 'mysql://x', SESSION_SECRET: secret });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const err = e as EnvValidationError;
      expect(err.issues.map((i) => i.split(':')[0])).toEqual([
        'PORT',
        'DATABASE_URL',
        'SESSION_SECRET',
      ]);
      expect(err.message).not.toContain(secret);
    }
  });
});
