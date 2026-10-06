import { describe, expect, it } from 'vitest';
import { redactSecrets } from './audit.js';

describe('redactSecrets', () => {
  it('removes credential fields at any depth and keeps everything else', () => {
    expect(
      redactSecrets({
        email: 'a@b.test',
        passwordHash: '$argon2id$...',
        nested: { resetToken: 'abc', name: 'Asha', list: [{ totpSecret: 'x', ok: 1 }] },
      }),
    ).toEqual({
      email: 'a@b.test',
      passwordHash: '[redacted]',
      nested: {
        resetToken: '[redacted]',
        name: 'Asha',
        list: [{ totpSecret: '[redacted]', ok: 1 }],
      },
    });
  });
});
