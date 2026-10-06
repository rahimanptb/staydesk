import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUID version 7: 48-bit Unix-millisecond timestamp + 74 random bits. Time-ordered,
 * so ids sort by creation time and index well. Prisma generates these for `@default(uuid(7))`
 * fields; use this where Prisma cannot (raw SQL, or models whose primary key is also part of a
 * composite relation, such as Tenant).
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
