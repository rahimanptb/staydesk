import { describe, expect, it } from 'vitest';
import { aggregateOccupancyFits, roomOccupancyViolation } from './occupancy.js';

const deluxe = { maxAdults: 3, maxChildren: 2, maxOccupancy: 4 };

describe('roomOccupancyViolation (BR-12)', () => {
  it('accepts occupancy within limits', () => {
    expect(roomOccupancyViolation(2, 2, deluxe)).toBeNull();
    expect(roomOccupancyViolation(3, 1, deluxe)).toBeNull();
  });

  it.each([
    [0, 1, 'at least 1 adult'],
    [4, 0, 'Maximum 3 adults'],
    [1, 3, 'Maximum 2 children'],
    [3, 2, 'Maximum 4 guests'],
    [1.5, 0, 'whole numbers'],
    [1, -1, 'whole numbers'],
  ])('rejects %i adults + %i children', (adults, children, message) => {
    expect(roomOccupancyViolation(adults, children, deluxe)).toContain(message);
  });
});

describe('aggregateOccupancyFits (agent search)', () => {
  it('spreads a party across rooms', () => {
    expect(aggregateOccupancyFits({ rooms: 2, adults: 4, children: 1 }, deluxe)).toBe(true);
    expect(aggregateOccupancyFits({ rooms: 2, adults: 6, children: 2 }, deluxe)).toBe(true);
  });

  it('rejects parties that cannot fit or leave a room without an adult', () => {
    expect(aggregateOccupancyFits({ rooms: 2, adults: 7, children: 0 }, deluxe)).toBe(false);
    expect(aggregateOccupancyFits({ rooms: 2, adults: 6, children: 3 }, deluxe)).toBe(false);
    expect(aggregateOccupancyFits({ rooms: 3, adults: 2, children: 0 }, deluxe)).toBe(false);
    expect(aggregateOccupancyFits({ rooms: 0, adults: 2, children: 0 }, deluxe)).toBe(false);
  });
});
