# Phase 1 & 3 — Product Requirements, Business Rules, Feature List

Product working name: **StayDesk**: a multi-tenant SaaS for hotel/resort room inventory, bookings, and B2B travel-agent availability.

---

## 1. Vision and scope

StayDesk gives hotel and resort operators one trustworthy source of truth for **what can be sold, on which night, to whom**. It also lets them open a controlled, read-mostly window of that truth to the travel agencies they choose.

What it is (v1):

- Room-type inventory + optional physical-room layer
- Date-wise availability engine with database-enforced overbooking protection
- Reservations (inquiry → tentative → confirmed → in-house → departed), blocks, out-of-service
- Availability calendar and reservation calendar (tape chart)
- B2B agent portal: availability search, optional booking *requests*
- Staff RBAC, audit trail, notifications, reports, subscription plans with configurable limits

What it is **not** in v1 (designed for, not built): rate/pricing engine, OTA/channel-manager connectivity, payment gateway, invoicing/GST/Tally, housekeeping workflows, POS, guest-facing booking engine, mobile apps.

---

## 2. Glossary (used consistently in all documents and code)

| Term | Meaning |
|---|---|
| **Tenant** | The paying customer account (a hotel company / owner). Owns users, subscription, agency relationships. |
| **Property** | One hotel or resort belonging to a tenant. Owns inventory, bookings, timezone, currency. |
| **Room type** | A sellable category (Deluxe, Villa…). Availability is always counted per room type. |
| **Room** | Optional physical unit (101, 102) belonging to a room type. |
| **Stay** | Half-open date interval `[checkIn, checkOut)`. |
| **Night** | A calendar date `d` with `checkIn ≤ d < checkOut`. |
| **Business date** | "Today" in the property's timezone. |
| **Inventory day** | Per room type, per date: total, booked, held, blocked, out-of-service. |
| **Held** | Inventory consumed by a *tentative* booking until its hold expires. |
| **Block** | Inventory withheld from sale for a business reason (owner use, group, VIP…). |
| **Out of service (OOS)** | Inventory physically unusable (maintenance, renovation). Reported separately from blocks. |
| **Stop-sell / Closure** | A rule that stops *selling* on a channel without consuming inventory. |
| **Agency** | A travel-agency organisation (platform-level identity, one login across hotels). |
| **Agency access** | One tenant's relationship with one agency: status, validity, scope, visibility. |
| **Booking request** | An agent's request to book. It consumes nothing until hotel staff confirm it. |

---

## 3. Challenged requirements: risks and decisions

Each item states what was asked, the risk, and the professional approach adopted.

**C1. "Hotel" used as the tenant.**
*Risk:* hotel groups own several properties. Tying users, subscription and agents to one hotel forces duplicate accounts.
*Decision:* **Tenant = customer account; Property = hotel/resort.** A single hotel is a tenant with one property. Inventory, bookings and timezone live on the property. Users, roles, subscription and agency relationships live on the tenant. Staff can be scoped to specific properties.

**C2. Travel agents as per-hotel records.**
*Risk:* an agency working with 30 hotels would need 30 logins. If agents were global records instead, hotels could see each other's notes and statuses.
*Decision:* **Agency is a platform identity; `AgencyAccess` is a per-tenant relationship** holding status, validity, scope, visibility and the hotel's private notes. A hotel never learns which other hotels an agency works with. The agency edits its own profile; hotels see it read-only. Hotels invite agencies by email. Agency self-signup + "request access" to *discoverable* properties is off by default per property.

**C3. Room status "Occupied / Reserved" as a stored field.**
*Risk:* one mutable status contradicts date-wise truth. A room can be reserved for 10 Oct and free on 5 Oct, and a stored status drifts.
*Decision:* occupied/reserved/blocked are **derived for a given date** from assignments and blocks. Stored per room: lifecycle (`ACTIVE/INACTIVE/ARCHIVED`), housekeeping (`CLEAN/DIRTY/INSPECTED`, P1), and date-ranged OOS records.

**C4. Two inventory models.**
*Decision:* availability is **always counted at room-type level**, because that is what is sold. Per room type, the flag `trackRooms` turns on the physical layer:
- total = number of active rooms
- bookings can be assigned to rooms
- room-specific OOS reduces that type's count
- double assignment is prevented by a PostgreSQL exclusion constraint

Switching a type to tracked mode requires active rooms ≥ future commitments.

**C5. Showing agents Total / Booked / Blocked / OOS counts.**
*Risk:* this reveals occupancy, sales performance and internal allocations to third parties, and agents share screenshots. It is commercially sensitive.
*Decision (confirmed by product owner, 2026-10-05):* the default is the **full breakdown** from the brief. The level stays **configurable per property (default) and per agency access**, so a hotel can reduce what a particular agency sees. The access-settings screen explains what each level reveals.

| Level | Agent sees |
|---|---|
| `STATUS_ONLY` | Available / Limited / On request / Unavailable |
| `CAPPED_COUNT` (cap configurable) | "3 available", "5+ available" |
| `EXACT_COUNT` | exact available count |
| `FULL_BREAKDOWN` **(default)** | Total / Booked / Blocked / OOS / Available (the display in the brief) |

**C6. Agents creating bookings "if enabled".**
*Risk:* a third party writing directly into inventory bypasses hotel control and accountability.
*Decision (confirmed by product owner, 2026-10-05):* agents **never write inventory**. When `canRequestBooking` is on, an agent submits a **Booking Request**, which consumes nothing. A hotel user confirms it through the normal booking engine, which re-checks availability under lock. Auto-confirm against contracted allotments is a P2 feature with its own ledger.

**C7. Tentative status without rules.**
*Risk:* tentative bookings that hold forever silently kill sales. Tentative bookings that hold nothing oversell when confirmed.
*Decision:* **Tentative holds inventory until `holdExpiresAt`** (property default 48 h, configurable, max 14 days). A job then sets the status to `EXPIRED`, releases the inventory and notifies the creator. Inquiry never holds inventory.

**C8. "Never allow normal users to overbook" / "unless explicitly authorized".**
*Decision:* the database enforces `booked + held + blocked + oos ≤ total + overbook_allowance` per inventory day. The allowance is 0 unless an **override** is used:
- overbooking must be enabled for the tenant (off by default)
- the user needs the `inventory.override` permission
- a mandatory reason is recorded, the action is audited, and admins are notified

The allowance shrinks automatically as inventory is released. No code path can bypass the check.

**C9. Booking = one room type × number of rooms.**
*Risk:* this can't represent mixed-type bookings, partial cancellation or per-room assignment.
*Decision:* a **Booking header + one BookingRoom line per room unit**, each with type, occupancy, dates, assignment and status. The UI still offers "3 × Deluxe" quick entry.

**C10. "Same-day check-in/check-out".**
*Interpretation:* back-to-back turnover, where A departs on the 12th and B arrives on the 12th. This is fully supported by the half-open interval rule. *Day-use* (zero nights) is rejected in v1 (`checkOut > checkIn`); it is a separate product in P2.

**C11. Super Admin access to hotel data.**
*Decision:* platform staff see **tenant metadata and aggregates only**. The platform database role has no grants on guest or booking tables. To see operational data, the tenant admin creates a **Support Access Grant**: time-boxed, read-only by default, and every action is audited and visible to the tenant. There is no silent impersonation.

**C12. "Deleted room types must not break history".**
*Decision:* **nothing referenced by a booking is hard-deleted.** Such records are archived (`archivedAt`). Booking lines snapshot the room type name and code. Hard delete is allowed only for never-used records.

**C13. Base rate and payment status without a pricing or payment module.**
*Risk:* half-built accounting produces wrong numbers.
*Decision (v1):* the booking stores an *agreed total* (snapshot, integer minor units + ISO currency) and an **append-only payment ledger** of manual entries (payment, refund, adjustment). **Payment status is derived** from the ledger and is never edited directly. Rates and amounts are never exposed to agents in v1. The structure is ready for invoices, GST and Tally export later.

**C14. "Payment" entity ambiguity.**
*Decision:* two unrelated concepts are kept apart:
- `BookingPayment`: guest money, tenant data
- `SubscriptionInvoice`: platform billing (P2)

They never share a table.

**C15. Calendar shows "Closed" but no closing rule exists.**
*Decision:* add **Stop-sell** per property / room type / date range, with scope `ALL_CHANNELS` or `AGENTS_ONLY`. A stop-sell gates selling but doesn't consume inventory. Staff with `inventory.override` may still book into an `ALL_CHANNELS` closure, with a reason.

**C16. Future OTA integrations vs. "never overbook".**
*Risk:* OTA and channel bookings arrive already sold and cannot be rejected.
*Decision:* the design reserves a "must-accept" ingestion path that records overbooking explicitly (`overbooked` flag, urgent alert) instead of rejecting. Not built in v1.

**C17. PDF export of everything.**
*Decision:* exports run as async jobs. CSV/XLSX are available for any report. PDF is for summary reports, capped at 5,000 rows.

**C18. Guest personal data.**
*Decision:* guests are personal data under the India DPDP Act 2023 and the GDPR for EU guests. The system has:
- PII permissions (`guest.view`, `guest.export`)
- **anonymisation instead of deletion**, so historical bookings stay intact
- a configurable retention period
- PII redaction in logs and audit diffs
- encryption at rest

**C19. One person in several roles (e.g. hotel staff who also runs an agency).**
*Decision:* one global **User identity** with separate **memberships** (tenant, agency, platform). Each session is bound to exactly one context, and each portal has its own host and cookie (see Security).

**C20. Agents' "Room type" search field and occupancy.**
*Decision:* results include only room types whose occupancy limits can hold the requested rooms/adults/children. A room type that can't fit is marked "Occupancy not supported" rather than counted as available.

---

## 4. Business rules (authoritative; tests reference these IDs)

**Dates**

- **BR-01** A stay is `[checkIn, checkOut)`. Nights = `checkOut − checkIn` ≥ 1. Check-in 10 Oct, check-out 12 Oct occupies 10 and 11 Oct; the room is available again on 12 Oct.
- **BR-02** Stay dates are calendar dates in the property's timezone, stored as SQL `DATE`, never timestamps. API format `YYYY-MM-DD`.
- **BR-03** Business date = current date in the property timezone. (A P1 night-audit can hold the business date back until the audit is run.)
- **BR-04** A new booking cannot start before the business date, except a walk-in starting today. Back-dated entry (data migration) requires `booking.backdate`.
- **BR-05** Booking horizon defaults to 730 days ahead and max stay to 90 nights. Both are per-property settings.
- **BR-27** A property's timezone can't change while future bookings exist without a support-run migration.

**Availability**

- **BR-06** Inventory buckets:
  - `TENTATIVE` → *held*
  - `CONFIRMED`, `CHECKED_IN` → *booked*
  - `INQUIRY`, `CANCELLED`, `NO_SHOW`, `EXPIRED`, `CHECKED_OUT` → consume no **future** nights. Past nights stay recorded as history.
- **BR-07** `available(d) = total − booked − held − blocked − oos`. Stay availability = minimum over its nights. A stop-sell for the channel makes it unsellable.
- **BR-08** Every change to consumption locks the affected inventory-day rows in `(room_type_id, date)` order inside one transaction.
- **BR-09** Reducing a room type's total, archiving a room, or creating a block/OOS must not push any future date below zero available, unless the override rules (C8) apply.
- **BR-10** A room type can be archived only when it has no future active bookings or blocks.
- **BR-11** An assigned room must be active, belong to the line's room type (an upgrade flag is P1), and not be allocated to an overlapping stay or OOS. The last condition is enforced by an exclusion constraint.
- **BR-12** Per-room occupancy ≤ the room type's max adults, max children and max total. At least 1 adult per room.

**Booking lifecycle**

- **BR-13** Status changes follow the state machine in Phase 10. Invalid transitions return `INVALID_STATUS_TRANSITION`.
- **BR-14** No-show can be marked only when business date ≥ arrival. It releases nights ≥ business date.
- **BR-15** Cancellation releases nights ≥ business date. A checked-in booking can't be cancelled; it uses early check-out.
- **BR-16** A modification is atomic: old nights are released and new nights consumed in one transaction under one set of locks. If the new consumption fails, nothing changes.
- **BR-19** Booking reference is a per-property prefix + sequence (e.g. `GOA-26-004217`), unique per tenant. Internal IDs are UUIDv7 and are never the user-facing reference.
- **BR-20** Create and modify requests carry an `Idempotency-Key`. A repeat within 24 h returns the original result.
- **BR-21** Duplicate warning: same guest email or phone + same property + overlapping active stay → a warning that requires explicit acknowledgement. It is not a hard block.
- **BR-25** Tentative holds expire automatically (C7). The creator and property admins are notified 2 h before expiry and at expiry.
- **BR-29** Waitlist entries don't consume inventory. When inventory is released, matching entries are flagged and their owners notified. Nothing is auto-booked.
- **BR-32** Money is stored in integer minor units with an ISO-4217 currency. A property's currency is fixed after its first booking.

**B2B**

- **BR-17** Agency access is effective only when **all** of these hold:
  - the agency is active on the platform
  - the access status is `ACTIVE`
  - the business date is within `[validFrom, validTo]`
  - the property and room type are in scope
  - the agent user's membership is active

  These are evaluated on every request, so expiry takes effect even if the expiry job hasn't run.
- **BR-18** Agent responses never include internal notes, rates (v1), guest data, other agencies' data, booking-level detail, or overbooking allowance.
- **BR-28** Every agent search is logged (who, what, when, result summary) and rate-limited.

**Accounts, plans and audit**

- **BR-22** The audit entry is written in the same database transaction as the change it records.
- **BR-23** Plan limits are checked when a record is created. A downgrade never deletes data; over-limit resources become read-only until within limits.
- **BR-24** A suspended tenant: users can sign in read-only (configurable to none), agency access is paused, jobs keep running, data is retained.
- **BR-30** A tenant always has ≥ 1 active owner Hotel Admin.
- **BR-31** Users can't grant permissions they don't hold and can't change their own role or scope.

---

## 5. Non-functional requirements

| Area | Target (v1) |
|---|---|
| Availability search | p95 < 300 ms for one property, 30 nights, 20 room types |
| Booking commit | p95 < 600 ms. Zero oversell under concurrent load (verified by test CC-01). |
| Uptime | 99.9 % monthly for API and portals |
| Data durability | RPO ≤ 5 min (PITR), RTO ≤ 1 h; daily encrypted backups kept 35 days |
| Scale (design point) | 5,000 tenants, 10,000 properties, 2 M bookings/year, 500 concurrent staff, 2,000 agents |
| Security | OWASP ASVS L2 baseline; annual pen test; tenant isolation verified in CI |
| Accessibility | WCAG 2.2 AA |
| Browsers | Last 2 versions of Chrome, Edge, Safari, Firefox; desktop-first, usable at 360 px |
| i18n | English UI first; all strings externalised; dates and currency formatted by locale |
| Data residency | Single region per deployment (recommend AWS ap-south-1 for India-first) |

---

## 6. Complete feature list (Phase 3)

Priority: **P0** = MVP launch, **P1** = within 2–3 months after launch, **P2** = roadmap.

### 6.1 Platform (Super Admin)
| Feature | P |
|---|---|
| Tenants: create, edit, activate, suspend, deactivate, view usage | P0 |
| Plans: create/edit plans, entitlements (limits and feature flags), prices per currency/interval | P0 |
| Subscriptions: assign/change plan, trial, period, status (manual billing) | P0 |
| Per-tenant entitlement overrides with reason | P0 |
| Platform users (Super Admin, Support) with mandatory 2FA | P0 |
| Tenant owner account recovery (verified, audited) | P0 |
| Agency directory: verify, suspend platform-wide | P0 |
| Platform dashboard: tenants, active tenants, users, active agents, bookings, usage, subscriptions | P0 |
| System health: queues, job failures, reconciliation drift, error rates | P1 |
| Support access via tenant-issued grants | P1 |
| Platform settings (signup mode, default plan, email sender, feature flags) | P0 |
| Platform audit log | P0 |
| Announcements / in-app banners | P2 |
| Automated billing (Stripe/Razorpay), invoices, dunning | P2 |

### 6.2 Authentication and account
| Feature | P |
|---|---|
| Separate login hosts for hotel app, agent portal, admin | P0 |
| Email + password login, logout, generic errors, lockout and rate limits | P0 |
| Forgot / reset password (single-use, 30 min tokens) | P0 |
| Email verification | P0 |
| Invitations (staff, agency users) | P0 |
| TOTP 2FA + recovery codes (mandatory for platform; tenant can enforce for staff) | P0 platform / P1 tenant |
| Active sessions list and revoke | P1 |
| Breached-password check (k-anonymity) | P1 |
| WebAuthn / passkeys, SSO (SAML/OIDC) for enterprise | P2 |

### 6.3 Hotel setup
| Feature | P |
|---|---|
| Public hotel onboarding (signup → pending approval or trial, per platform setting) | P0 |
| First-run wizard: property → room types → rooms → staff → agents | P0 |
| Tenant profile, security policy | P0 |
| Properties: profile, timezone, currency, check-in/out times, child age, hold duration, low-availability threshold, horizon, max stay, booking reference prefix, agent defaults | P0 |
| Holidays/events calendar per property | P1 |
| Property images | P1 |

### 6.4 Inventory
| Feature | P |
|---|---|
| Room types: name, code, description, occupancy (adults, children, max), total inventory, base rate, status, sort order, internal notes | P0 |
| Amenities catalogue + assignment | P1 |
| Room type images | P1 |
| Individual rooms (per type, `trackRooms`): number, floor, building, notes, bulk create | P0 |
| Out-of-service (count-based or room-specific) | P0 |
| Room blocks with reasons, partial release | P0 |
| Stop-sell / closures (all channels / agents only) | P1 |
| Inventory override (overbook) with reason | P1 |
| Room status board (derived status for a date; housekeeping status) | P1 |

### 6.5 Availability
| Feature | P |
|---|---|
| Date-wise availability engine (Phase 9) | P0 |
| Availability calendar: room types × dates; day/week/month/custom; status colours; drill-down per cell | P0 |
| Quick availability check / quote panel | P0 |
| Nightly reconciliation and drift alerts | P0 |

### 6.6 Bookings
| Feature | P |
|---|---|
| Create, view, edit, cancel; multi-room and multi-type | P0 |
| Statuses and transitions: inquiry, tentative (holds), confirmed, check-in, check-out (incl. early), no-show | P0 |
| Guests: profiles, search, link to bookings, anonymise | P0 |
| Room assignment + suggestions (tracked types) | P0 |
| Reservation calendar (tape chart), open booking from calendar | P0 |
| Drag-to-move on tape chart (calls modify API) | P1 |
| Duplicate detection, idempotency | P0 |
| Booking history timeline (from audit) | P0 |
| Payment ledger (manual), derived payment status | P1 |
| Waitlist / availability requests | P1 |
| Agent booking requests: inbox, confirm → booking, decline | P1 |
| Cancellation policies and fees | P2 |
| Group blocks with pick-up | P2 |
| Rate plans, seasonal pricing, taxes, invoices | P2 |

### 6.7 B2B
| Feature | P |
|---|---|
| Invite agency by email; create/attach agency access | P0 |
| Access lifecycle: pending → active / rejected; suspend; deactivate; expiry | P0 |
| Scope: allowed properties, allowed room types per property; validity window; visibility level; request permission | P0 |
| Agent portal: dashboard, authorised properties, availability search, recent searches | P0 |
| Agency admin: agency profile, agency users | P0 |
| Booking requests + request status | P1 |
| Agency self-signup + access requests to discoverable properties | P1 |
| Agent API keys (machine access to availability) | P2 |
| Contracted allotments, agent rates | P2 |

### 6.8 Staff and RBAC
| Feature | P |
|---|---|
| Staff invitation, suspension, revocation | P0 |
| System roles (Hotel Admin, Hotel Manager, Hotel Staff) with editable permissions (except Admin) | P0 |
| Custom roles | P1 |
| Property scoping per user | P0 |

### 6.9 Dashboards and reports
| Feature | P |
|---|---|
| Hotel dashboard: arrivals, departures, in-house, occupancy %, available/booked/blocked/OOS today, upcoming bookings, expiring holds, recent activity | P0 |
| Agent dashboard: accessible hotels, quick search, recent searches, requests | P0 |
| Platform dashboard | P0 |
| Reports: Booking, Occupancy (daily/monthly), Availability, Blocked rooms, Cancellations, No-shows, Booking source, Audit | P0 |
| Reports: Room inventory, Room-type, Hotel-wise (multi-property), Agent activity | P1 |
| Filters: date range, property, room type, agent, source, status | P0 |
| Export CSV / XLSX | P0 |
| Export PDF (summary reports) | P1 |
| Scheduled report emails | P2 |

### 6.10 Notifications
| Feature | P |
|---|---|
| In-app notification centre | P0 |
| Email notifications: new/modified/cancelled booking, block, low availability, full occupancy, agent activated/suspended, user created, password reset, hold expiring | P0 |
| Per-user preferences per event and channel | P1 |
| Tenant-customisable templates | P2 |
| SMS / WhatsApp adapters | P2 |

### 6.11 Integrations readiness
| Feature | P |
|---|---|
| Versioned REST API + OpenAPI spec | P0 |
| Transactional outbox of domain events | P0 |
| Outbound webhooks (signed) | P2 |
| Channel manager / OTA ARI connectors | P2 |
| Accounting / Tally export | P2 |
