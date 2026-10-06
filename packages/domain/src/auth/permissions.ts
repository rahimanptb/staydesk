/**
 * The permission catalogue (docs/02-roles-and-permissions.md). Single source of truth for API
 * guards, UI visibility and database seeding.
 */

export type RoleContext = 'PLATFORM' | 'TENANT' | 'AGENCY';

export interface PermissionDefinition {
  context: RoleContext;
  category: string;
  description: string;
  /** Additionally requires the membership's owner flag. */
  ownerOnly?: boolean;
}

export const PERMISSIONS = {
  // Tenant — account
  'tenant.manage': {
    context: 'TENANT',
    category: 'Account',
    description: 'Edit tenant profile and security policy',
  },
  'subscription.view': {
    context: 'TENANT',
    category: 'Account',
    description: 'View plan, limits and usage',
  },
  'supportAccess.manage': {
    context: 'TENANT',
    category: 'Account',
    description: 'Grant and revoke support access',
    ownerOnly: true,
  },
  // Tenant — properties and inventory
  'property.view': {
    context: 'TENANT',
    category: 'Properties',
    description: 'View properties and settings',
  },
  'property.manage': {
    context: 'TENANT',
    category: 'Properties',
    description: 'Create, edit and archive properties, settings and holidays',
  },
  'roomType.view': { context: 'TENANT', category: 'Inventory', description: 'View room types' },
  'roomType.manage': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'Create, edit and archive room types; change total inventory',
  },
  'room.view': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'View rooms and the room status board',
  },
  'room.manage': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'Create, edit and archive rooms',
  },
  'room.outOfService': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'Create and release out-of-service periods',
  },
  'availability.view': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'View availability calendar and check availability',
  },
  'block.view': { context: 'TENANT', category: 'Inventory', description: 'View room blocks' },
  'block.create': { context: 'TENANT', category: 'Inventory', description: 'Create room blocks' },
  'block.release': { context: 'TENANT', category: 'Inventory', description: 'Release room blocks' },
  'stopSell.manage': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'Create and lift stop-sells',
  },
  'inventory.override': {
    context: 'TENANT',
    category: 'Inventory',
    description: 'Exceed availability or sell into a stop-sell, with a reason',
  },
  // Tenant — bookings
  'booking.view': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'View bookings and the booking calendar',
  },
  'booking.create': { context: 'TENANT', category: 'Bookings', description: 'Create bookings' },
  'booking.edit': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Modify bookings and extend holds',
  },
  'booking.cancel': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Cancel bookings or rooms',
  },
  'booking.frontDesk': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Check in, check out, mark no-show',
  },
  'booking.assignRoom': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Assign and unassign physical rooms',
  },
  'booking.backdate': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Create bookings starting before the business date',
  },
  'booking.viewInternalNotes': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'See internal notes',
  },
  'booking.viewFinancials': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'See amounts and payment status',
  },
  'payment.record': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Record payments, refunds and adjustments',
  },
  'guest.view': { context: 'TENANT', category: 'Guests', description: 'View guest personal data' },
  'guest.manage': { context: 'TENANT', category: 'Guests', description: 'Create and edit guests' },
  'guest.export': {
    context: 'TENANT',
    category: 'Guests',
    description: 'Export and anonymise guest data',
  },
  'waitlist.manage': {
    context: 'TENANT',
    category: 'Bookings',
    description: 'Manage waitlist entries',
  },
  'agentRequest.process': {
    context: 'TENANT',
    category: 'Travel agents',
    description: 'Confirm or decline agent booking requests',
  },
  // Tenant — travel agents
  'agency.view': {
    context: 'TENANT',
    category: 'Travel agents',
    description: 'View travel agencies and their access',
  },
  'agency.manage': {
    context: 'TENANT',
    category: 'Travel agents',
    description: 'Invite, approve, suspend and scope travel agencies',
  },
  // Tenant — reports, people, audit
  'report.view': {
    context: 'TENANT',
    category: 'Reports',
    description: 'View operational reports',
  },
  'report.financial': {
    context: 'TENANT',
    category: 'Reports',
    description: 'View reports that include amounts',
  },
  'report.export': { context: 'TENANT', category: 'Reports', description: 'Export reports' },
  'user.view': { context: 'TENANT', category: 'Users', description: 'View staff' },
  'user.manage': {
    context: 'TENANT',
    category: 'Users',
    description: 'Invite, suspend and revoke staff; assign roles and scope',
  },
  'role.manage': {
    context: 'TENANT',
    category: 'Users',
    description: 'Edit role permissions and custom roles',
  },
  'auditLog.view': { context: 'TENANT', category: 'Audit', description: 'View the audit log' },

  // Agency
  'agency.profile.manage': {
    context: 'AGENCY',
    category: 'Agency',
    description: 'Edit the agency profile',
  },
  'agency.users.manage': {
    context: 'AGENCY',
    category: 'Agency',
    description: 'Invite and suspend agency users',
  },
  'b2b.access.view': {
    context: 'AGENCY',
    category: 'Availability',
    description: 'List hotels the agency can access',
  },
  'b2b.availability.search': {
    context: 'AGENCY',
    category: 'Availability',
    description: 'Search availability',
  },
  'b2b.request.create': {
    context: 'AGENCY',
    category: 'Requests',
    description: 'Submit booking requests where the hotel allows it',
  },
  'b2b.request.viewAgency': {
    context: 'AGENCY',
    category: 'Requests',
    description: "See all of the agency's booking requests",
  },
  'b2b.access.request': {
    context: 'AGENCY',
    category: 'Availability',
    description: 'Request access to discoverable properties',
  },

  // Platform
  'platform.tenant.view': {
    context: 'PLATFORM',
    category: 'Tenants',
    description: 'View tenants and usage',
  },
  'platform.tenant.manage': {
    context: 'PLATFORM',
    category: 'Tenants',
    description: 'Create, activate, suspend and deactivate tenants',
  },
  'platform.plan.manage': {
    context: 'PLATFORM',
    category: 'Billing',
    description: 'Manage plans, entitlements and prices',
  },
  'platform.subscription.manage': {
    context: 'PLATFORM',
    category: 'Billing',
    description: 'Manage tenant subscriptions and overrides',
  },
  'platform.user.manage': {
    context: 'PLATFORM',
    category: 'Users',
    description: 'Manage platform staff; tenant owner recovery',
  },
  'platform.agency.manage': {
    context: 'PLATFORM',
    category: 'Agencies',
    description: 'Verify and suspend agencies platform-wide',
  },
  'platform.stats.view': {
    context: 'PLATFORM',
    category: 'Monitoring',
    description: 'View platform statistics',
  },
  'platform.health.view': {
    context: 'PLATFORM',
    category: 'Monitoring',
    description: 'View system health',
  },
  'platform.settings.manage': {
    context: 'PLATFORM',
    category: 'Settings',
    description: 'Manage platform settings',
  },
  'platform.audit.view': {
    context: 'PLATFORM',
    category: 'Audit',
    description: 'View the platform audit log',
  },
  'platform.supportAccess.use': {
    context: 'PLATFORM',
    category: 'Support',
    description: 'Open support sessions on tenant-issued grants',
  },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function permissionsFor(context: RoleContext): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((k) => PERMISSIONS[k].context === context);
}

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}

export interface SystemRoleTemplate {
  key: string;
  context: RoleContext;
  name: string;
  /** Hotel Admins may edit this role's permissions. */
  editable: boolean;
  permissions: readonly PermissionKey[];
}

const MANAGER_PERMISSIONS: PermissionKey[] = [
  'property.view',
  'roomType.view',
  'roomType.manage',
  'room.view',
  'room.manage',
  'room.outOfService',
  'availability.view',
  'block.view',
  'block.create',
  'block.release',
  'stopSell.manage',
  'booking.view',
  'booking.create',
  'booking.edit',
  'booking.cancel',
  'booking.frontDesk',
  'booking.assignRoom',
  'booking.viewInternalNotes',
  'booking.viewFinancials',
  'payment.record',
  'guest.view',
  'guest.manage',
  'waitlist.manage',
  'agentRequest.process',
  'agency.view',
  'report.view',
  'report.export',
  'user.view',
];

const STAFF_PERMISSIONS: PermissionKey[] = [
  'property.view',
  'roomType.view',
  'room.view',
  'availability.view',
  'block.view',
  'booking.view',
  'booking.create',
  'booking.edit',
  'booking.frontDesk',
  'booking.assignRoom',
  'booking.viewInternalNotes',
  'guest.view',
  'guest.manage',
  'waitlist.manage',
  'agency.view',
];

/** Seeded per tenant (tenant roles) or once (platform and agency roles). */
export const SYSTEM_ROLES: readonly SystemRoleTemplate[] = [
  {
    key: 'SUPER_ADMIN',
    context: 'PLATFORM',
    name: 'Super Admin',
    editable: false,
    permissions: permissionsFor('PLATFORM'),
  },
  {
    key: 'PLATFORM_SUPPORT',
    context: 'PLATFORM',
    name: 'Platform Support',
    editable: false,
    permissions: [
      'platform.tenant.view',
      'platform.stats.view',
      'platform.health.view',
      'platform.supportAccess.use',
    ],
  },
  {
    key: 'HOTEL_ADMIN',
    context: 'TENANT',
    name: 'Hotel Admin',
    editable: false,
    permissions: permissionsFor('TENANT'),
  },
  {
    key: 'HOTEL_MANAGER',
    context: 'TENANT',
    name: 'Hotel Manager',
    editable: true,
    permissions: MANAGER_PERMISSIONS,
  },
  {
    key: 'HOTEL_STAFF',
    context: 'TENANT',
    name: 'Hotel Staff',
    editable: true,
    permissions: STAFF_PERMISSIONS,
  },
  {
    key: 'TRAVEL_AGENT_ADMIN',
    context: 'AGENCY',
    name: 'Travel Agent Admin',
    editable: false,
    permissions: permissionsFor('AGENCY'),
  },
  {
    key: 'TRAVEL_AGENT_USER',
    context: 'AGENCY',
    name: 'Travel Agent User',
    editable: false,
    permissions: ['b2b.access.view', 'b2b.availability.search', 'b2b.request.create'],
  },
];

/**
 * Privilege-escalation guard (PE-1): a grantor may only grant permissions they hold,
 * and only permissions of the role's context. Returns the offending keys.
 */
export function ungrantablePermissions(
  grantorPermissions: ReadonlySet<PermissionKey>,
  requested: readonly PermissionKey[],
  context: RoleContext,
): PermissionKey[] {
  return requested.filter((p) => !grantorPermissions.has(p) || PERMISSIONS[p].context !== context);
}
