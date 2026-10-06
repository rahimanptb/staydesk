# Phase 7 — API Architecture

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` on each portal host (same origin). The version is in the path; breaking changes mean `/v2`. |
| Contract | OpenAPI 3.1 generated from Zod schemas (`packages/contracts`), published at `/api/v1/docs` (staff-auth only in production) |
| Tenant | **Derived from the session, never from the path or body.** Property IDs in the path are validated against membership scope. |
| IDs | UUIDv7 strings. Human references (`GOA-26-004217`) are searchable but not used as path keys. |
| Dates | Stay dates `YYYY-MM-DD` (property-local). Instants ISO-8601 UTC (`2026-10-05T09:12:00Z`). |
| Money | `{ "amountMinor": 1250000, "currency": "INR" }` |
| Pagination | Cursor: `?limit=50&cursor=…` → `{ data, nextCursor }`; max limit 200 |
| Filtering/sorting | Explicit allow-listed query params (`status=CONFIRMED,TENTATIVE&sort=-checkIn`) |
| Idempotency | `Idempotency-Key` header required on booking create/modify/cancel, block create, booking request create |
| Concurrency | Mutable resources return `ETag: "v7"`; `PATCH` requires `If-Match` → 412 on mismatch |
| CSRF | Unsafe methods need `X-CSRF-Token` (per-session) + same-origin `Origin` |
| Errors | RFC 9457 `application/problem+json` with stable `code` |
| Rate limits | `RateLimit-*` headers; 429 with `Retry-After` |

## 2. Error format

```json
{
  "type": "https://docs.staydesk.app/errors/no-availability",
  "title": "Not enough rooms available",
  "status": 409,
  "code": "NO_AVAILABILITY",
  "detail": "Deluxe Room is short by 1 room on 11 Oct 2026.",
  "requestId": "01J9Z6T3...",
  "errors": [],
  "meta": {
    "shortfall": [
      { "date": "2026-10-11", "roomTypeId": "…", "requested": 2, "available": 1 }
    ]
  }
}
```
Validation errors put field issues in `errors: [{ "path": "rooms[0].adults", "code": "too_big", "message": "Max 3 adults for Deluxe Room" }]`. Stack traces, SQL and internal identifiers never reach clients; they are logged with the `requestId`.

## 3. Endpoints

`P:` = required permission. Scoped = property in path must be in the user's scope (else 404).

### 3.1 Public and authentication (`/api/v1/auth`, `/api/v1/public`)
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}`. The portal is inferred from the host. → session cookie, or `{mfaRequired: true}` |
| POST | `/auth/mfa/verify` | TOTP or recovery code |
| POST | `/auth/logout` | Revokes the current session |
| GET | `/auth/session` | Principal: user, context, tenant/agency, permissions, property scope, CSRF token |
| POST | `/auth/context` | Switch tenant/agency within the same portal type (multi-membership) |
| POST | `/auth/password/forgot` | Always 202 |
| POST | `/auth/password/reset` | Token + new password; revokes all sessions |
| POST | `/auth/email/verify` | Token |
| GET / POST | `/auth/invitations/{token}` / `/accept` | Preview (minimal info) / accept |
| POST | `/auth/mfa/totp/setup`, `/enable`, `/disable` | Re-authentication required |
| GET / DELETE | `/auth/sessions`, `/auth/sessions/{id}` | P1 |
| POST | `/public/signup/hotel` | Self-signup (if enabled) |
| POST | `/public/signup/agency` | P1 |
| GET | `/public/plans` | Public plans and prices for the marketing site |

### 3.2 Hotel app (TENANT context)
| Method | Path | Permission |
|---|---|---|
| GET / PATCH | `/tenant` | `tenant.manage` (PATCH) |
| GET | `/tenant/subscription` | `subscription.view` |
| GET | `/dashboard?propertyId=` | `booking.view` (financial tiles need `booking.viewFinancials`) |
| GET / POST | `/properties` | `property.view` / `property.manage` |
| GET / PATCH | `/properties/{pid}` | `property.view` / `property.manage` · scoped |
| POST | `/properties/{pid}/archive` | `property.manage` |
| GET / POST / DELETE | `/properties/{pid}/holidays[/{id}]` | `property.view` / `property.manage` |
| GET / POST | `/properties/{pid}/room-types` | `roomType.view` / `roomType.manage` |
| GET / PATCH | `/properties/{pid}/room-types/{rtid}` | as above. Changing `totalInventory` runs the capacity check. |
| POST | `/properties/{pid}/room-types/{rtid}/archive` | `roomType.manage` |
| PUT | `/properties/{pid}/room-types/{rtid}/amenities` | `roomType.manage` |
| GET / POST | `/properties/{pid}/rooms` (POST supports bulk) | `room.view` / `room.manage` |
| PATCH / POST | `/properties/{pid}/rooms/{rid}`, `/archive` | `room.manage` |
| GET | `/properties/{pid}/room-status?date=` | `room.view` |
| GET | `/properties/{pid}/availability?from=&to=&roomTypeIds=` | `availability.view`. Grid, max 92 days. |
| POST | `/properties/{pid}/availability/check` | `availability.view`. Stay quote with per-night detail and occupancy fit. |
| GET / POST | `/properties/{pid}/blocks?kind=` | `block.view` / `block.create` (OOS: `room.outOfService`) |
| GET | `/properties/{pid}/blocks/{bid}` | `block.view` |
| POST | `/properties/{pid}/blocks/{bid}/release` | `block.release` (OOS: `room.outOfService`). Body `{fromDate?, quantity?, reason}`. |
| GET / POST | `/properties/{pid}/stop-sells`, `/{id}/lift` | `availability.view` / `stopSell.manage` |
| GET | `/properties/{pid}/bookings?status=&from=&to=&source=&agencyId=&q=` | `booking.view` |
| POST | `/properties/{pid}/bookings` | `booking.create` (+ `booking.backdate`, `inventory.override` when used) |
| GET | `/properties/{pid}/bookings/{bid}` | `booking.view` (field stripping by permission) |
| PATCH | `/properties/{pid}/bookings/{bid}` | `booking.edit` · If-Match |
| POST | `…/bookings/{bid}/confirm` | `booking.edit` (inquiry/tentative → confirmed) |
| POST | `…/bookings/{bid}/hold` | `booking.edit` (extend/set hold) |
| POST | `…/bookings/{bid}/cancel` | `booking.cancel`. Body `{lineIds?, reason}`. |
| POST | `…/bookings/{bid}/check-in`, `/check-out`, `/no-show` | `booking.frontDesk` |
| PUT / DELETE | `…/bookings/{bid}/rooms/{lineId}/assignment` | `booking.assignRoom` |
| GET | `…/bookings/{bid}/room-suggestions` | `booking.assignRoom` |
| GET | `…/bookings/{bid}/history` | `booking.view` |
| GET / POST | `…/bookings/{bid}/payments` | `booking.viewFinancials` / `payment.record` (P1) |
| GET | `/properties/{pid}/booking-calendar?from=&to=` | `booking.view` |
| GET / POST | `/guests?q=` | `guest.view` / `guest.manage` |
| GET / PATCH | `/guests/{gid}` | `guest.view` / `guest.manage` |
| POST | `/guests/{gid}/anonymize` | `guest.export` |
| GET / POST / PATCH | `/properties/{pid}/waitlist[/{id}]` | `waitlist.manage` (P1) |
| GET | `/properties/{pid}/agent-requests` | `agentRequest.process` (P1) |
| POST | `/properties/{pid}/agent-requests/{id}/decline` | `agentRequest.process` |
| POST | `/properties/{pid}/agent-requests/{id}/convert` | `agentRequest.process` + `booking.create` → runs booking create |
| GET | `/agencies?status=` | `agency.view` (returns the tenant's access records joined with the agency profile) |
| POST | `/agencies/invitations` | `agency.manage` |
| GET / PATCH | `/agencies/{accessId}` | `agency.view` / `agency.manage` · If-Match |
| PUT | `/agencies/{accessId}/scope` | `agency.manage`. Full replacement of the property/room type scope. |
| POST | `/agencies/{accessId}/approve`, `/reject`, `/suspend`, `/reactivate`, `/deactivate` | `agency.manage` |
| GET | `/users` | `user.view` |
| POST | `/users/invitations` | `user.manage` |
| PATCH | `/users/{membershipId}` | `user.manage` (role, scope; PE rules) |
| POST | `/users/{membershipId}/suspend`, `/reactivate`, `/revoke` | `user.manage` |
| GET / POST / PATCH / DELETE | `/roles[/{id}]` | `role.manage` (GET: `user.view`) |
| GET | `/permissions` | `user.view` |
| GET | `/reports/{reportKey}?…filters` | `report.view` (+ `report.financial` for amount columns) |
| POST | `/reports/{reportKey}/exports` | `report.export` → 202 `{exportId}` |
| GET | `/exports/{id}` | requester only → status + short-lived signed download URL |
| GET | `/audit-logs?from=&to=&actorId=&entityType=&entityId=&action=` | `auditLog.view` |
| GET / POST / PATCH | `/notifications`, `/notifications/{id}/read`, `/notifications/read-all` | own |
| GET / PUT | `/notification-preferences` | own |
| GET / POST | `/support-access`, `/{id}/revoke` | `supportAccess.manage` |
| POST | `/files/uploads` → presigned PUT; `POST /files/{id}/complete` | depends on purpose |

Report keys: `bookings`, `occupancy-daily`, `occupancy-monthly`, `availability`, `room-inventory`, `blocks`, `cancellations`, `no-shows`, `booking-sources`, `agent-activity`, `property-summary`, `room-types`, `audit`.

### 3.3 Agent portal (AGENCY context, `/api/v1/agent`)
| Method | Path | Permission / policy |
|---|---|---|
| GET | `/agent/me` | any agency member |
| GET / PATCH | `/agent/agency` | read: any member · write: `agency.profile.manage` |
| GET / POST / PATCH | `/agent/users[/{id}]` | `agency.users.manage` |
| GET | `/agent/dashboard` | `b2b.access.view` |
| GET | `/agent/properties` | `b2b.access.view`. Only properties with effective access (BR-17). |
| GET | `/agent/properties/{pid}` | effective access. Public profile + allowed room types (public fields only). |
| POST | `/agent/availability/search` | `b2b.availability.search` + BR-17. Projection by visibility. Logged. |
| GET | `/agent/searches/recent` | own |
| GET / POST | `/agent/requests` | `b2b.request.create` + access `canRequestBooking` (POST); list own, or agency-wide with `b2b.request.viewAgency` |
| GET | `/agent/requests/{id}` | own / agency-wide permission |
| POST | `/agent/requests/{id}/cancel` | own, while `PENDING` |
| POST | `/agent/access-requests` | `b2b.access.request` (P1) |

**Agent search request/response:**
```json
// POST /api/v1/agent/availability/search
{ "propertyId": "…", "checkIn": "2026-10-10", "checkOut": "2026-10-12",
  "rooms": 2, "adults": 4, "children": 1, "roomTypeId": null, "includeNightly": false }

// 200 — visibility FULL_BREAKDOWN (default)
{ "property": { "id": "…", "name": "Seaview Resort" },
  "stay": { "checkIn": "2026-10-10", "checkOut": "2026-10-12", "nights": 2 },
  "results": [
    { "roomType": { "id": "…", "name": "Deluxe Room", "maxOccupancy": 3 },
      "status": "AVAILABLE", "occupancyFits": true,
      "breakdown": { "total": 20, "booked": 12, "blocked": 2, "outOfService": 0, "available": 6 },
      "request": { "allowed": true, "pendingRequestId": null } },
    { "roomType": { "id": "…", "name": "Suite", "maxOccupancy": 4 },
      "status": "UNAVAILABLE", "occupancyFits": true,
      "breakdown": { "total": 4, "booked": 3, "blocked": 1, "outOfService": 0, "available": 0 },
      "request": { "allowed": false } }
  ] }
```
In `breakdown`, `booked` includes held, and the values are the **minimum-availability night's** figures. Per-night figures come with `includeNightly`.

Lower visibility levels replace `breakdown`:
- `EXACT_COUNT`: `"available": 6`
- `CAPPED_COUNT`: `"availableDisplay": "5+"`
- `STATUS_ONLY`: nothing beyond `status`

No other fields are ever returned.

### 3.4 Platform (PLATFORM context, `/api/v1/platform`)
| Method | Path | Permission |
|---|---|---|
| GET | `/platform/dashboard` | `platform.stats.view` |
| GET / POST | `/platform/tenants` | `platform.tenant.view` / `platform.tenant.manage` |
| GET / PATCH | `/platform/tenants/{id}` | as above |
| POST | `/platform/tenants/{id}/activate`, `/suspend`, `/deactivate` | `platform.tenant.manage` |
| GET | `/platform/tenants/{id}/usage` | `platform.tenant.view` (counts only) |
| PUT / DELETE | `/platform/tenants/{id}/entitlements/{key}` | `platform.subscription.manage` |
| POST | `/platform/tenants/{id}/owner-recovery` | `platform.user.manage` (verified process, audited, notifies all owners) |
| GET / POST / PATCH | `/platform/plans[/{id}]`, `/plans/{id}/entitlements`, `/plans/{id}/prices` | `platform.plan.manage` |
| POST / PATCH | `/platform/tenants/{id}/subscription` | `platform.subscription.manage` |
| GET / POST / PATCH | `/platform/users[/{id}]` | `platform.user.manage` |
| GET | `/platform/agencies` | `platform.agency.manage` |
| POST | `/platform/agencies/{id}/verify`, `/suspend`, `/reactivate` | `platform.agency.manage` |
| GET | `/platform/health` | `platform.health.view` |
| GET / PUT | `/platform/settings[/{key}]` | `platform.settings.manage` |
| GET | `/platform/audit-logs` | `platform.audit.view` |
| GET / POST | `/platform/support-sessions` | `platform.supportAccess.use` (needs an active tenant grant) |

## 4. Rate limits (initial)

| Route class | Limit |
|---|---|
| `POST /auth/login` | 5/min per account, 20/min per IP; progressive lockout after 10 failures (15 min) |
| Password forgot/reset, email verify | 3/h per email, 20/h per IP |
| Signup | 5/h per IP + bot protection |
| Agent availability search | 60/min per user, 2,000/day per agency (plan-configurable) |
| General authenticated | 600/min per user, 3,000/min per tenant |
| Exports | 10 concurrent per tenant |

## 5. Error catalogue

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Schema/field errors (`errors[]`) |
| `INVALID_DATE_RANGE` | 422 | Check-out ≤ check-in, or malformed |
| `DATE_IN_PAST` | 422 | Starts before business date without `booking.backdate` |
| `BEYOND_HORIZON` / `STAY_TOO_LONG` | 422 | Horizon / max stay exceeded |
| `OCCUPANCY_EXCEEDED` | 422 | Room type occupancy limits |
| `NO_AVAILABILITY` | 409 | Shortfall per night in `meta.shortfall` |
| `INVENTORY_CONFLICT` | 409 | Block/total change would push nights negative (`meta.nights`) |
| `CLOSED_FOR_SALE` | 409 | Stop-sell on requested nights |
| `DUPLICATE_BOOKING_SUSPECTED` | 409 | Matches in `meta.matches`; resend with `acknowledgeDuplicate: true` |
| `INVALID_STATUS_TRANSITION` | 409 | State machine violation |
| `CHECK_IN_NOT_ALLOWED` / `NO_SHOW_NOT_ALLOWED` | 409 | Front-desk action outside its allowed dates |
| `OVERSTAY_REQUIRES_EXTENSION` | 409 | Check-out after the departure date; extend the stay first |
| `ROOM_ASSIGNMENT_REQUIRED` | 409 | Tracked room type checked in without an assigned room |
| `ROOM_UNAVAILABLE` / `ROOM_UNAVAILABLE_FOR_NEW_DATES` | 409 | Exclusion constraint conflict on assignment |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different payload |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Original request still running |
| `PRECONDITION_FAILED` | 412 | `If-Match` version stale |
| `PRECONDITION_REQUIRED` | 428 | Missing `If-Match` / `Idempotency-Key` |
| `UNAUTHENTICATED` | 401 | No or invalid session |
| `CSRF_FAILED` | 403 | Missing/invalid CSRF token or cross-origin request |
| `MFA_REQUIRED` | 401 | Second factor needed |
| `FORBIDDEN` | 403 | Missing permission |
| `NOT_FOUND` | 404 | Not found **or belongs to another tenant/scope** (deliberately indistinguishable; logged as a security signal) |
| `TENANT_SUSPENDED` / `ACCOUNT_DISABLED` | 403 | Account state |
| `AGENCY_ACCESS_PENDING` / `_SUSPENDED` / `_EXPIRED` / `_REJECTED` | 403 | Agency access state (BR-17) |
| `PLAN_LIMIT_REACHED` / `FEATURE_NOT_IN_PLAN` | 403 | Entitlements (`meta.limit`, `meta.max`, `meta.current`) |
| `RATE_LIMITED` | 429 | `Retry-After` |
| `CONFLICT_RETRY` | 503 | Lock timeout/deadlock after server retries; safe to retry with the same Idempotency-Key |
| `INTERNAL_ERROR` | 500 | Generic message + `requestId` |

## 6. Future external API

The same contracts are exposed later to machine clients:
- **Agent API:** API keys bound to an agency, hashed, scoped, with rate plans. Same `/agent/*` endpoints.
- **Integration API:** OAuth2 client credentials per tenant connector, for channel managers, PMS and accounting.

They authenticate with `Authorization: Bearer`, are exempt from CSRF, and go through identical permission, scope and audit layers. Signed webhooks (HMAC-SHA256 with timestamp) are delivered from the outbox.
