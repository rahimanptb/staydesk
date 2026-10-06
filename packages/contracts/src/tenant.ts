import { z } from 'zod';
import { emailSchema, personNameSchema } from './auth.js';

export const updateTenantProfileSchema = z.strictObject({
  name: z.string().trim().min(1).max(160).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  billingEmail: emailSchema.nullable().optional(),
  requireStaff2fa: z.boolean().optional(),
});

const propertyScope = {
  allProperties: z.boolean().default(true),
  propertyIds: z.array(z.uuid()).max(500).default([]),
};

export const inviteUserSchema = z
  .strictObject({
    email: emailSchema,
    name: personNameSchema,
    roleId: z.uuid(),
    ...propertyScope,
  })
  .refine((v) => v.allProperties || v.propertyIds.length > 0, {
    message: 'Choose at least one property, or all properties',
    path: ['propertyIds'],
  });

export const updateMembershipSchema = z
  .strictObject({
    roleId: z.uuid().optional(),
    allProperties: z.boolean().optional(),
    propertyIds: z.array(z.uuid()).max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const updateRolePermissionsSchema = z.strictObject({
  permissions: z.array(z.string().max(80)).max(200),
});

export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().max(80).optional(),
});

export type InviteUserRequest = z.infer<typeof inviteUserSchema>;

export interface MembershipView {
  id: string;
  user: { id: string; name: string; email: string; status: string };
  role: { id: string; key: string; name: string };
  status: string;
  isOwner: boolean;
  allProperties: boolean;
  propertyIds: string[];
  createdAt: string;
}

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isEditable: boolean;
  permissions: string[];
}

export interface AuditLogView {
  id: string;
  createdAt: string;
  actorType: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
}
