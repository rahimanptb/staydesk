import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@staydesk/domain';
import type { PortalContext } from './portals.js';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** New passwords (BR: docs/10 §2). Login accepts any non-empty string up to the maximum. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const personNameSchema = z.string().trim().min(1).max(120);

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const selectContextSchema = z
  .strictObject({
    tenantId: z.uuid().optional(),
    agencyId: z.uuid().optional(),
  })
  .refine((v) => Boolean(v.tenantId) !== Boolean(v.agencyId), {
    message: 'Provide exactly one of tenantId or agencyId',
  });

const totpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const recoveryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, 'Enter a recovery code like ABCDE-12345');

export const mfaVerifySchema = z
  .strictObject({ code: totpCode.optional(), recoveryCode: recoveryCode.optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide a code or a recovery code',
  });

export const totpEnableSchema = z.strictObject({ code: totpCode });

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });

const opaqueToken = z.string().min(20).max(200);

export const resetPasswordSchema = z.strictObject({
  token: opaqueToken,
  password: newPasswordSchema,
});

export const acceptInvitationSchema = z.strictObject({
  name: personNameSchema.optional(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const invitationTokenSchema = opaqueToken;

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type MfaState = 'NONE' | 'VERIFY' | 'ENROLL';

export interface ContextOption {
  id: string;
  name: string;
  isOwner?: boolean;
}

/** GET /auth/session and the login response. */
export interface SessionInfo {
  user: { id: string; name: string; email: string };
  context: PortalContext;
  /** Chosen tenant/agency; null until the user picks one (multi-membership). */
  current: ContextOption | null;
  options: ContextOption[];
  mfa: MfaState;
  permissions: string[];
  csrfToken: string;
}

export interface InvitationPreview {
  email: string;
  organizationName: string;
  kind: 'TENANT' | 'PLATFORM';
  /** True when the invitee already has a password and must confirm it instead of choosing one. */
  existingAccount: boolean;
}

export interface TotpSetup {
  secret: string;
  otpauthUri: string;
}
