import { describe, expect, it } from 'vitest';
import { passwordPolicyViolation } from './password-policy.js';

describe('passwordPolicyViolation', () => {
  it('accepts long, varied passwords', () => {
    expect(passwordPolicyViolation('correct horse battery')).toBeNull();
  });

  it('enforces length limits', () => {
    expect(passwordPolicyViolation('short')).toMatch(/at least 10/);
    expect(passwordPolicyViolation('x'.repeat(129))).toMatch(/at most 128/);
  });

  it('rejects passwords containing the email or name, and trivial repetition', () => {
    expect(
      passwordPolicyViolation('priya.sharma2026!', { email: 'priya.sharma@example.com' }),
    ).toMatch(/email/);
    expect(passwordPolicyViolation('IamRahimanForever', { name: 'Rahiman' })).toMatch(/name/);
    expect(passwordPolicyViolation('aaaaabbbbbaaaaa')).toMatch(/repetitive/);
  });
});
