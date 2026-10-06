import { describe, expect, it } from 'vitest';
import { InvariantViolationError } from '../errors.js';
import { LocalDate } from '../dates/local-date.js';
import { eachNight } from '../dates/stay.js';
import { stayAvailable } from './classification.js';
import {
  available,
  planInventoryChange,
  totalChangeConflicts,
  type InventoryDayState,
  type InventoryDelta,
  type InventoryPlan,
  type PlanOptions,
} from './inventory.js';

const d = LocalDate.parse;
const DELUXE = 'rt-deluxe';
const SUITE = 'rt-suite';

function rows(roomTypeId: string, total: number, from: string, to: string): InventoryDayState[] {
  return eachNight(d(from), d(to)).map((date) => ({
    roomTypeId,
    date,
    total,
    booked: 0,
    held: 0,
    blocked: 0,
    outOfService: 0,
    overbookAllowance: 0,
    closedAll: false,
    closedAgents: false,
  }));
}

const staff: PlanOptions = {
  channel: 'STAFF',
  override: false,
  ignoreStopSell: false,
  lowAvailabilityThreshold: 2,
};

const delta = (
  roomTypeId: string,
  from: string,
  to: string,
  quantity: number,
  bucket: InventoryDelta['bucket'] = 'BOOKED',
): InventoryDelta => ({ roomTypeId, from: d(from), to: d(to), bucket, quantity });

/** Applies a successful plan to the row set, as the database layer would. */
function apply(state: InventoryDayState[], plan: InventoryPlan): InventoryDayState[] {
  if (!plan.ok) throw new Error(`Expected success, got ${JSON.stringify(plan)}`);
  return state.map((row) => {
    const change = plan.changes.find(
      (c) => c.roomTypeId === row.roomTypeId && c.date.equals(row.date),
    );
    return change ? { ...row, ...change.after } : row;
  });
}

const availabilityByDate = (state: InventoryDayState[], roomTypeId: string) =>
  Object.fromEntries(
    state.filter((r) => r.roomTypeId === roomTypeId).map((r) => [r.date.toString(), available(r)]),
  );

describe('planInventoryChange', () => {
  it('computes date-wise availability for the brief example (AV-01)', () => {
    let state = rows(DELUXE, 10, '2026-10-01', '2026-10-06');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-01', '2026-10-03', 2)], staff),
    );
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-02', '2026-10-05', 3)], staff),
    );

    expect(availabilityByDate(state, DELUXE)).toEqual({
      '2026-10-01': 8,
      '2026-10-02': 5,
      '2026-10-03': 7,
      '2026-10-04': 7,
      '2026-10-05': 10,
    });
    const stay = state.filter((r) => r.date.isBefore(d('2026-10-05')));
    expect(stayAvailable(stay)).toBe(5);

    const sixRooms = planInventoryChange(
      state,
      [delta(DELUXE, '2026-10-01', '2026-10-05', 6)],
      staff,
    );
    expect(sixRooms).toEqual({
      ok: false,
      shortfalls: [{ roomTypeId: DELUXE, date: '2026-10-02', requested: 6, available: 5 }],
      closedNights: [],
    });
  });

  it('sells the last room once (AV-02)', () => {
    let state = rows(DELUXE, 1, '2026-10-10', '2026-10-12');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-12', 1)], staff),
    );
    const second = planInventoryChange(
      state,
      [delta(DELUXE, '2026-10-11', '2026-10-12', 1)],
      staff,
    );
    expect(second.ok).toBe(false);
    if (!second.ok)
      expect(second.shortfalls).toEqual([
        { roomTypeId: DELUXE, date: '2026-10-11', requested: 1, available: 0 },
      ]);
  });

  it('allows back-to-back stays on a single room (DT-01)', () => {
    let state = rows(DELUXE, 1, '2026-10-10', '2026-10-14');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-12', 1)], staff),
    );
    const next = planInventoryChange(state, [delta(DELUXE, '2026-10-12', '2026-10-14', 1)], staff);
    expect(next.ok).toBe(true);
  });

  it('rejects a multi-type booking if any type is short (AV-04)', () => {
    const state = [
      ...rows(DELUXE, 5, '2026-10-10', '2026-10-12'),
      ...rows(SUITE, 1, '2026-10-10', '2026-10-12'),
    ];
    const plan = planInventoryChange(
      state,
      [delta(DELUXE, '2026-10-10', '2026-10-12', 2), delta(SUITE, '2026-10-10', '2026-10-12', 2)],
      staff,
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.shortfalls.map((s) => s.roomTypeId)).toEqual([SUITE, SUITE]);
  });

  it('nets a date move so overlapping nights need no extra availability (BR-16, MD-02)', () => {
    let state = rows(DELUXE, 1, '2026-10-10', '2026-10-13');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-12', 1)], staff),
    );
    const move = planInventoryChange(
      state,
      [delta(DELUXE, '2026-10-10', '2026-10-12', -1), delta(DELUXE, '2026-10-11', '2026-10-13', 1)],
      staff,
    );
    state = apply(state, move);
    expect(availabilityByDate(state, DELUXE)).toEqual({
      '2026-10-10': 1,
      '2026-10-11': 0,
      '2026-10-12': 0,
    });
  });

  it('rejects an extension into a full night as a whole (MD-01)', () => {
    let state = rows(DELUXE, 1, '2026-10-10', '2026-10-13');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-12', 1)], staff),
    );
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-12', '2026-10-13', 1)], staff),
    );
    const extend = planInventoryChange(
      state,
      [delta(DELUXE, '2026-10-12', '2026-10-13', 1)],
      staff,
    );
    expect(extend.ok).toBe(false);
  });

  it('moves a tentative hold to booked without needing availability (confirm)', () => {
    let state = rows(DELUXE, 1, '2026-10-10', '2026-10-11');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1, 'HELD')], staff),
    );
    state = state.map((r) => ({ ...r, closedAll: true }));
    const confirm = planInventoryChange(
      state,
      [
        delta(DELUXE, '2026-10-10', '2026-10-11', -1, 'HELD'),
        delta(DELUXE, '2026-10-10', '2026-10-11', 1, 'BOOKED'),
      ],
      staff,
    );
    state = apply(state, confirm);
    expect(state[0]).toMatchObject({ held: 0, booked: 1 });
  });

  it('counts blocks and out-of-service against availability (BL-01)', () => {
    let state = rows(DELUXE, 3, '2026-10-10', '2026-10-11');
    state = apply(
      state,
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1, 'BLOCKED')], staff),
    );
    state = apply(
      state,
      planInventoryChange(
        state,
        [delta(DELUXE, '2026-10-10', '2026-10-11', 1, 'OUT_OF_SERVICE')],
        staff,
      ),
    );
    expect(available(state[0]!)).toBe(1);
    const tooBig = planInventoryChange(
      state,
      [delta(DELUXE, '2026-10-10', '2026-10-11', 2, 'BLOCKED')],
      staff,
    );
    expect(tooBig.ok).toBe(false);
  });

  describe('authorised override (C8)', () => {
    it('raises the allowance, and shrinks it again on release so the room is not resold', () => {
      let state = rows(DELUXE, 2, '2026-10-10', '2026-10-11');
      state = apply(
        state,
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 2)], staff),
      );

      const over = planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1)], {
        ...staff,
        override: true,
      });
      expect(over.ok && over.changes[0]!.overrideUsed).toBe(true);
      state = apply(state, over);
      expect(state[0]).toMatchObject({ booked: 3, overbookAllowance: 1 });
      expect(available(state[0]!)).toBe(-1);

      state = apply(
        state,
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', -1)], staff),
      );
      expect(state[0]).toMatchObject({ booked: 2, overbookAllowance: 0 });
      expect(
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1)], staff).ok,
      ).toBe(false);
    });

    it('does not let normal users use an existing allowance', () => {
      const state = rows(DELUXE, 2, '2026-10-10', '2026-10-11').map((r) => ({
        ...r,
        booked: 3,
        overbookAllowance: 1,
      }));
      expect(
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1)], staff).ok,
      ).toBe(false);
    });
  });

  describe('stop-sell', () => {
    it('blocks staff sales on closed nights unless overridden', () => {
      const state = rows(DELUXE, 5, '2026-10-10', '2026-10-12').map((r, i) => ({
        ...r,
        closedAll: i === 1,
      }));
      const plan = planInventoryChange(
        state,
        [delta(DELUXE, '2026-10-10', '2026-10-12', 1)],
        staff,
      );
      expect(plan).toEqual({
        ok: false,
        shortfalls: [],
        closedNights: [{ roomTypeId: DELUXE, date: '2026-10-11' }],
      });
      expect(
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-12', 1)], {
          ...staff,
          ignoreStopSell: true,
        }).ok,
      ).toBe(true);
    });

    it('agents-only closures do not affect staff, and closures never block blocks', () => {
      const state = rows(DELUXE, 5, '2026-10-10', '2026-10-11').map((r) => ({
        ...r,
        closedAgents: true,
      }));
      expect(
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1)], staff).ok,
      ).toBe(true);
      expect(
        planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 1)], {
          ...staff,
          channel: 'AGENT',
        }).ok,
      ).toBe(false);
      const closedAll = state.map((r) => ({ ...r, closedAll: true }));
      expect(
        planInventoryChange(
          closedAll,
          [delta(DELUXE, '2026-10-10', '2026-10-11', 1, 'BLOCKED')],
          staff,
        ).ok,
      ).toBe(true);
    });
  });

  it('flags low-availability and full crossings for notifications', () => {
    const state = rows(DELUXE, 4, '2026-10-10', '2026-10-11');
    const low = planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 2)], staff);
    expect(low.ok && low.changes[0]).toMatchObject({
      crossedLowThreshold: true,
      becameFull: false,
    });
    const full = planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', 4)], staff);
    expect(full.ok && full.changes[0]).toMatchObject({
      crossedLowThreshold: false,
      becameFull: true,
    });
  });

  it('treats an empty range as a no-op', () => {
    const state = rows(DELUXE, 1, '2026-10-10', '2026-10-11');
    expect(
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-10', 1)], staff),
    ).toEqual({ ok: true, changes: [] });
  });

  it('refuses to release inventory that was never consumed', () => {
    const state = rows(DELUXE, 1, '2026-10-10', '2026-10-11');
    expect(() =>
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-11', -1)], staff),
    ).toThrow(InvariantViolationError);
  });

  it('refuses to plan against rows that were not locked', () => {
    const state = rows(DELUXE, 1, '2026-10-10', '2026-10-11');
    expect(() =>
      planInventoryChange(state, [delta(DELUXE, '2026-10-10', '2026-10-12', 1)], staff),
    ).toThrow(/not locked/);
  });
});

describe('totalChangeConflicts (BR-09, OOS-02)', () => {
  it('lists future nights that would exceed a reduced total', () => {
    const state = rows(DELUXE, 5, '2026-10-10', '2026-10-13').map((r, i) => ({
      ...r,
      booked: [2, 4, 3][i]!,
    }));
    expect(totalChangeConflicts(state, 3)).toEqual([{ date: '2026-10-11', consumed: 4 }]);
    expect(totalChangeConflicts(state, 4)).toEqual([]);
  });
});
