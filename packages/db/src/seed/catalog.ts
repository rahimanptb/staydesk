import { PERMISSIONS, SYSTEM_ROLES, ALL_PERMISSION_KEYS } from '@staydesk/domain';
import type { PrismaClient } from '../generated/prisma/client.js';

export interface CatalogSeedResult {
  permissions: number;
  globalRoles: number;
}

/**
 * Upserts the permission catalogue and the global (platform/agency) system roles from code.
 * Idempotent; runs after every deploy as the schema owner. Tenant roles are created per tenant
 * when the tenant is created.
 */
export async function seedCatalog(db: PrismaClient): Promise<CatalogSeedResult> {
  for (const key of ALL_PERMISSION_KEYS) {
    const def = PERMISSIONS[key];
    await db.permission.upsert({
      where: { key },
      create: { key, context: def.context, category: def.category, description: def.description },
      update: { context: def.context, category: def.category, description: def.description },
    });
  }

  const globalRoles = SYSTEM_ROLES.filter((r) => r.context !== 'TENANT');
  for (const template of globalRoles) {
    const existing = await db.role.findFirst({ where: { tenantId: null, key: template.key } });
    const data = {
      context: template.context,
      name: template.name,
      isSystem: true,
      isEditable: template.editable,
    };
    if (existing) await db.role.update({ where: { id: existing.id }, data });
    else await db.role.create({ data: { ...data, key: template.key, tenantId: null } });
  }

  return { permissions: ALL_PERMISSION_KEYS.length, globalRoles: globalRoles.length };
}
