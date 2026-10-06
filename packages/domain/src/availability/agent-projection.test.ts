import { describe, expect, it } from 'vitest';
import { LocalDate } from '../dates/local-date.js';
import {
  projectForAgent,
  type AgentNightInput,
  type AgentProjectionInput,
} from './agent-projection.js';

const night = (date: string, over: Partial<AgentNightInput> = {}): AgentNightInput => ({
  date: LocalDate.parse(date),
  total: 20,
  booked: 0,
  held: 0,
  blocked: 0,
  outOfService: 0,
  closedAll: false,
  closedAgents: false,
  ...over,
});

const base: AgentProjectionInput = {
  nights: [
    night('2026-10-10', { booked: 10, held: 2, blocked: 2 }),
    night('2026-10-11', { booked: 8 }),
  ],
  roomsRequested: 2,
  occupancyFits: true,
  lowAvailabilityThreshold: 2,
  visibility: 'FULL_BREAKDOWN',
  countCap: 5,
  canRequestBooking: true,
};

describe('projectForAgent (TA-05)', () => {
  it('returns the brief breakdown from the tightest night by default', () => {
    expect(projectForAgent(base)).toEqual({
      status: 'AVAILABLE',
      occupancyFits: true,
      requestAllowed: true,
      breakdown: { total: 20, booked: 12, blocked: 2, outOfService: 0, available: 6 },
    });
  });

  it('returns exactly the keys allowed for each visibility level', () => {
    const keys = (visibility: AgentProjectionInput['visibility']) =>
      Object.keys(projectForAgent({ ...base, visibility })).sort();
    expect(keys('STATUS_ONLY')).toEqual(['occupancyFits', 'requestAllowed', 'status']);
    expect(keys('CAPPED_COUNT')).toEqual([
      'availableDisplay',
      'occupancyFits',
      'requestAllowed',
      'status',
    ]);
    expect(keys('EXACT_COUNT')).toEqual(['available', 'occupancyFits', 'requestAllowed', 'status']);
    expect(keys('FULL_BREAKDOWN')).toEqual([
      'breakdown',
      'occupancyFits',
      'requestAllowed',
      'status',
    ]);
  });

  it('caps counts at the configured cap', () => {
    expect(projectForAgent({ ...base, visibility: 'CAPPED_COUNT' }).availableDisplay).toBe('5+');
    expect(
      projectForAgent({ ...base, visibility: 'CAPPED_COUNT', countCap: 10 }).availableDisplay,
    ).toBe('6');
  });

  it('reports LIMITED at or below the low threshold', () => {
    const nights = [night('2026-10-10', { booked: 18 })];
    expect(projectForAgent({ ...base, nights }).status).toBe('LIMITED');
  });

  it('offers ON_REQUEST only when the hotel allows requests', () => {
    const nights = [night('2026-10-10', { booked: 19 })];
    expect(projectForAgent({ ...base, nights, roomsRequested: 2 }).status).toBe('ON_REQUEST');
    const noRequests = projectForAgent({
      ...base,
      nights,
      roomsRequested: 2,
      canRequestBooking: false,
    });
    expect(noRequests).toMatchObject({ status: 'UNAVAILABLE', requestAllowed: false });
  });

  it('marks closures for agents regardless of counts', () => {
    const nights = [night('2026-10-10'), night('2026-10-11', { closedAgents: true })];
    expect(projectForAgent({ ...base, nights })).toMatchObject({
      status: 'CLOSED',
      requestAllowed: false,
    });
  });

  it('never shows overbooking: negative availability is 0', () => {
    const nights = [night('2026-10-10', { booked: 22 })];
    const p = projectForAgent({ ...base, nights, canRequestBooking: false });
    expect(p.status).toBe('UNAVAILABLE');
    expect(p.breakdown?.available).toBe(0);
  });

  it('marks room types that cannot hold the party as unavailable', () => {
    expect(projectForAgent({ ...base, occupancyFits: false })).toMatchObject({
      status: 'UNAVAILABLE',
      occupancyFits: false,
      requestAllowed: false,
    });
  });
});
