# Phase 8 — UI/UX Structure

## 1. Principles

1. **Operational speed first.** Front-desk staff work at a desk all day: dense but legible layouts, keyboard shortcuts, no gratuitous animation.
2. **Truth is visible.** Every availability number can be clicked through to its composition (booked / held / blocked / OOS) and its sources.
3. **Safe by default.** Destructive or inventory-affecting actions show a preview of the effect before confirming (blocks, cancellations, modifications).
4. **One component, one meaning.** A status badge means the same thing everywhere.
5. **Accessible:** WCAG 2.2 AA. Colour is never the only signal (icon + text + pattern). Full keyboard paths. Visible focus. Screen-reader labels on grid cells.

## 2. Design tokens

| Token | Light | Use |
|---|---|---|
| `--brand-900` | `#132A3E` (deep navy) | Sidebar, headings |
| `--brand-600` | `#1F5E8C` | Primary buttons, links |
| `--accent-500` | `#B8873B` (brass) | Sparing highlights (owner badge, onboarding) |
| `--neutral-*` | slate 50–950 | Surfaces, borders, text |
| `--status-available` | `#15803D` green | Available |
| `--status-low` | `#B45309` amber | Low availability |
| `--status-full` | `#B91C1C` red | Fully booked |
| `--status-blocked` | `#6B4FA0` violet + diagonal hatch | Blocked |
| `--status-oos` | `#57534E` stone + cross-hatch | Out of service |
| `--status-closed` | `#334155` slate, striped | Stop-sell / closed |

- Dark mode is supported through token redefinition (P1).
- **Typography:** Inter, sizes 12 / 13 / 14 (body) / 16 / 18 / 20 / 24 / 30. **Tabular numerals** in grids and tables.
- **Spacing:** 4 px base. Radius 6 px. Table row height 36 px (compact) / 44 px (comfortable, user setting).

## 3. Component inventory (`packages/ui`)

| Group | Components |
|---|---|
| Layout | AppShell (sidebar + topbar), PageHeader (title, breadcrumbs, actions), Section, Card, Drawer, Tabs |
| Inputs | Button (primary/secondary/ghost/destructive, loading state), TextField, Select, Combobox (async search), DateRangePicker (nights counter, property-timezone aware), NumberStepper, Checkbox, Switch, RadioGroup, Textarea |
| Data | DataTable (TanStack: sort, filter chips, column visibility, saved views, CSV export button, sticky header, virtualised), StatTile, Sparkline, EmptyState, Skeleton |
| Feedback | StatusBadge (booking, payment, agency, block statuses), Alert/Banner, Toast, ConfirmDialog (typed confirmation for destructive actions), ErrorState with requestId copy |
| Domain | AvailabilityGrid, TapeChart, StayQuotePanel, RoomLineEditor, GuestPicker, PermissionMatrix, ScopeTree (property → room types), AuditDiff, ImpactPreview (per-night before/after) |

Every data view implements five states: **loading** (skeleton matching the layout), **empty** (explanation + primary action), **error** (plain message + retry + requestId), **partial** (warning banner), and **no permission** (the menu item is hidden; a direct URL shows "You don't have access to this page").

## 4. Hotel app (`app.` host)

### 4.1 Shell
```
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ ◧ StayDesk    │ [Seaview Resort ▾]   🔍 Search bookings, guests (/)   🔔 3  👤 │
│               ├──────────────────────────────────────────────────────────────┤
│ Dashboard     │ Page title                                [Secondary] [Primary]│
│ Bookings      │ Filters ▸ chips                                                │
│ Calendar      │                                                                │
│ Availability  │                       content                                  │
│ Rooms         │                                                                │
│ Room Types    │                                                                │
│ Blocks        │                                                                │
│ Guests        │                                                                │
│ Requests ●2   │                                                                │
│ Travel Agents │                                                                │
│ Reports       │                                                                │
│ ───────────── │                                                                │
│ Users         │                                                                │
│ Settings      │                                                                │
│ Audit Logs    │                                                                │
└───────────────┴──────────────────────────────────────────────────────────────┘
```
- The **property switcher** sets the working property (stored per user). Multi-property views offer "All properties" where meaningful (dashboard, reports).
- Menu items render only if the user holds the relevant `*.view` permission.
- **Global shortcuts:** `/` search, `N` new booking, `G B` bookings, `G C` calendar, `G A` availability, `?` shortcut help.
- The topbar shows the **business date** ("Mon 5 Oct · Asia/Kolkata") when the user's local date differs from the property's.

### 4.2 Pages
| Route | Content |
|---|---|
| `/dashboard` | Tiles: Arrivals today, Departures today, In-house, Occupancy % tonight, Available / Booked / Blocked / OOS tonight. Lists: today's arrivals (check-in button), today's departures (check-out button), holds expiring in 24 h, pending agent requests, 7-day occupancy sparkline, recent activity (audit feed). |
| `/bookings` | DataTable: reference, guest, stay, nights, rooms (type × n), status, source/agency, payment (if permitted), created. Saved views: Arrivals, In-house, Departures, Tentative, Cancelled. |
| `/bookings/new` | Two-column layout: left = stay + room lines + guest + details; right = sticky **StayQuotePanel** (per-night availability, warnings). |
| `/bookings/{id}` | Header (reference, status badge, primary next action), stay summary, rooms (assignment), guest, notes (internal clearly marked), payments (P1), timeline (audit). |
| `/calendar` | **TapeChart:** rows = room types (expandable to rooms for tracked types), columns = dates. Bars = booking lines (guest, colour by status, icon by source). Click → booking drawer. P1: drag to move/extend (opens modification preview). |
| `/availability` | **AvailabilityGrid** (§4.3) |
| `/rooms` | Rooms by type; status board toggle for a date (Available / Occupied / Reserved / Blocked / OOS derived), housekeeping (P1) |
| `/room-types` | List + editor (details, occupancy, inventory, amenities, images, internal notes) |
| `/blocks` | List with kind filter (Block / Out of service), create drawer with ImpactPreview, release dialog |
| `/guests` | Search, profile with stay history |
| `/requests` | Agent booking requests inbox + waitlist (P1) |
| `/travel-agents` | Access list (agency, status badge, validity, scope summary, visibility), invite drawer, detail page: profile (read-only), access settings, **ScopeTree**, activity (searches, requests), audit |
| `/reports` | Report catalogue → report page (filters bar, chart, table, export menu) |
| `/users` | Staff list, invite, role and scope editor; Roles tab with **PermissionMatrix** |
| `/settings` | Tenant, properties, booking rules, agent defaults, notifications, security (2FA policy), subscription, support access |
| `/audit-logs` | Filterable log with **AuditDiff** expansion |

### 4.3 Availability grid
```
 Seaview Resort        ◀  Oct 2026  ▶   [Day][Week][Month][Custom]   Show: ◉ Available ○ Breakdown
              Thu 1  Fri 2  Sat 3  Sun 4  Mon 5  Tue 6  Wed 7 …
 Deluxe (20)  ▇ 8    ▇ 5    ▇ 7    ▇ 7    ▇ 10   ▇ 2!   ▇ 0●
 Suite (4)    ▇ 2    ▇ 2    ▇ 1!   ▇ 2    ▨ 0B   ▨ 0B   ▇ 3
 Villa (6)    ▦ ×    ▦ ×    ▇ 6    ▇ 6    ▇ 6    ▇ 5    ▇ 6
 ────────────────────────────────────────────────────────────
 Total        12     9      14     15     16     7      9
 Legend: ▇ green Available · ! amber Low · ● red Full · ▨ Blocked · ▦ Closed (stop-sell)
```
- Cell = available count. Colour/pattern = classification (Phase 9 §3). A corner dot shows blocks or OOS present.
- Hover/focus → tooltip: Total 20 · Booked 12 · Held 1 · Blocked 2 · OOS 0 · Available 5.
- Click → side panel: the bookings, holds and blocks on that night, with links. Actions: "New booking from this date", "Block…", "Stop-sell…".
- Drag-select a range of cells → quick actions (block, stop-sell, new booking) for that type and range.
- Sticky first column and header, virtualised columns (up to 92 days), holidays marked in the header, today highlighted, weekends tinted.
- Accessibility: grid role, arrow-key navigation, each cell labelled "Deluxe, 6 October, 2 available, low".

### 4.4 Booking form behaviour
- Date picker shows nights and the "Check-out 12 Oct (2 nights)" convention explicitly.
- A room line is type + quantity + per-room occupancy (expandable). Max occupancy guidance is inline.
- The quote panel re-queries (debounced 300 ms) on change. A "Last checked 2 s ago" note sets expectations.
- Submit disables the button and shows progress. The Idempotency-Key is generated per form instance, so retries are safe.
- On `NO_AVAILABILITY`, the panel highlights short nights and suggests alternatives (other types with availability, nearest dates).

## 5. Agent portal (`agent.` host)

Deliberately simple: three primary destinations.
```
┌──────────────────────────────────────────────────────────────────────┐
│ StayDesk for Agents · Sunrise Travels          Search  Requests  👤 ▾ │
├──────────────────────────────────────────────────────────────────────┤
│  Hotel/Resort [Seaview Resort ▾]  Check-in [10 Oct]  Check-out [12 Oct]│
│  Rooms [2]  Adults [4]  Children [1]  Room type [Any ▾]   [ Search ]  │
├──────────────────────────────────────────────────────────────────────┤
│  2 nights · 10–12 Oct 2026                                            │
│  Room type     Total Booked Blocked OOS Avail  Status       Request   │
│  Deluxe Room     20    12      2     0    6   ● Available  [Request]  │
│  Suite            4     2      1     0    1   ● Limited    [Request]  │
│  Family Room      6     6      0     0    0   ● Unavailable  —        │
└──────────────────────────────────────────────────────────────────────┘
```
This is the default full-breakdown view. With a lower visibility level, the count columns collapse into one "Availability" column, or disappear.
| Route | Content |
|---|---|
| `/` (dashboard) | Accessible hotels (cards), quick search, recent searches (re-run), recent request statuses, access expiry warnings |
| `/search` | Search form + results (columns depend on the visibility level the hotel set) |
| `/hotels` | Approved properties with public info and allowed room types |
| `/requests` | Own requests (agency-wide for admins): status, hotel message, booking reference |
| `/agency` | Profile and users (Agent Admin only) |

No hotel internals appear anywhere: no notes, rates (v1), guest lists or other agencies.

## 6. Platform admin (`admin.` host)
Dashboard (tenants, active tenants, users, active agents, bookings/month, usage trends, subscription mix), Tenants, Plans, Subscriptions, Agencies, Platform users, Health, Settings, Audit. A distinct accent colour (slate/red border) makes the admin context unmistakable.

## 7. Public and auth pages
- **Marketing site (`www.`):** landing (value proposition, feature sections, B2B story), pricing (rendered from the plans API — no hard-coded prices), contact, legal (terms, privacy, DPA), signup entry.
- **Auth pages, on each portal host:** Login, MFA, Forgot password, Reset password, Verify email, Accept invitation, Hotel onboarding, Agency signup (P1).
  - The login page is styled per portal ("Hotel login", "Agent login", "Admin login").
  - Error messages are generic ("Email or password is incorrect").

## 8. Responsive behaviour
| Breakpoint | Behaviour |
|---|---|
| ≥ 1280 px | Full layout; grid shows 14–31 days |
| 768–1279 | Collapsible sidebar; grid shows 7–14 days |
| < 768 | Bottom nav for key areas (Dashboard, Bookings, Availability, More). Grid becomes a per-room-type list for a selected week. Tables become cards. Tape chart is read-only. Agent portal is fully usable on mobile (common for agents). |
