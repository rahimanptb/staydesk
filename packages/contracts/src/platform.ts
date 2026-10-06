import { z } from 'zod';
import { emailSchema, personNameSchema } from './auth.js';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, 'Use 3–50 lowercase letters, digits or hyphens');
const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');

export const createTenantSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  slug,
  country,
  legalName: z.string().trim().max(200).optional(),
  billingEmail: emailSchema.optional(),
  planId: z.uuid(),
  trialEndsAt: z.iso.datetime().optional(),
  owner: z.strictObject({ name: personNameSchema, email: emailSchema }),
});

export const updatePlatformTenantSchema = z.strictObject({
  name: z.string().trim().min(1).max(160).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  billingEmail: emailSchema.nullable().optional(),
});

export const tenantStatusChangeSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

const entitlementKey = z
  .string()
  .regex(/^(limit|feature)\.[a-zA-Z0-9.]+$/, 'Use limit.* or feature.*');

export const planSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const updatePlanSchema = planSchema.partial();

export const planEntitlementsSchema = z.strictObject({
  entitlements: z
    .array(
      z.union([
        z.strictObject({ key: entitlementKey, intValue: z.number().int().min(0) }),
        z.strictObject({ key: entitlementKey, boolValue: z.boolean() }),
      ]),
    )
    .max(100),
});

export type CreateTenantRequest = z.infer<typeof createTenantSchema>;
