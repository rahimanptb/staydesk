export interface OccupancyLimits {
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
}

/** Per-room occupancy check for a booking line (BR-12). Returns a message or null. */
export function roomOccupancyViolation(
  adults: number,
  children: number,
  limits: OccupancyLimits,
): string | null {
  if (!Number.isInteger(adults) || !Number.isInteger(children) || children < 0) {
    return 'Occupancy must be whole numbers';
  }
  if (adults < 1) return 'Each room needs at least 1 adult';
  if (adults > limits.maxAdults) return `Maximum ${limits.maxAdults} adults per room`;
  if (children > limits.maxChildren) return `Maximum ${limits.maxChildren} children per room`;
  if (adults + children > limits.maxOccupancy) {
    return `Maximum ${limits.maxOccupancy} guests per room`;
  }
  return null;
}

export interface AggregateOccupancy {
  rooms: number;
  adults: number;
  children: number;
}

/**
 * Whether a party can be spread across `rooms` rooms of a type (agent search, docs/08 §10).
 * Requires at least one adult per room.
 */
export function aggregateOccupancyFits(
  party: AggregateOccupancy,
  limits: OccupancyLimits,
): boolean {
  const { rooms, adults, children } = party;
  if (rooms < 1) return false;
  return (
    adults >= rooms &&
    adults <= rooms * limits.maxAdults &&
    children <= rooms * limits.maxChildren &&
    adults + children <= rooms * limits.maxOccupancy
  );
}
