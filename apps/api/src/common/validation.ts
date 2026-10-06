import type { z } from 'zod';

/**
 * Validates untrusted input against a schema. A ZodError becomes a 422 VALIDATION_FAILED
 * problem response with field issues (see problem-details.ts).
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}
