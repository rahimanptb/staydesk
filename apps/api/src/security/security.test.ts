import { describe, expect, it } from 'vitest';
import { SecretBox, csrfTokenFor, randomToken, safeEqual, sha256 } from './crypto.js';
import { PasswordHasher } from './password-hasher.js';
import { base32Decode, base32Encode, hotp, otpauthUri, timeStep, verifyTotp } from './totp.js';

describe('crypto helpers', () => {
  it('creates unique URL-safe tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('compares in constant time and handles different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('seals and opens secrets, rejecting tampering and wrong keys', () => {
    const box = new SecretBox(sha256('key'));
    const sealed = box.seal(Buffer.from('totp-secret'));
    expect(box.open(sealed).toString()).toBe('totp-secret');
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => box.open(tampered)).toThrow();
    expect(() => new SecretBox(sha256('other')).open(sealed)).toThrow();
  });

  it('derives stable, session-specific CSRF tokens', () => {
    const secret = sha256('s');
    expect(csrfTokenFor(secret, 'session-1')).toBe(csrfTokenFor(secret, 'session-1'));
    expect(csrfTokenFor(secret, 'session-1')).not.toBe(csrfTokenFor(secret, 'session-2'));
  });
});

describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  const secret = Buffer.from('12345678901234567890');

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('at T=%i the code is %s', (seconds, code) => {
    expect(hotp(secret, timeStep(seconds * 1000))).toBe(code);
  });

  it('accepts ±1 step of drift and rejects replays', () => {
    const now = 1111111111 * 1000;
    const step = timeStep(now);
    const previous = hotp(secret, step - 1);
    expect(verifyTotp(secret, previous, now, null)).toBe(step - 1);
    expect(verifyTotp(secret, previous, now, step - 1)).toBeNull();
    expect(verifyTotp(secret, hotp(secret, step + 2), now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });

  it('round-trips base32 and builds authenticator URIs', () => {
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString()).toBe(
      '12345678901234567890',
    );
    expect(otpauthUri(secret, 'a@b.test', 'StayDesk')).toBe(
      'otpauth://totp/StayDesk%3Aa%40b.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=StayDesk&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('PasswordHasher', () => {
  const fast = { memory: 1024, passes: 1, parallelism: 1 };
  const hasher = new PasswordHasher(sha256('pepper'), fast);

  it('hashes with argon2id and verifies', async () => {
    const stored = await hasher.hash('correct horse battery');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    expect(await hasher.verify(stored, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(stored, 'wrong horse battery')).toBe(false);
  });

  it('depends on the pepper', async () => {
    const stored = await hasher.hash('correct horse battery');
    const otherPepper = new PasswordHasher(sha256('other'), fast);
    expect(await otherPepper.verify(stored, 'correct horse battery')).toBe(false);
  });

  it('flags hashes made with weaker parameters for re-hashing', async () => {
    const weak = await hasher.hash('correct horse battery');
    const stronger = new PasswordHasher(sha256('pepper'), { ...fast, passes: 2 });
    expect(stronger.needsRehash(weak)).toBe(true);
    expect(await stronger.verify(weak, 'correct horse battery')).toBe(true);
    expect(hasher.needsRehash(weak)).toBe(false);
  });

  it('rejects unknown formats and always fails dummy verification', async () => {
    expect(await hasher.verify('plain-text', 'plain-text')).toBe(false);
    expect(await hasher.verifyDummy('anything')).toBe(false);
  });
});
