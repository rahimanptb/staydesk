import { DomainError } from '../errors.js';
import { LocalDate } from '../dates/local-date.js';
import type { InventoryBucket, InventoryDelta } from './inventory.js';

/** Blocks and out-of-service periods (docs/08 §7, BR-08). */

export type BlockKind = 'BLOCK' | 'OUT_OF_SERVICE';

export function bucketOfBlock(kind: BlockKind): InventoryBucket {
  return kind === 'BLOCK' ? 'BLOCKED' : 'OUT_OF_SERVICE';
}

export interface BlockState {
  roomTypeId: string;
  kind: BlockKind;
  quantity: number;
  startDate: LocalDate;
  /** Exclusive. */
  endDate: LocalDate;
}

export interface BlockReleaseRequest {
  /** First night to release; defaults to the business date (or the block's start if later). */
  fromDate?: LocalDate;
  /** Rooms to release; defaults to all of them. */
  quantity?: number;
}

export interface BlockReleasePlan {
  /** First night actually released. */
  from: LocalDate;
  /** Rooms released per night. */
  quantity: number;
  /** Inventory to give back: −quantity over [from, endDate). */
  delta: InventoryDelta;
  /** The existing row afterwards. */
  original: { endDate: LocalDate; quantity: number; released: boolean };
  /**
   * When some rooms of a block that has already started are released, the original row ends at
   * `from` (history stays exact) and the rooms still blocked continue as a new row.
   */
  remainder: { startDate: LocalDate; endDate: LocalDate; quantity: number } | null;
}

/**
 * Plans a full or partial release (by date and/or quantity). Past nights are never released:
 * they are history and feed occupancy reports.
 */
export function planBlockRelease(
  block: BlockState,
  request: BlockReleaseRequest,
  businessDate: LocalDate,
): BlockReleasePlan {
  if (request.fromDate?.isBefore(businessDate)) {
    throw new DomainError(
      'DATE_IN_PAST',
      `Nights before today (${businessDate}) cannot be released`,
      { fromDate: request.fromDate.toString(), businessDate: businessDate.toString() },
    );
  }
  const from = LocalDate.max(request.fromDate ?? businessDate, block.startDate);
  if (!from.isBefore(block.endDate)) {
    throw new DomainError(
      'INVALID_DATE_RANGE',
      `This block has no nights left to release from ${from}`,
      { from: from.toString(), endDate: block.endDate.toString() },
    );
  }
  const quantity = request.quantity ?? block.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > block.quantity) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Release between 1 and ${block.quantity} room${block.quantity === 1 ? '' : 's'}`,
      { quantity, blockQuantity: block.quantity },
    );
  }

  const delta: InventoryDelta = {
    roomTypeId: block.roomTypeId,
    from,
    to: block.endDate,
    bucket: bucketOfBlock(block.kind),
    quantity: -quantity,
  };

  if (quantity === block.quantity) {
    return {
      from,
      quantity,
      delta,
      original: { endDate: from, quantity: block.quantity, released: true },
      remainder: null,
    };
  }
  if (from.equals(block.startDate)) {
    // Nothing has been used yet: reduce in place.
    return {
      from,
      quantity,
      delta,
      original: { endDate: block.endDate, quantity: block.quantity - quantity, released: false },
      remainder: null,
    };
  }
  return {
    from,
    quantity,
    delta,
    original: { endDate: from, quantity: block.quantity, released: true },
    remainder: { startDate: from, endDate: block.endDate, quantity: block.quantity - quantity },
  };
}
