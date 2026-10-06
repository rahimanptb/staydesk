import type { LocalDate } from '../dates/local-date.js';

/**
 * What a travel agent may see for one room type and stay (docs/08 §11, BR-18).
 *
 * Inputs deliberately exclude the overbook allowance, rates, notes and booking data, so the
 * projection cannot leak them. Outputs contain only the keys allowed for the visibility level.
 */

export type AgentVisibility = 'STATUS_ONLY' | 'CAPPED_COUNT' | 'EXACT_COUNT' | 'FULL_BREAKDOWN';

export const DEFAULT_AGENT_VISIBILITY: AgentVisibility = 'FULL_BREAKDOWN';

export type AgentAvailabilityStatus =
  'AVAILABLE' | 'LIMITED' | 'ON_REQUEST' | 'UNAVAILABLE' | 'CLOSED';

export interface AgentNightInput {
  date: LocalDate;
  total: number;
  booked: number;
  held: number;
  blocked: number;
  outOfService: number;
  closedAll: boolean;
  closedAgents: boolean;
}

export interface AgentProjectionInput {
  nights: readonly AgentNightInput[];
  roomsRequested: number;
  occupancyFits: boolean;
  lowAvailabilityThreshold: number;
  visibility: AgentVisibility;
  countCap: number;
  /** The hotel granted booking requests on this access (C6). */
  canRequestBooking: boolean;
}

export interface AgentBreakdown {
  total: number;
  /** Includes tentative holds. */
  booked: number;
  blocked: number;
  outOfService: number;
  available: number;
}

export interface AgentProjection {
  status: AgentAvailabilityStatus;
  occupancyFits: boolean;
  requestAllowed: boolean;
  availableDisplay?: string;
  available?: number;
  breakdown?: AgentBreakdown;
}

const nightAvailable = (n: AgentNightInput) =>
  n.total - n.booked - n.held - n.blocked - n.outOfService;

export function projectForAgent(input: AgentProjectionInput): AgentProjection {
  if (input.nights.length === 0) throw new RangeError('A stay has at least one night');

  // The night with the least availability determines everything shown (earliest on ties).
  let tightest = input.nights[0]!;
  for (const n of input.nights) if (nightAvailable(n) < nightAvailable(tightest)) tightest = n;

  const sellable = Math.max(0, nightAvailable(tightest));
  const closed = input.nights.some((n) => n.closedAll || n.closedAgents);

  let status: AgentAvailabilityStatus;
  if (closed) status = 'CLOSED';
  else if (input.occupancyFits && sellable >= input.roomsRequested) {
    status = sellable <= input.lowAvailabilityThreshold ? 'LIMITED' : 'AVAILABLE';
  } else if (input.occupancyFits && input.canRequestBooking) status = 'ON_REQUEST';
  else status = 'UNAVAILABLE';

  const projection: AgentProjection = {
    status,
    occupancyFits: input.occupancyFits,
    requestAllowed:
      input.canRequestBooking &&
      input.occupancyFits &&
      status !== 'CLOSED' &&
      status !== 'UNAVAILABLE',
  };

  switch (input.visibility) {
    case 'STATUS_ONLY':
      break;
    case 'CAPPED_COUNT':
      projection.availableDisplay =
        sellable >= input.countCap ? `${input.countCap}+` : String(sellable);
      break;
    case 'EXACT_COUNT':
      projection.available = sellable;
      break;
    case 'FULL_BREAKDOWN':
      projection.breakdown = {
        total: tightest.total,
        booked: tightest.booked + tightest.held,
        blocked: tightest.blocked,
        outOfService: tightest.outOfService,
        available: sellable,
      };
      break;
  }
  return projection;
}
