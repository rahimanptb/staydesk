# Phase 2 — User Roles & Permissions

## 1. Three isolated contexts

Every authenticated session is bound to exactly **one** context. The context is chosen at login (or switched explicitly) and stored server-side on the session. Request input can never set or change it.

| Context | Portal host | Who | Data boundary |
|---|---|---|---|
| `PLATFORM` | `admin.<domain>` | SaaS operator staff | Tenant metadata, plans, aggregates. **No guest or booking data** (C11). |
| `TENANT` | `app.<domain>` | Hotel Admin, Manager, Staff, custom roles | One tenant; optionally limited to some properties |
| `AGENCY` | `agent.<domain>` | Travel Agent Admin, Travel Agent User | One agency + the tenant scopes granted to it |

A person with memberships in more than one context (e.g. hotel staff + agency user) holds a separate session per portal host. Cookies are host-only, so the sessions never mix.

## 2. Roles

| Role | Context | Editable? | Notes |
|---|---|---|---|
| **Super Admin** | PLATFORM | No | All platform permissions. 2FA mandatory. |
| Platform Support (P1) | PLATFORM | No | Read tenant metadata and health; may *use* tenant-issued support grants |
| **Hotel Admin** | TENANT | No (always all tenant permissions) | One or more per tenant. `isOwner` flag on ≥ 1 (BR-30). |
| **Hotel Manager** | TENANT | Permissions editable by Hotel Admin | System template, created per tenant |
| **Hotel Staff** | TENANT | Permissions editable by Hotel Admin | System template, created per tenant |
| Custom roles (P1) | TENANT | Yes | Created by Hotel Admin from the permission catalogue |
| **Travel Agent Admin** | AGENCY | No | Manages agency profile and agency users |
| **Travel Agent User** | AGENCY | No | Searches availability; submits requests if granted |

**Owner** is a flag on a Hotel Admin membership. Only owners can:
- add, remove or demote other Hotel Admins
- transfer ownership
- manage support-access grants
- request tenant closure

## 3. Tenant permission catalogue and defaults

Permissions are `resource.action` strings. They are defined once in `packages/domain/permissions.ts`, seeded into the `permission` table, and used identically by API guards and UI visibility.

| Permission | Allows | Admin | Manager | Staff |
|---|---|:-:|:-:|:-:|
| `tenant.manage` | Tenant profile, security policy (2FA enforcement) | ✓ | – | – |
| `subscription.view` | View plan, limits, usage | ✓ | – | – |
| `property.view` | View properties and settings | ✓ | ✓ | ✓ |
| `property.manage` | Create/edit/archive properties and settings, holidays | ✓ | – | – |
| `roomType.view` | View room types | ✓ | ✓ | ✓ |
| `roomType.manage` | Create/edit/archive room types, change total inventory | ✓ | ✓ | – |
| `room.view` | View rooms, room status board | ✓ | ✓ | ✓ |
| `room.manage` | Create/edit/archive rooms | ✓ | ✓ | – |
| `room.outOfService` | Create/release out-of-service | ✓ | ✓ | – |
| `availability.view` | Availability calendar, availability check | ✓ | ✓ | ✓ |
| `block.view` | View blocks | ✓ | ✓ | ✓ |
| `block.create` | Create blocks | ✓ | ✓ | – |
| `block.release` | Release blocks (full/partial) | ✓ | ✓ | – |
| `stopSell.manage` | Create/lift stop-sells | ✓ | ✓ | – |
| `inventory.override` | Exceed availability (only if tenant enabled overbooking) | ✓ | – | – |
| `booking.view` | View bookings, booking calendar | ✓ | ✓ | ✓ |
| `booking.create` | Create bookings | ✓ | ✓ | ✓ |
| `booking.edit` | Modify bookings (dates, rooms, guests, notes), extend holds | ✓ | ✓ | ✓ |
| `booking.cancel` | Cancel bookings or lines | ✓ | ✓ | – |
| `booking.frontDesk` | Check-in, check-out, no-show | ✓ | ✓ | ✓ |
| `booking.assignRoom` | Assign/unassign physical rooms | ✓ | ✓ | ✓ |
| `booking.backdate` | Create bookings starting before business date | ✓ | – | – |
| `booking.viewInternalNotes` | See internal notes | ✓ | ✓ | ✓ |
| `booking.viewFinancials` | See amounts and payment status | ✓ | ✓ | – |
| `payment.record` (P1) | Record payments, refunds, adjustments | ✓ | ✓ | – |
| `guest.view` | View guest PII | ✓ | ✓ | ✓ |
| `guest.manage` | Create/edit guests | ✓ | ✓ | ✓ |
| `guest.export` | Export guest PII; anonymise guests | ✓ | – | – |
| `waitlist.manage` (P1) | Create/manage waitlist entries | ✓ | ✓ | ✓ |
| `agentRequest.process` (P1) | Confirm/decline agent booking requests | ✓ | ✓ | – |
| `agency.view` | View travel agencies and their access | ✓ | ✓ | ✓ |
| `agency.manage` | Invite, approve, activate, suspend, deactivate, reject; set scope, validity, visibility | ✓ | – | – |
| `report.view` | Operational reports | ✓ | ✓ | – |
| `report.financial` | Reports that include amounts | ✓ | – | – |
| `report.export` | Export reports | ✓ | ✓ | – |
| `user.view` | View staff | ✓ | ✓ | – |
| `user.manage` | Invite, suspend, revoke staff; assign role and property scope | ✓ | – | – |
| `role.manage` | Edit role permissions, custom roles | ✓ | – | – |
| `auditLog.view` | View tenant audit log | ✓ | – | – |
| `supportAccess.manage` | Create/revoke support grants (owner only) | owner | – | – |

Why `agency.manage` is Admin-only by default: approving an agency *exposes data to a third party*. It stays assignable to other roles.

## 4. Agency permissions

| Permission | Agent Admin | Agent User |
|---|:-:|:-:|
| `agency.profile.manage` — edit agency profile | ✓ | – |
| `agency.users.manage` — invite/suspend agency users | ✓ | – |
| `b2b.access.view` — list hotels/properties granted | ✓ | ✓ |
| `b2b.availability.search` | ✓ | ✓ |
| `b2b.request.create` — submit booking requests (only where the hotel granted `canRequestBooking`) | ✓ | ✓ |
| `b2b.request.viewAgency` — see all agency requests (users always see their own) | ✓ | – |
| `b2b.access.request` (P1) — request access to discoverable properties | ✓ | – |

**Effective agent capability = agency role ∩ hotel's AgencyAccess grant ∩ scope ∩ validity.**

For example, an Agent User with `b2b.request.create` still can't request at Hotel 1 unless Hotel 1's access record has `canRequestBooking = true` and the room type is in scope.

### Scope example (from the brief)

| Access | Hotel 1 | Deluxe | Suite | Standard |
|---|---|---|---|---|
| Agent A | ✓ | ✓ | ✓ | – (not granted) |
| Agent B | ✓ | – | ✗ | ✓ |
| Agent C | ✗ (status `DEACTIVATED` or no property in scope) | – | – | – |

Stored as `agency_access_property(propertyId, allRoomTypes)` + `agency_access_room_type(roomTypeId)`. The default is **nothing**: an access record with no scope rows grants nothing.

## 5. Platform permissions

| Permission | Super Admin | Support (P1) |
|---|:-:|:-:|
| `platform.tenant.view` | ✓ | ✓ |
| `platform.tenant.manage` (create, activate, suspend, deactivate) | ✓ | – |
| `platform.plan.manage` | ✓ | – |
| `platform.subscription.manage` | ✓ | – |
| `platform.user.manage` (platform staff, tenant-owner recovery) | ✓ | – |
| `platform.agency.manage` (verify, suspend platform-wide) | ✓ | – |
| `platform.stats.view` | ✓ | ✓ |
| `platform.health.view` | ✓ | ✓ |
| `platform.settings.manage` | ✓ | – |
| `platform.audit.view` | ✓ | – |
| `platform.supportAccess.use` | ✓ | ✓ |

## 6. Authorization algorithm (server-side, every request)

```
1. Resolve session from host-only cookie → { userId, context, tenantId | agencyId, mfaOk }
   - Missing/expired/revoked → 401 UNAUTHENTICATED
   - Session context ≠ portal host context → 401 (prevents cross-portal cookie reuse)
2. Load principal (cached ≤ 30 s, invalidated on any membership/role change):
   - membership active? user active? tenant/agency active?   → 403 TENANT_SUSPENDED / ACCOUNT_DISABLED
   - 2FA required by policy but not verified this session     → 401 MFA_REQUIRED
3. Route declares @RequirePermission('booking.cancel') and @PropertyScoped('propertyId'):
   - permission ∈ role permissions?                            → else 403 FORBIDDEN
   - propertyId ∈ membership scope (or allProperties)?         → else 404 NOT_FOUND
     (404, not 403, so the existence of other properties isn't revealed)
4. Agency routes additionally run AgencyAccessPolicy (BR-17) per target property:
   - pending → 403 AGENCY_ACCESS_PENDING; suspended → 403 AGENCY_ACCESS_SUSPENDED;
     expired (business date > validTo, evaluated live) → 403 AGENCY_ACCESS_EXPIRED;
     property / room type out of scope → 404 NOT_FOUND
5. Plan entitlement checks on create/feature routes          → 403 PLAN_LIMIT_REACHED / FEATURE_NOT_IN_PLAN
6. Data access goes through the tenant-scoped DB client (RLS session variable set) —
   a forgotten check in steps 3–5 still cannot cross tenants.
7. Responses are serialised by audience-specific mappers (field-level: internal notes,
   financials, PII stripped unless the permission is held).
```

Endpoints default to **deny**: a route without a permission decorator fails CI (lint rule + startup assertion).

## 7. Privilege-escalation rules

- **PE-1** A user can grant only permissions they hold. Only Hotel Admins can edit roles.
- **PE-2** No one can modify their own role, scope or membership status.
- **PE-3** Only owners can create, demote or remove Hotel Admins. The last owner can't be removed or demoted (BR-30).
- **PE-4** Role or permission changes take effect on the next request: the principal cache is invalidated and the user's sessions are re-evaluated. Revoking a membership revokes its sessions.
- **PE-5** Every role, permission, scope and membership change is audit-logged with before/after values.
- **PE-6** The platform context can't call tenant endpoints. Support access issues a *separate, short-lived* tenant-context session flagged `supportGrantId`, read-only unless the grant says otherwise. Every action it takes is audited and shown to the tenant.
- **PE-7** Agency users can never hold tenant permissions through an agency session, whatever their other memberships.
