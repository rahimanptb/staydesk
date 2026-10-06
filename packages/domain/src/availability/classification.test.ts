import { describe, expect, it } from 'vitest';
import {
  classifyNight,
  stayAvailable,
  worstStatus,
  type ClassifiableNight,
} from './classification.js';

const night = (over: Partial<ClassifiableNight>): ClassifiableNight => ({
  total: 10,
  booked: 0,
  held: 0,
  blocked: 0,
  outOfService: 0,
  overbookAllowance: 0,
  closedAll: false,
  closedAgents: false,
  ...over,
});

describe('classifyNight', () => {
  it('classifies by availability and threshold', () => {
    expect(classifyNight(night({ booked: 5 }), 2)).toBe('AVAILABLE');
    expect(classifyNight(night({ booked: 8 }), 2)).toBe('LOW');
    expect(classifyNight(night({ booked: 10 }), 2)).toBe('FULL');
  });

  it('marks nights unavailable purely because of blocks as BLOCKED', () => {
    expect(classifyNight(night({ blocked: 6, outOfService: 4 }), 2)).toBe('BLOCKED');
    expect(classifyNight(night({ blocked: 6, booked: 4 }), 2)).toBe('FULL');
  });

  it('shows overbooking to staff and FULL to agents', () => {
    const over = night({ booked: 11, overbookAllowance: 1 });
    expect(classifyNight(over, 2, 'STAFF')).toBe('OVERBOOKED');
    expect(classifyNight(over, 2, 'AGENT')).toBe('FULL');
  });

  it('applies closures by channel', () => {
    expect(classifyNight(night({ closedAll: true }), 2)).toBe('CLOSED');
    expect(classifyNight(night({ closedAgents: true }), 2, 'STAFF')).toBe('AVAILABLE');
    expect(classifyNight(night({ closedAgents: true }), 2, 'AGENT')).toBe('CLOSED');
  });
});

describe('stay aggregation', () => {
  it('takes the worst night and the minimum availability', () => {
    expect(worstStatus(['AVAILABLE', 'LOW', 'FULL', 'AVAILABLE'])).toBe('FULL');
    expect(worstStatus(['LOW', 'CLOSED', 'OVERBOOKED'])).toBe('CLOSED');
    expect(worstStatus([])).toBe('AVAILABLE');
    expect(stayAvailable([night({ booked: 2 }), night({ booked: 7 }), night({})])).toBe(3);
    expect(() => stayAvailable([])).toThrow(RangeError);
  });
});
