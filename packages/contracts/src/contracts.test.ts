import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_STATUS, errorTypeUri, problemDetailsSchema } from './errors.js';
import { localDateSchema } from './common.js';

describe('error catalogue', () => {
  it('maps every code to an HTTP error status', () => {
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it('builds stable type URIs', () => {
    expect(errorTypeUri('NO_AVAILABILITY')).toBe(
      'https://docs.staydesk.app/errors/no-availability',
    );
  });

  it('validates problem details and rejects unknown codes', () => {
    const ok = { type: 't', title: 'x', status: 409, code: 'NO_AVAILABILITY', requestId: 'r1' };
    expect(problemDetailsSchema.parse(ok).errors).toEqual([]);
    expect(problemDetailsSchema.safeParse({ ...ok, code: 'SOMETHING_ELSE' }).success).toBe(false);
  });
});

describe('localDateSchema', () => {
  it('accepts real ISO dates only', () => {
    expect(localDateSchema.safeParse('2026-10-05').success).toBe(true);
    expect(localDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(localDateSchema.safeParse('05/10/2026').success).toBe(false);
  });
});
