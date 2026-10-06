import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LocalDate } from '../dates/local-date.js';
import { eachNight } from '../dates/stay.js';
import {
  consumed,
  planInventoryChange,
  totalChangeConflicts,
  type InventoryBucket,
  type InventoryDayState,
  type InventoryDelta,
} from './inventory.js';

/**
 * Property-based check of the ledger arithmetic (docs/11 §2): random sequences of consume,
 * release, modify and total changes are applied through `planInventoryChange`, and after every
 * step the counters must equal an oracle recomputed from the live commitments — the same proof
 * the database reconciliation gives.
 */

const START = LocalDate.parse('2026-10-01');
const NIGHTS = 8;
const TYPES = ['rt-a', 'rt-b'] as const;
const BUCKETS: InventoryBucket[] = ['BOOKED', 'HELD', 'BLOCKED', 'OUT_OF_SERVICE'];
const FIELD = {
  BOOKED: 'booked',
  HELD: 'held',
  BLOCKED: 'blocked',
  OUT_OF_SERVICE: 'outOfService',
} as const;

interface Commitment {
  roomTypeId: string;
  from: number;
  to: number;
  bucket: InventoryBucket;
  quantity: number;
}

const range = fc
  .tuple(fc.integer({ min: 0, max: NIGHTS - 1 }), fc.integer({ min: 1, max: 4 }))
  .map(([from, len]) => ({ from, to: Math.min(NIGHTS, from + len) }));

const commitment = fc.record({
  roomTypeId: fc.constantFrom(...TYPES),
  range,
  bucket: fc.constantFrom(...BUCKETS),
  quantity: fc.integer({ min: 1, max: 3 }),
});

const operation = fc.oneof(
  fc.record({
    op: fc.constant('consume' as const),
    c: commitment,
    override: fc.boolean(),
    ignoreStopSell: fc.boolean(),
  }),
  fc.record({ op: fc.constant('release' as const), pick: fc.nat() }),
  fc.record({
    op: fc.constant('modify' as const),
    pick: fc.nat(),
    c: commitment,
    override: fc.boolean(),
  }),
  fc.record({
    op: fc.constant('total' as const),
    roomTypeId: fc.constantFrom(...TYPES),
    total: fc.integer({ min: 0, max: 8 }),
  }),
);

function deltaOf(c: Commitment, sign: 1 | -1): InventoryDelta {
  return {
    roomTypeId: c.roomTypeId,
    from: START.plusDays(c.from),
    to: START.plusDays(c.to),
    bucket: c.bucket,
    quantity: sign * c.quantity,
  };
}

describe('planInventoryChange (property-based)', () => {
  it('keeps counters equal to the oracle and never oversells without an override', () => {
    fc.assert(
      fc.property(
        fc.record({ a: fc.integer({ min: 0, max: 6 }), b: fc.integer({ min: 0, max: 6 }) }),
        fc.array(fc.boolean(), { minLength: NIGHTS * 2, maxLength: NIGHTS * 2 }),
        fc.array(operation, { minLength: 1, maxLength: 40 }),
        (totals, closedFlags, ops) => {
          const rows = new Map<string, InventoryDayState>();
          TYPES.forEach((rt, t) =>
            eachNight(START, START.plusDays(NIGHTS)).forEach((date, n) =>
              rows.set(`${rt}|${n}`, {
                roomTypeId: rt,
                date,
                total: rt === 'rt-a' ? totals.a : totals.b,
                booked: 0,
                held: 0,
                blocked: 0,
                outOfService: 0,
                overbookAllowance: 0,
                closedAll: closedFlags[t * NIGHTS + n]!,
                closedAgents: false,
              }),
            ),
          );
          let live: Commitment[] = [];

          const apply = (deltas: InventoryDelta[], override: boolean, ignoreStopSell: boolean) => {
            const before = [...rows.values()].map((r) => ({ ...r }));
            const plan = planInventoryChange(before, deltas, {
              channel: 'STAFF',
              override,
              ignoreStopSell,
              lowAvailabilityThreshold: 1,
            });

            // Oracle for the expected outcome, night by night.
            const net = new Map<string, Record<InventoryBucket, number>>();
            for (const d of deltas) {
              for (let n = START.daysUntil(d.from); n < START.daysUntil(d.to); n++) {
                const key = `${d.roomTypeId}|${n}`;
                const entry = net.get(key) ?? { BOOKED: 0, HELD: 0, BLOCKED: 0, OUT_OF_SERVICE: 0 };
                entry[d.bucket] += d.quantity;
                net.set(key, entry);
              }
            }
            let shouldFail = false;
            for (const [key, delta] of net) {
              const row = rows.get(key)!;
              const increase = BUCKETS.reduce((s, b) => s + delta[b], 0);
              const after = consumed(row) + increase;
              const sales = delta.BOOKED + delta.HELD;
              if (increase > 0 && after > row.total && !override) shouldFail = true;
              if (sales > 0 && increase >= 0 && row.closedAll && !ignoreStopSell) shouldFail = true;
            }
            expect(plan.ok).toBe(!shouldFail);
            if (!plan.ok) return false;
            for (const change of plan.changes) {
              const key = `${change.roomTypeId}|${START.daysUntil(change.date)}`;
              rows.set(key, { ...rows.get(key)!, ...change.after });
            }
            return true;
          };

          for (const step of ops) {
            if (step.op === 'consume') {
              const c: Commitment = {
                roomTypeId: step.c.roomTypeId,
                ...step.c.range,
                bucket: step.c.bucket,
                quantity: step.c.quantity,
              };
              if (apply([deltaOf(c, 1)], step.override, step.ignoreStopSell)) live.push(c);
            } else if (step.op === 'release') {
              if (live.length === 0) continue;
              const c = live[step.pick % live.length]!;
              // Releases always succeed, whatever the state.
              expect(apply([deltaOf(c, -1)], false, false)).toBe(true);
              live = live.filter((x) => x !== c);
            } else if (step.op === 'modify') {
              if (live.length === 0) continue;
              const old = live[step.pick % live.length]!;
              const next: Commitment = {
                roomTypeId: step.c.roomTypeId,
                ...step.c.range,
                bucket: step.c.bucket,
                quantity: step.c.quantity,
              };
              if (apply([deltaOf(old, -1), deltaOf(next, 1)], step.override, false)) {
                live = [...live.filter((x) => x !== old), next];
              }
            } else {
              const typeRows = [...rows.values()].filter((r) => r.roomTypeId === step.roomTypeId);
              if (totalChangeConflicts(typeRows, step.total).length === 0) {
                for (const r of typeRows) {
                  rows.set(`${r.roomTypeId}|${START.daysUntil(r.date)}`, {
                    ...r,
                    total: step.total,
                    overbookAllowance: Math.max(0, consumed(r) - step.total),
                  });
                }
              }
            }

            // Invariants after every step.
            for (const [key, row] of rows) {
              const [rt, n] = [key.split('|')[0]!, Number(key.split('|')[1])];
              for (const bucket of BUCKETS) {
                const expected = live
                  .filter(
                    (c) => c.roomTypeId === rt && c.bucket === bucket && c.from <= n && n < c.to,
                  )
                  .reduce((s, c) => s + c.quantity, 0);
                expect(row[FIELD[bucket]]).toBe(expected);
              }
              expect(consumed(row)).toBeLessThanOrEqual(row.total + row.overbookAllowance);
              expect(row.overbookAllowance).toBe(Math.max(0, consumed(row) - row.total));
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});
