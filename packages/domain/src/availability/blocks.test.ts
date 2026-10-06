import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { LocalDate } from '../dates/local-date.js';
import { bucketOfBlock, planBlockRelease, type BlockState } from './blocks.js';

const d = LocalDate.parse;
const block: BlockState = {
  roomTypeId: 'rt',
  kind: 'BLOCK',
  quantity: 4,
  startDate: d('2026-10-10'),
  endDate: d('2026-10-20'),
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
}

describe('bucketOfBlock', () => {
  it('maps kinds to inventory buckets', () => {
    expect(bucketOfBlock('BLOCK')).toBe('BLOCKED');
    expect(bucketOfBlock('OUT_OF_SERVICE')).toBe('OUT_OF_SERVICE');
  });
});

describe('planBlockRelease', () => {
  it('releases everything from the start when the block has not started', () => {
    const plan = planBlockRelease(block, {}, d('2026-10-01'));
    expect(plan.from.toString()).toBe('2026-10-10');
    expect(plan.delta).toMatchObject({ bucket: 'BLOCKED', quantity: -4 });
    expect(plan.delta.to.toString()).toBe('2026-10-20');
    expect(plan.original).toMatchObject({ quantity: 4, released: true });
    expect(plan.original.endDate.toString()).toBe('2026-10-10');
    expect(plan.remainder).toBeNull();
  });

  it('releases a running block from the business date, keeping past nights', () => {
    const plan = planBlockRelease(block, {}, d('2026-10-14'));
    expect(plan.from.toString()).toBe('2026-10-14');
    expect(plan.original.endDate.toString()).toBe('2026-10-14');
    expect(plan.original.released).toBe(true);
  });

  it('releases from a chosen future date', () => {
    const plan = planBlockRelease(block, { fromDate: d('2026-10-17') }, d('2026-10-12'));
    expect(plan.from.toString()).toBe('2026-10-17');
    expect(plan.original.endDate.toString()).toBe('2026-10-17');
  });

  it('reduces quantity in place before the block starts', () => {
    const plan = planBlockRelease(block, { quantity: 1 }, d('2026-10-01'));
    expect(plan.delta.quantity).toBe(-1);
    expect(plan.original).toMatchObject({ quantity: 3, released: false });
    expect(plan.original.endDate.toString()).toBe('2026-10-20');
    expect(plan.remainder).toBeNull();
  });

  it('splits a running block when releasing some rooms (history stays exact)', () => {
    const plan = planBlockRelease(block, { quantity: 3 }, d('2026-10-15'));
    expect(plan.original).toMatchObject({ quantity: 4, released: true });
    expect(plan.original.endDate.toString()).toBe('2026-10-15');
    expect(plan.remainder).toMatchObject({ quantity: 1 });
    expect(plan.remainder!.startDate.toString()).toBe('2026-10-15');
    expect(plan.remainder!.endDate.toString()).toBe('2026-10-20');
    expect(plan.delta).toMatchObject({ quantity: -3 });
    expect(plan.delta.from.toString()).toBe('2026-10-15');
  });

  it('uses the out-of-service bucket for OOS', () => {
    const plan = planBlockRelease({ ...block, kind: 'OUT_OF_SERVICE' }, {}, d('2026-10-01'));
    expect(plan.delta.bucket).toBe('OUT_OF_SERVICE');
  });

  it('rejects past dates, empty ranges and bad quantities', () => {
    expect(
      codeOf(() => planBlockRelease(block, { fromDate: d('2026-10-11') }, d('2026-10-12'))),
    ).toBe('DATE_IN_PAST');
    expect(codeOf(() => planBlockRelease(block, {}, d('2026-10-20')))).toBe('INVALID_DATE_RANGE');
    expect(
      codeOf(() => planBlockRelease(block, { fromDate: d('2026-10-25') }, d('2026-10-12'))),
    ).toBe('INVALID_DATE_RANGE');
    expect(codeOf(() => planBlockRelease(block, { quantity: 0 }, d('2026-10-12')))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => planBlockRelease(block, { quantity: 5 }, d('2026-10-12')))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => planBlockRelease(block, { quantity: 1.5 }, d('2026-10-12')))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
