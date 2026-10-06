import { LocalDate } from '@staydesk/domain';
import type { DbTransaction, Property } from '@staydesk/db';
import type { Principal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';

/**
 * Loads a property the principal may work with: same tenant (also enforced by RLS), inside the
 * member's property scope, not archived. Anything else is NOT_FOUND, so out-of-scope
 * properties are indistinguishable from non-existent ones (docs/02 §6 step 3).
 */
export async function requireProperty(
  tx: DbTransaction,
  principal: Principal,
  propertyId: string,
): Promise<Property> {
  if (!principal.allProperties && !principal.propertyIds.includes(propertyId)) {
    throw new ApiError('NOT_FOUND', 'No such property');
  }
  const property = await tx.property.findFirst({
    where: { id: propertyId, tenantId: principal.tenantId!, archivedAt: null },
  });
  if (!property) throw new ApiError('NOT_FOUND', 'No such property');
  return property;
}

/** Today in the property's time zone (BR-03). */
export function businessDateOf(property: Pick<Property, 'timezone'>): LocalDate {
  return LocalDate.todayIn(property.timezone);
}

export const userActor = (p: Principal) => ({
  type: 'USER' as const,
  userId: p.userId,
  supportGrantId: p.supportGrantId,
});
