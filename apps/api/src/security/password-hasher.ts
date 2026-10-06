import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Argon2Cost {
  /** KiB */
  memory: number;
  passes: number;
  parallelism: number;
}

/** OWASP-aligned production cost (64 MiB, 2 passes). Tune so one hash takes ~250–400 ms. */
export const PRODUCTION_ARGON2_COST: Argon2Cost = { memory: 65536, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

function derive(password: string, salt: Buffer, cost: Argon2Cost, pepper: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password.normalize('NFKC'),
        nonce: salt,
        parallelism: cost.parallelism,
        tagLength: TAG_BYTES,
        memory: cost.memory,
        passes: cost.passes,
        // Argon2's secret input (K): the server-side pepper never stored with the hash.
        secret: pepper,
      },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

/**
 * Argon2id password hashing (docs/10 §2) using Node's built-in implementation (OpenSSL), so no
 * native add-on is needed. Hashes are standard PHC strings; parameters are stored per hash, so
 * the cost can be raised later and old hashes still verify (and get re-hashed on login).
 */
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly pepper: Buffer,
    private readonly cost: Argon2Cost = PRODUCTION_ARGON2_COST,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await derive(password, salt, this.cost, this.pepper);
    const { memory, passes, parallelism } = this.cost;
    return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(tag)}`;
  }

  async verify(stored: string, password: string): Promise<boolean> {
    const match = PHC.exec(stored);
    if (!match) return false;
    const cost = {
      memory: Number(match[1]),
      passes: Number(match[2]),
      parallelism: Number(match[3]),
    };
    const salt = Buffer.from(match[4]!, 'base64');
    const expected = Buffer.from(match[5]!, 'base64');
    try {
      const actual = await derive(password, salt, cost, this.pepper);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  /** True when a stored hash uses weaker parameters than the current cost. */
  needsRehash(stored: string): boolean {
    const match = PHC.exec(stored);
    if (!match) return true;
    return (
      Number(match[1]) < this.cost.memory ||
      Number(match[2]) < this.cost.passes ||
      Number(match[3]) !== this.cost.parallelism
    );
  }

  /**
   * Spends the same time as a real verification, for unknown accounts, so response timing does
   * not reveal which emails exist.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
