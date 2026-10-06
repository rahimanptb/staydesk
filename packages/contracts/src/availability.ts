import { z } from 'zod';
import { LocalDate } from '@staydesk/domain';
import { localDateSchema } from './common.js';

/** Availability engine contracts (docs/06 §3, docs/08). */

export const AVAILABILITY_STATUSES = [
  'AVAILABLE',
  'LOW',
  'BLOCKED',
  'FULL',
  'OVERBOOKED',
  'CLOSED',
] as const;
export type AvailabilityStatusValue = (typeof AVAILABILITY_STATUSES)[number];

/** The availability grid covers at most this many nights per request (docs/08 §9.1). */
export const MAX_GRID_NIGHTS = 92;

// Field-level date issues are reported separately, so cross-field checks pass on bad input.
const before = (a: string, b: string) => {
  const [x, y] = [LocalDate.tryParse(a), LocalDate.tryParse(b)];
  return !x || !y || x.isBefore(y);
};
const nightsBetween = (a: string, b: string) => {
  const [x, y] = [LocalDate.tryParse(a), LocalDate.tryParse(b)];
  return x && y ? x.daysUntil(y) : 0;
};

export const availabilityGridQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    /** Comma-separated room type ids; all active types when omitted. */
    roomTypeIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
      .pipe(z.array(z.uuid()).max(100).optional()),
  })
  .refine((v) => before(v.from, v.to), { message: '"to" must be after "from"', path: ['to'] })
  .refine((v) => nightsBetween(v.from, v.to) <= MAX_GRID_NIGHTS, {
    message: `Show at most ${MAX_GRID_NIGHTS} nights at a time`,
    path: ['to'],
  });

export const availabilityCheckSchema = z
  .strictObject({
    checkIn: localDateSchema,
    checkOut: localDateSchema,
    rooms: z.number().int().min(1).max(100).default(1),
    adults: z.number().int().min(1).max(500).default(1),
    children: z.number().int().min(0).max(500).default(0),
    roomTypeIds: z.array(z.uuid()).max(100).optional(),
  })
  .refine((v) => before(v.checkIn, v.checkOut), {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  });

export interface AvailabilityNight {
  date: string;
  total: number;
  booked: number;
  held: number;
  blocked: number;
  outOfService: number;
  /** total − booked − held − blocked − out of service; negative only when overbooked. */
  available: number;
  closedAll: boolean;
  closedAgents: boolean;
  status: AvailabilityStatusValue;
}

export interface AvailabilityGridRow {
  roomTypeId: string;
  name: string;
  code: string;
  totalInventory: number;
  nights: AvailabilityNight[];
}

export interface AvailabilityGrid {
  propertyId: string;
  from: string;
  to: string;
  businessDate: string;
  lowAvailabilityThreshold: number;
  roomTypes: AvailabilityGridRow[];
}

export interface AvailabilityQuoteResult {
  roomTypeId: string;
  name: string;
  code: string;
  /** Minimum availability across the stay's nights. */
  available: number;
  /** What can actually be sold to staff: 0 when any night is closed. */
  sellable: number;
  status: AvailabilityStatusValue;
  occupancyFits: boolean;
  /** Fits the party and has at least `rooms` sellable rooms on every night. */
  canBook: boolean;
  /** The night with the least availability. */
  limitingDate: string;
  nights: AvailabilityNight[];
}

export interface AvailabilityQuote {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  adults: number;
  children: number;
  results: AvailabilityQuoteResult[];
}

// ─────────────────────────────── Blocks and out of service ───────────────────────────────

export const BLOCK_KINDS = ['BLOCK', 'OUT_OF_SERVICE'] as const;
export const BLOCK_REASONS = [
  'MAINTENANCE',
  'RENOVATION',
  'OWNER_USE',
  'GROUP_RESERVATION',
  'VIP_RESERVATION',
  'TEMPORARY_CLOSURE',
  'INTERNAL_ALLOCATION',
  'OTHER',
] as const;

export const BLOCK_REASON_LABELS: Record<(typeof BLOCK_REASONS)[number], string> = {
  MAINTENANCE: 'Maintenance',
  RENOVATION: 'Renovation',
  OWNER_USE: 'Owner use',
  GROUP_RESERVATION: 'Group reservation',
  VIP_RESERVATION: 'VIP reservation',
  TEMPORARY_CLOSURE: 'Temporary closure',
  INTERNAL_ALLOCATION: 'Internal allocation',
  OTHER: 'Other',
};

const overrideSchema = z.strictObject({
  reason: z.string().trim().min(3, 'Explain why availability is being exceeded').max(500),
});

export const createBlockSchema = z
  .strictObject({
    kind: z.enum(BLOCK_KINDS),
    roomTypeId: z.uuid(),
    /** A specific room (out of service or blocked); quantity is then 1. */
    roomId: z.uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(10_000).default(1),
    startDate: localDateSchema,
    endDate: localDateSchema,
    reason: z.enum(BLOCK_REASONS),
    notes: z.string().trim().max(2000).nullable().optional(),
    /** Exceed availability (needs inventory.override and overbooking enabled for the tenant). */
    override: overrideSchema.nullable().optional(),
  })
  .refine((v) => before(v.startDate, v.endDate), {
    message: 'The end date must be after the start date',
    path: ['endDate'],
  })
  .refine((v) => !v.roomId || v.quantity === 1, {
    message: 'A room-specific block covers exactly 1 room',
    path: ['quantity'],
  });

export const releaseBlockSchema = z.strictObject({
  /** First night to release; defaults to today (or the block's start if later). */
  fromDate: localDateSchema.optional(),
  /** Rooms to release; defaults to all. */
  quantity: z.number().int().min(1).max(10_000).optional(),
  reason: z.string().trim().min(1, 'Give a reason').max(500),
});

export const blockListQuerySchema = z.object({
  status: z.enum(['active', 'released', 'all']).default('active'),
  kind: z.enum(BLOCK_KINDS).optional(),
  roomTypeId: z.uuid().optional(),
});

export type CreateBlockRequest = z.infer<typeof createBlockSchema>;
export type ReleaseBlockRequest = z.infer<typeof releaseBlockSchema>;
export type BlockListQuery = z.infer<typeof blockListQuerySchema>;

export interface UserRef {
  id: string;
  name: string;
}

export interface BlockView {
  id: string;
  propertyId: string;
  roomTypeId: string;
  roomTypeName: string;
  roomId: string | null;
  roomNumber: string | null;
  kind: (typeof BLOCK_KINDS)[number];
  reason: (typeof BLOCK_REASONS)[number];
  quantity: number;
  startDate: string;
  /** Exclusive; earlier than originalEndDate after an early release. */
  endDate: string;
  originalEndDate: string;
  originalQuantity: number;
  status: 'ACTIVE' | 'RELEASED';
  notes: string | null;
  overrideUsed: boolean;
  splitFromId: string | null;
  createdBy: UserRef | null;
  createdAt: string;
  releasedBy: UserRef | null;
  releasedAt: string | null;
  releaseReason: string | null;
}

export interface BlockReleaseResult {
  block: BlockView;
  /** The continuation holding the rooms still blocked, after a partial release of a running block. */
  remainder: BlockView | null;
}

// ─────────────────────────────────────── Stop-sell ───────────────────────────────────────

export const STOP_SELL_SCOPES = ['ALL_CHANNELS', 'AGENTS_ONLY'] as const;

export const createStopSellSchema = z
  .strictObject({
    /** Null closes every room type of the property. */
    roomTypeId: z.uuid().nullable().default(null),
    startDate: localDateSchema,
    endDate: localDateSchema,
    scope: z.enum(STOP_SELL_SCOPES).default('ALL_CHANNELS'),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => before(v.startDate, v.endDate), {
    message: 'The end date must be after the start date',
    path: ['endDate'],
  });

export const stopSellListQuerySchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
});

export type CreateStopSellRequest = z.infer<typeof createStopSellSchema>;

export interface StopSellView {
  id: string;
  propertyId: string;
  roomTypeId: string | null;
  roomTypeName: string | null;
  startDate: string;
  endDate: string;
  scope: (typeof STOP_SELL_SCOPES)[number];
  reason: string | null;
  createdBy: UserRef | null;
  createdAt: string;
  liftedBy: UserRef | null;
  liftedAt: string | null;
}
