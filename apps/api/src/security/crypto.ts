import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** URL-safe random token with `bytes` of entropy (session, invitation, reset tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

export function hmacSha256(key: Buffer, value: string | Buffer): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/** Constant-time comparison; different lengths compare unequal without leaking timing. */
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const left = typeof a === 'string' ? Buffer.from(a) : a;
  const right = typeof b === 'string' ? Buffer.from(b) : b;
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM authenticated encryption for small secrets at rest (TOTP secrets).
 * Layout: version (1) | iv (12) | tag (16) | ciphertext. The version byte allows key rotation.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
  }

  seal(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  open(sealed: Buffer): Buffer {
    if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== SEAL_VERSION) {
      throw new Error('Unsupported sealed secret');
    }
    const iv = sealed.subarray(1, 1 + IV_BYTES);
    const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  }
}

/**
 * CSRF token bound to a session (docs/10 §5). Derived, not stored, so the browser can always
 * fetch it again from GET /auth/session.
 */
export function csrfTokenFor(secret: Buffer, sessionId: string): string {
  return hmacSha256(secret, `csrf:${sessionId}`).toString('base64url');
}

/** A Buffer as a standalone Uint8Array (what Prisma's Bytes fields accept). */
export function toBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}
