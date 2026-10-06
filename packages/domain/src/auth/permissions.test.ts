import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  SYSTEM_ROLES,
  isPermissionKey,
  permissionsFor,
  ungrantablePermissions,
  type PermissionKey,
} from './permissions.js';

const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!;

describe('permission catalogue', () => {
  it('gives Hotel Admin every tenant permission and nothing else', () => {
    expect([...role('HOTEL_ADMIN').permissions].sort()).toEqual(permissionsFor('TENANT').sort());
  });

  it('keeps every role inside its own context without duplicates', () => {
    for (const r of SYSTEM_ROLES) {
      expect(new Set(r.permissions).size).toBe(r.permissions.length);
      for (const p of r.permissions) expect(PERMISSIONS[p].context).toBe(r.context);
    }
  });

  it('keeps sensitive permissions away from default staff', () => {
    const staff = new Set(role('HOTEL_STAFF').permissions);
    for (const p of [
      'booking.cancel',
      'block.create',
      'agency.manage',
      'inventory.override',
      'user.manage',
      'booking.viewFinancials',
    ] as const) {
      expect(staff.has(p)).toBe(false);
    }
  });

  it('restricts agency.manage and inventory.override to admins by default', () => {
    expect(role('HOTEL_MANAGER').permissions).not.toContain('agency.manage');
    expect(role('HOTEL_MANAGER').permissions).not.toContain('inventory.override');
  });

  it('marks only support access as owner-only', () => {
    const ownerOnly = ALL_PERMISSION_KEYS.filter((k) => 'ownerOnly' in PERMISSIONS[k]);
    expect(ownerOnly).toEqual(['supportAccess.manage']);
  });

  it('recognises keys', () => {
    expect(isPermissionKey('booking.create')).toBe(true);
    expect(isPermissionKey('booking.delete')).toBe(false);
    expect(isPermissionKey('toString')).toBe(false);
  });
});

describe('ungrantablePermissions (PE-1)', () => {
  it('rejects permissions the grantor lacks or from another context', () => {
    const manager = new Set<PermissionKey>(role('HOTEL_MANAGER').permissions);
    expect(
      ungrantablePermissions(
        manager,
        ['booking.create', 'agency.manage', 'platform.stats.view'],
        'TENANT',
      ),
    ).toEqual(['agency.manage', 'platform.stats.view']);
  });
});
