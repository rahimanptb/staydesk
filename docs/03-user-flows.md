# Phase 4 — User Flows

Each flow lists the happy path, then the errors and edge cases it must handle. Error codes are defined in [06-api-architecture.md](06-api-architecture.md#5-error-catalogue).

---

## F1. Hotel onboarding

Two entry points; which is enabled is a platform setting.

**A. Created by Super Admin**
1. Super Admin → Tenants → New: name, country, plan, trial end, owner name/email.
2. The system creates the tenant (`ACTIVE`), its subscription, its system roles (Admin/Manager/Staff copied from templates), and an owner invitation token (72 h).
3. The owner receives the invite email → sets password → verifies email (implicitly, by using the invite link) → lands in the setup wizard (F2).

**B. Public self-signup** (`/signup` on the marketing site)
1. Visitor enters hotel/company name, country, name, email, password, and accepts the terms.
2. A rate limit and bot protection apply. The response is generic whether or not the email exists (no account enumeration).
3. The verification email is sent. On verification, the tenant is created as `PENDING` (approval mode) or `ACTIVE` with a trial (trial mode).
4. In approval mode, Super Admin reviews and activates the tenant; the owner is notified.

Edge cases:
- The email already has a user → the invite or signup links to the existing identity after they log in.
- The invite link has expired → the owner can request a new one.

## F2. First-run setup wizard (Hotel Admin)

Wizard steps: **Property → Room types → Rooms (optional) → Staff → Travel agents → Done**. Each step can be skipped and resumed from a dashboard checklist.

1. **Property:** name, type, address, country, **timezone** (pre-filled from country, must be confirmed), **currency**, check-in/out times, child age limit.
2. **Room types:** name, code, occupancy limits, total inventory, base rate (optional), "track individual rooms?"
3. **Rooms:** bulk add ("101–120 on floor 1 → Deluxe"). Total inventory is then derived from rooms.
4. **Staff:** invite by email with a role and property scope.
5. **Travel agents:** invite an agency by email (F10), or skip.

Plan limits are enforced at each step (properties, rooms, staff, agencies). If the limit is reached, show `PLAN_LIMIT_REACHED` with an upgrade CTA.

## F3. Staff invitation

1. Admin → Users → Invite: email, role, property scope (all or a selection).
2. The invitation is created (hashed token, 72 h) and emailed. Audit: `user.invited`.
3. The invitee opens the link:
   - A new user sets name and password.
   - An existing user logs in and accepts.
4. The membership becomes `ACTIVE`, the invitee is notified, the admin gets an in-app notification.

Edge cases:
- Re-invite revokes the previous token.
- Revoking a pending invite makes the link fail with a generic "invitation no longer valid".

## F4. Create booking (staff): primary operational flow

```mermaid
sequenceDiagram
  actor S as Staff
  participant UI as Hotel App
  participant API as API (BookingService)
  participant DB as PostgreSQL
  S->>UI: Pick property, dates, rooms (type × qty, occupancy)
  UI->>API: POST /availability/check
  API->>DB: read inventory_day (no locks)
  API-->>UI: per-night availability, fits, stop-sells
  S->>UI: Guest (search or new), source, notes, status (Confirmed/Tentative/Inquiry)
  UI->>API: POST /bookings  (Idempotency-Key)
  API->>API: authz, validation, business rules, duplicate check
  API->>DB: BEGIN; set tenant ctx; lock room types; lock inventory_day rows (ordered)
  API->>DB: recheck availability → update counters (CHECK constraint backstop)
  API->>DB: insert guest/booking/lines/allocations, reference, audit, outbox
  API->>DB: COMMIT
  API-->>UI: 201 booking (reference)
  Note over API: worker sends notifications from outbox
```

1. **Availability check** (no locks): a per-night table for each requested type, an occupancy-fit check, and warnings (low availability, stop-sell).
2. **Guest:** search existing guests by name/email/phone, or create a new one. Fields: name, phone, email, country.
3. **Details:** source (Direct / Travel agent → select agency / OTA → name / Corporate / Walk-in), special requests, internal notes, status, agreed total (if `booking.viewFinancials`).
4. **Submit:** the server re-runs everything under lock (Phase 10).
5. **Success:** booking page with reference. Toast: "Booking GOA-26-004217 confirmed".

Errors:

| Situation | Response | UX |
|---|---|---|
| Dates invalid / in past / beyond horizon / too long | 422 `INVALID_DATE_RANGE` etc. | Inline field error |
| Occupancy exceeds room type | 422 `OCCUPANCY_EXCEEDED` | Inline on the room line |
| Someone took the last room meanwhile | 409 `NO_AVAILABILITY` + shortfall per night | Banner showing which nights are short. Offers: change dates/type, create Tentative elsewhere, add to waitlist. |
| Possible duplicate | 409 `DUPLICATE_BOOKING_SUSPECTED` + matches | Dialog listing matches; "Create anyway" resubmits with `acknowledgeDuplicate` |
| Stop-sell on a night | 409 `CLOSED_FOR_SALE` | Banner. Override offered only if the user holds `inventory.override`. |
| Double-click / network retry | Same Idempotency-Key → original 201 | Nothing visible |
| Lock timeout under heavy contention | 503 `CONFLICT_RETRY` (after 3 server retries) | "Please try again" with retry button |

## F5. Modify booking

1. Open the booking → Edit. Fields that can change depend on status (Phase 10 §4).
2. Changing dates, room types or rooms shows a **diff preview**: nights added/removed per type and availability for the added nights.
3. Save sends `PATCH` with `If-Match: <version>`.
   - Stale version → 412: "This booking was changed by Priya at 14:02. Reload?"
4. The server releases the old footprint and consumes the new one atomically (BR-16). If an added night isn't available, nothing changes (409).
5. If the stay moves and the assigned rooms are no longer free → 409 `ROOM_UNAVAILABLE_FOR_NEW_DATES`, with an option to unassign.

## F6. Cancel booking (full or selected rooms)

1. Cancel → choose all rooms or selected lines → reason (required; list + free text) → confirm.
2. Releases nights ≥ business date. Past nights remain as history.
3. Notifications are sent; waitlist entries matching the freed inventory are flagged (P1).
4. A cancelled booking is read-only, except internal notes (and payments, P1).

## F7. Front desk: check-in, check-out, no-show

- **Check-in:** allowed when status is `CONFIRMED` and arrival ≤ business date < departure.
  - Tracked room types must have rooms assigned; the room-suggestion dialog appears inline.
- **Check-out:** from `CHECKED_IN`.
  - If business date < departure → **early departure** confirmation; nights from the business date are released.
  - If business date > departure (overstay) → staff must extend the stay first (modification with availability check).
- **No-show:** from `CONFIRMED` once business date ≥ arrival. Releases nights ≥ business date.

## F8. Block rooms / release

1. Blocks → New: property, room type, (optional specific room for tracked types), quantity, from/to dates (to = exclusive, shown as "until and including the night of X−1"), reason, notes.
2. Preview: per-night availability before and after.
   - Exceeding availability → 409 `INVENTORY_CONFLICT` with the nights.
   - With `inventory.override`, offer "Block anyway" + reason.
3. **Release:** full, partial by date ("release from 12 Oct"), or partial by quantity (reduces quantity for the remaining nights).

## F9. Out of service

Same as F8 with kind `OUT_OF_SERVICE` and permission `room.outOfService`. For tracked types, OOS is normally room-specific (Room 104, plumbing, 3–7 Oct). OOS appears separately in the calendar, reports and the agent `FULL_BREAKDOWN` view.

## F10. Invite and activate a travel agency (hotel side)

1. Travel Agents → Invite: agency email, contact name, optional agency name, plus the initial scope (properties, room types), validity, visibility, request permission, and private notes.
2. The system creates `agency_access` with status **`PENDING`** (inactive by default):
   - If the email belongs to an existing agency user, the access links to that agency and its admins are notified.
   - Otherwise an agency invitation is sent. The invitee creates the agency (profile + admin user) on the agent portal.
3. The hotel admin sees the access as *Pending — awaiting agency* or *Pending — awaiting your approval*. They press **Approve & Activate** (or Reject).
4. Status becomes `ACTIVE` once approved and inside the validity window. The agency is notified. Audit: "Admin Z activated Travel Agent ABC".
5. Later: Suspend (reason, instant effect), Reactivate, Deactivate (permanent; a new invite is needed to restore), change scope/validity/visibility (instant effect).

## F11. Agency self-registration and access request (P1)

1. Agent portal → Sign up: agency details, admin user, email verification.
2. The agency is `PENDING_VERIFICATION` on the platform until verified (platform setting: auto or manual).
3. Agency admin → "Request access" → search **discoverable** properties only (opt-in per property) → request.
4. This creates `agency_access` `PENDING` in that tenant → the hotel admin is notified → approve/reject (F10 step 3).

## F12. Agent availability search

1. Log in on `agent.<domain>`. The dashboard shows authorised properties (cards: name, location, image) and recent searches.
2. Search form: hotel/resort (only authorised ones), check-in, check-out, rooms, adults, children, room type (only authorised ones, optional).
3. The server applies BR-17 → computes availability → projects by visibility level → logs the search.
4. Results table, one row per authorised room type:

   | Room type | Total | Booked | Blocked | OOS | Available | Status | Request |
   |---|---|---|---|---|---|---|---|
   | Deluxe Room | 20 | 12 | 2 | 0 | 6 | Available | Request booking |
   | Suite | 4 | 2 | 1 | 0 | 1 | Limited | Request booking |
   | Family Room | 6 | 6 | 0 | 0 | 0 | Unavailable | "Currently unavailable" |

   This is the default `FULL_BREAKDOWN` view; counts are for the lowest-availability night of the stay. If the hotel lowered this agency's visibility level, the count columns become a single "Availability" column ("5+ available") or disappear (status only).
5. The per-night detail expands under each row (same visibility rules).

Errors:
- Access expired → full-page state "Your access to Hotel X expired on 30 Sep. Contact the hotel." (403 `AGENCY_ACCESS_EXPIRED`)
- Suspended → similar page.
- Rate limited → "Too many searches, try again in a minute."

## F13. Agent booking request → hotel confirmation (P1)

1. From a result row: Request booking → guest name, contact (optional), rooms, occupancy, notes to the hotel.
2. A `booking_request` is created as `PENDING` (no inventory consumed). The agent sees reference `REQ-…`. The hotel gets in-app + email notification.
3. Hotel staff with `agentRequest.process` open the request.
   - **Confirm** opens the booking form prefilled (source = Travel agent, agency linked) → normal F4 → request `CONFIRMED`, linked to the booking reference.
   - **Decline** (with a message the agent can see).
4. Requests not handled by `expiresAt` (default 24 h) become `EXPIRED`; the agent is notified.
5. The agent sees status, hotel message and booking reference only — never internal notes, rates or other bookings.

## F14. Expiry and suspension take effect

- Expiry is evaluated live on every agent request (BR-17). An hourly job also updates the stored status to `EXPIRED` and notifies both sides 7 days before and on expiry.
- Suspending an agency, or deactivating an agency user, takes effect on the next request: the principal cache is invalidated and the user's sessions are revoked.

## F15. Waitlist / "Currently unavailable" (P1)

1. Availability check returns 0 → the UI shows "Currently unavailable" and, if permitted, "Add to waitlist".
2. Entry: property, type (optional), dates, rooms, occupancy, contact, notes. No inventory is consumed.
3. On any release event (cancellation, block release, total increase, hold expiry) the worker matches open entries whose full stay is now available → status `NOTIFIED` + notification to the owner. Staff then create the booking normally.

## F16. Password reset

1. Forgot password → enter email → always "If an account exists, we've emailed a link" (rate-limited: 3/h per email, 20/h per IP).
2. A single-use token (hashed in the database, 30 min) is emailed.
3. Reset → password-policy check → hash → **revoke all sessions** → notification email "Your password was changed".

## F17. Support access (P1)

1. Tenant owner → Settings → Support access → Grant: platform staff (or "any support agent"), duration (max 72 h), scope (read-only default), reason.
2. The platform user sees active grants → "Open support session" → gets a short-lived tenant session with a banner "Support session — all actions are logged".
3. The owner can revoke at any time. The audit log is visible to the tenant.

## F18. Plan limit reached

- Creating a resource beyond its limit → 403 `PLAN_LIMIT_REACHED` `{limit: "rooms", max: 50, current: 50}` → UI dialog with usage and upgrade CTA.
- **Downgrade below current usage:** nothing is deleted. Creation stays blocked until usage is under the limit. Existing resources stay readable.
