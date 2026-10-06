export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Password rules (docs/10 §2): length-based, no composition rules. Breached-password checks
 * (P1) are applied separately. Returns a user-facing message or null.
 */
export function passwordPolicyViolation(
  password: string,
  context: { email?: string; name?: string } = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  const lowered = password.toLowerCase();
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lowered.includes(local))
    return 'Do not use your email address in your password';
  if (context.name && context.name.length >= 4 && lowered.includes(context.name.toLowerCase())) {
    return 'Do not use your name in your password';
  }
  if (new Set(password).size < 4) return 'Use a less repetitive password';
  return null;
}
