import { NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError, InvariantViolationError } from '@staydesk/domain';
import { problemDetailsSchema } from '@staydesk/contracts';
import { ApiError } from './api-error.js';
import { toProblem } from './problem-details.js';

describe('toProblem', () => {
  it('maps domain errors with their code, status and meta', () => {
    const shortfall = [{ date: '2026-10-11', requested: 2, available: 1 }];
    const result = toProblem(
      new DomainError('NO_AVAILABILITY', 'Short by 1', { shortfall }),
      'req-1',
    );
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      code: 'NO_AVAILABILITY',
      detail: 'Short by 1',
      requestId: 'req-1',
      meta: { shortfall },
    });
    expect(problemDetailsSchema.parse(result.body)).toBeTruthy();
  });

  it('maps API errors', () => {
    const result = toProblem(
      new ApiError('PLAN_LIMIT_REACHED', 'Room limit reached', { meta: { max: 50 } }),
      'r',
    );
    expect(result).toMatchObject({
      status: 403,
      body: { code: 'PLAN_LIMIT_REACHED', meta: { max: 50 } },
    });
  });

  it('maps validation errors to field issues', () => {
    const parsed = z.object({ checkIn: z.string().min(10) }).safeParse({ checkIn: 'x' });
    const result = toProblem(parsed.error, 'r');
    expect(result.status).toBe(422);
    expect(result.body.errors).toEqual([expect.objectContaining({ path: 'checkIn' })]);
  });

  it('maps framework HTTP errors', () => {
    expect(toProblem(new NotFoundException(), 'r').body.code).toBe('NOT_FOUND');
    expect(toProblem(new PayloadTooLargeException(), 'r')).toMatchObject({
      status: 422,
      body: { code: 'VALIDATION_FAILED' },
    });
    expect(toProblem({ statusCode: 415, message: 'Unsupported Media Type' }, 'r').body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('never leaks unexpected error messages', () => {
    const result = toProblem(
      new InvariantViolationError('SELECT * FROM secret_table failed'),
      'req-9',
    );
    expect(result).toMatchObject({
      status: 500,
      unexpected: true,
      body: { code: 'INTERNAL_ERROR', requestId: 'req-9' },
    });
    expect(JSON.stringify(result.body)).not.toContain('secret_table');
  });
});
