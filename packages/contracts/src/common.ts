import { z } from 'zod';
import { LocalDate } from '@staydesk/domain';

/** A stay date: strict `YYYY-MM-DD` that is a real calendar date (BR-02). */
export const localDateSchema = z
  .string()
  .refine(LocalDate.isValid, { message: 'Must be a valid date in YYYY-MM-DD format' });

export const uuidSchema = z.uuid();

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  checks: z.record(z.string(), z.enum(['ok', 'fail', 'skipped'])),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
