import { available, type InventoryCounters } from './inventory.js';

/** Calendar cell / stay status for staff views (docs/08 §3). */
export type AvailabilityStatus = 'AVAILABLE' | 'LOW' | 'BLOCKED' | 'FULL' | 'OVERBOOKED' | 'CLOSED';

export interface ClassifiableNight extends InventoryCounters {
  closedAll: boolean;
  closedAgents: boolean;
}

export type ViewerChannel = 'STAFF' | 'AGENT';

const SEVERITY: Record<AvailabilityStatus, number> = {
  AVAILABLE: 0,
  LOW: 1,
  BLOCKED: 2,
  FULL: 3,
  OVERBOOKED: 4,
  CLOSED: 5,
};

export function classifyNight(
  night: ClassifiableNight,
  lowAvailabilityThreshold: number,
  viewer: ViewerChannel = 'STAFF',
): AvailabilityStatus {
  if (night.closedAll || (viewer === 'AGENT' && night.closedAgents)) return 'CLOSED';
  const avail = available(night);
  if (avail < 0) return viewer === 'STAFF' ? 'OVERBOOKED' : 'FULL';
  if (avail === 0) {
    const onlyBlocks = night.booked + night.held === 0 && night.blocked + night.outOfService > 0;
    return onlyBlocks ? 'BLOCKED' : 'FULL';
  }
  return avail <= lowAvailabilityThreshold ? 'LOW' : 'AVAILABLE';
}

/** A stay takes the status of its worst night. */
export function worstStatus(statuses: readonly AvailabilityStatus[]): AvailabilityStatus {
  return statuses.reduce<AvailabilityStatus>(
    (worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst),
    'AVAILABLE',
  );
}

/** Minimum availability across the nights of a stay (BR-07). Empty input means no nights. */
export function stayAvailable(nights: readonly InventoryCounters[]): number {
  if (nights.length === 0) throw new RangeError('A stay has at least one night');
  return Math.min(...nights.map(available));
}
