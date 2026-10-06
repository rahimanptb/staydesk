# Phase 9 — Availability Engine

The engine has two jobs:
- answer "how many rooms of type X can be sold on each night of [a, b)?" quickly
- guarantee that no ordinary code path can ever sell more than that

## 1. Date rules (non-negotiable)

- A stay is the half-open interval **`[checkIn, checkOut)`**. Night `d` belongs to the stay iff `checkIn ≤ d < checkOut`.
- Check-in 10 Oct / check-out 12 Oct occupies **10 and 11 Oct**; the room is available on **12 Oct**. Back-to-back stays (A leaves 12th, B arrives 12th) never conflict.
- Stay dates are **property-local calendar dates** (`DATE` in SQL, `LocalDate` value type in TS backed by `Temporal.PlainDate`). JavaScript `Date` is never used for stay dates (lint rule).
- **Business date** = `(now() AT TIME ZONE property.timezone)::date`. One SQL function and one TS function compute it; both are tested at timezone extremes (UTC+14, UTC−11) and around midnight.

## 2. Data model

**Sources of truth:**
- `booking_room` lines, each with its current inventory footprint `[inv_from, inv_to)` and bucket (`HELD` | `BOOKED` | `NONE`)
- `room_block` rows (kind `BLOCK` | `OUT_OF_SERVICE`, quantity, `[start_date, end_date)`)
- `room_type.total_inventory` (equal to the active room count when `track_rooms`)
- `stop_sell` rows

**Projection** maintained transactionally: `inventory_day`, one row per room type per date.

```
inventory_day(room_type_id, date)  → total, booked, held, blocked, out_of_service,
                                      overbook_allowance, closed_all, closed_agents
CHECK booked + held + blocked + out_of_service ≤ total + overbook_allowance
```

## 3. Formulas and classification

```
consumed(d)  = booked + held + blocked + out_of_service
available(d) = total − consumed(d)            -- negative only if overbooked by authorised override
stayAvailable(rt, [a, b)) = MIN over d ∈ [a, b) of available(d)
sellable(rt, [a, b), channel) = 0 if any night closed for channel, else max(0, stayAvailable)
```

This matches the brief: **total − bookings (booked + held) − blocked − out-of-service = available**.

Cell classification (calendar and agent status):

| Status | Rule (evaluated in this order) |
|---|---|
| **Closed** | `closed_all` (agents: `closed_all OR closed_agents`) |
| **Overbooked** (staff only) | `available < 0` |
| **Blocked** | `available = 0 AND blocked + out_of_service > 0 AND booked + held = 0` (unavailable purely because of blocks/OOS) |
| **Fully booked** | `available ≤ 0` |
| **Low** | `0 < available ≤ property.low_availability_threshold` |
| **Available** | otherwise |

For a multi-night search, the status is taken from the worst night (Closed > Full > Low > Available).

### Worked example (from the brief)
Deluxe total = 10. Booking A: 1–3 Oct, 2 rooms (nights 1, 2). Booking B: 2–5 Oct, 3 rooms (nights 2, 3, 4).

| Date | Booked by A | Booked by B | Booked | Available |
|---|---|---|---|---|
| 1 Oct | 2 | – | 2 | **8** |
| 2 Oct | 2 | 3 | 5 | **5** |
| 3 Oct | – | 3 | 3 | **7** |
| 4 Oct | – | 3 | 3 | **7** |
| 5 Oct | – | – | 0 | **10** |

A search for 1–5 Oct returns **5** (the minimum, on 2 Oct). A request for 6 rooms is rejected with a shortfall of 1 on 2 Oct. This exact table is test **AV-01**.

## 4. Why a counter projection

| Option | Correctness under concurrency | Read cost | Verdict |
|---|---|---|---|
| A. Compute on read from bookings/blocks | No row exists to lock for "nights with no bookings yet" (phantom problem). Needs SERIALIZABLE with retry storms, or coarse advisory locks. | Grows with bookings | Rejected as primary |
| **B. `inventory_day` projection** | Natural lock unit `(room_type, date)`. DB CHECK makes overselling impossible. | O(nights × types) | **Chosen** |
| C. Advisory lock per room type + compute on read | Serialises unrelated dates; no DB-level invariant | Grows | Rejected |

The drift risk of B is controlled in two ways: (1) the projection is only ever changed in the same transaction as its source rows, by one module; (2) nightly reconciliation (§12) proves it. Option A's query is kept as the reconciliation oracle. B is also exactly the shape channel managers need (ARI per date) for future integrations.

## 5. The single writer: `InventoryLedger`

Only `InventoryLedger.apply(tx, change)` writes `inventory_day`. Bookings, blocks, OOS, holds and total changes all call it inside their own transaction.

```ts
type Bucket = 'BOOKED' | 'HELD' | 'BLOCKED' | 'OOS';
interface Delta { roomTypeId: Uuid; from: LocalDate; to: LocalDate; bucket: Bucket; qty: number /* ± */ }
interface ApplyOptions {
  businessDate: LocalDate;
  channel: 'STAFF' | 'AGENT_REQUEST' | 'SYSTEM';
  override?: { reason: string };       // requires inventory.override + tenant.overbooking_enabled
  ignoreStopSell?: boolean;            // requires inventory.override
}
apply(tx, deltas: Delta[], opts): Promise<InventoryEffect>  // throws NoAvailability / InventoryConflict / ClosedForSale
```

### Algorithm
```
1. Normalise deltas → per (roomTypeId, date) net change per bucket.
   (A modification that releases and re-consumes the same night nets to 0 → no check needed there.)
2. SELECT … FROM room_type WHERE id = ANY($types) ORDER BY id FOR SHARE
   – blocks concurrent total-inventory changes; validates the types are ACTIVE and in this property/tenant.
3. Ensure rows exist (safety net; normally pre-created to the horizon):
   INSERT INTO inventory_day (tenant_id, property_id, room_type_id, date, total)
   SELECT $tenant, $property, rt.id, d::date, rt.total_inventory
   FROM room_type rt CROSS JOIN generate_series($minDate::date, $maxDate::date - 1, '1 day') d
   WHERE rt.id = ANY($types)
   ON CONFLICT (room_type_id, date) DO NOTHING;
4. SELECT … FROM inventory_day
   WHERE room_type_id = ANY($types) AND date >= $minDate AND date < $maxDate
   ORDER BY room_type_id, date
   FOR UPDATE;                                   -- deterministic order ⇒ no deadlocks between writers
5. For each affected row compute new counters. For each row where net consumption increases:
     availableBefore = total − consumed
     if availableBefore < increase:
        if opts.override → newAllowance = max(allowance, consumedAfter − total)   (record override)
        else            → collect shortfall {date, roomTypeId, requested, available}
     if closed for channel and not ignoreStopSell → collect closure
   For rows where consumption decreases:
     newAllowance = min(allowance, max(0, consumedAfter − total))   -- allowance shrinks automatically
6. If shortfalls → throw NoAvailability(shortfalls) (the transaction rolls back; nothing written).
7. UPDATE inventory_day AS i SET booked = v.booked, held = v.held, … , overbook_allowance = v.allowance
   FROM unnest($types::uuid[], $dates::date[], $booked::int[], …) AS v(...)
   WHERE i.room_type_id = v.room_type_id AND i.date = v.date;
   — absolute values are safe because the rows are locked.
8. The CHECK constraint validates. A violation here means a bug → roll back, log CRITICAL, return NO_AVAILABILITY.
9. Write outbox inventory.changed {propertyId, roomTypeId, from, to}. For nights that crossed the
   low/full thresholds, write availability.low / availability.full (deduplicated per day).
10. Return the effect (per-night before/after) for the audit log and the response.
```

### Transaction settings and retries
```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
SELECT set_config('app.tenant_id', $tenant, true);
```
Isolation is READ COMMITTED: explicit row locks plus the CHECK give deterministic behaviour without serialisation-failure storms. On `40P01` (deadlock), `40001` (serialisation) or `55P03` (lock timeout), the **whole unit of work** is retried up to 3 times with jittered backoff (50–400 ms), then the request fails with `CONFLICT_RETRY` (503, idempotent-safe).

### Global lock order (every writer must follow it)
1. Business aggregate row: `booking` / `room_block` / `agency_access` `FOR UPDATE` (when modifying an existing aggregate)
2. `room_type` rows `FOR SHARE` (or `FOR UPDATE` for total changes), ordered by id
3. `inventory_day` rows `FOR UPDATE`, ordered by `(room_type_id, date)`
4. `booking_sequence` row (reference allocation)
5. `room_allocation` inserts/updates (the exclusion constraint does its own locking)

## 6. The last-room race

```
T0  Alice and Bob both see "Deluxe: 1 available" for 10–12 Oct (reads take no locks).
T1  Alice: BEGIN … SELECT inventory_day (Deluxe, 10 & 11 Oct) FOR UPDATE → acquires locks
T2  Bob:   BEGIN … SELECT … FOR UPDATE → waits on Alice's locks
T3  Alice: available 1 ≥ 1 → UPDATE booked+1 → INSERT booking → COMMIT (releases locks)
T4  Bob:   lock acquired; re-reads rows (now booked) → available 0 < 1 → NoAvailability → ROLLBACK
T5  Bob sees: "Sorry, the last Deluxe room for 10–11 Oct was just booked." + alternatives
```
Test **CC-01** runs 50 parallel requests for the last room and asserts exactly one success, 49 `NO_AVAILABILITY`, and counters equal to the reconciliation result.

## 7. Deltas per operation

| Operation | Deltas |
|---|---|
| Create INQUIRY | none |
| Create TENTATIVE | `+HELD` × each line over `[checkIn, checkOut)` |
| Create CONFIRMED / walk-in CHECKED_IN | `+BOOKED` per line |
| Confirm a tentative booking | `−HELD`, `+BOOKED` (net 0 per night; rows still locked so the bucket move is consistent) |
| Inquiry → confirmed/tentative | `+BOOKED` / `+HELD` (full availability check) |
| Cancel / hold expiry / no-show (line) | `−bucket` over `[max(inv_from, businessDate), inv_to)`; line `inv_to ← max(inv_from, businessDate)`, bucket `NONE` |
| Early check-out on business date `x` | `−BOOKED` over `[x, inv_to)`; `inv_to ← x` |
| Change dates | `−bucket` old footprint, `+bucket` new footprint (netted per night) |
| Change room type | `−bucket` old type, `+bucket` new type |
| Add / remove room line | `+bucket` / `−bucket` for that line |
| Create block / OOS | `+BLOCKED` / `+OOS` × quantity over `[start, end)` |
| Release block from date `x` | `−BLOCKED` over `[max(start, x), end)`; `end_date ← max(start, x)` |
| Reduce block quantity by `k` from date `x` | Before the block starts: quantity reduced in place. Once it has started: split — the original row ends at `x`; a new row (`split_from_id` → original) with `quantity − k` covers `[x, end)` (keeps history exact) |

Past nights (`< businessDate`) are never released: they are history and feed the "rooms sold" metrics.

## 8. Changing total inventory

`RoomTypeService.setTotal(newTotal)`, also triggered by adding, archiving or moving a room in tracked mode:
```
1. SELECT … FROM room_type WHERE id = $rt FOR UPDATE      -- excludes concurrent ledger writers (they hold FOR SHARE)
2. SELECT date, booked + held + blocked + out_of_service AS consumed
   FROM inventory_day WHERE room_type_id = $rt AND date >= businessDate AND consumed > $newTotal
   → any rows ⇒ InventoryConflict(nights) unless override
3. UPDATE room_type SET total_inventory = $newTotal, version = version + 1
4. UPDATE inventory_day SET total = $newTotal WHERE room_type_id = $rt AND date >= businessDate
5. Audit + outbox inventory.changed [businessDate, horizon)
```
Past rows keep their historical totals, so historical occupancy remains correct.

## 9. Read paths

### 9.1 Availability grid (staff)
```sql
SELECT rt.id AS room_type_id, d::date AS date,
       COALESCE(i.total, rt.total_inventory) AS total,
       COALESCE(i.booked, 0) AS booked, COALESCE(i.held, 0) AS held,
       COALESCE(i.blocked, 0) AS blocked, COALESCE(i.out_of_service, 0) AS out_of_service,
       COALESCE(i.closed_all, false) AS closed_all, COALESCE(i.closed_agents, false) AS closed_agents
FROM room_type rt
CROSS JOIN generate_series($from::date, $to::date - 1, '1 day') d
LEFT JOIN inventory_day i ON i.room_type_id = rt.id AND i.date = d::date
WHERE rt.property_id = $property AND rt.status = 'ACTIVE'
ORDER BY rt.sort_order, rt.name, d;
```
A missing row means no consumption has ever touched that night, so `total` comes from the room type. This is correct by construction, because every consumption creates the row. Range is capped at 92 days.

### 9.2 Stay search (staff quote and agent search)
The same query aggregated per room type: `MIN(available)`, `bool_or(closed…)`, and per-night detail on request. It is followed by the **occupancy fit** check (§10) and, for agents, the **visibility projection** (§11).

### 9.3 Freshness
Reads take no locks and may be milliseconds stale. That is acceptable because every write re-validates under lock. The UI says "Availability is confirmed when the booking is saved."

## 10. Occupancy fit

A staff booking specifies occupancy per line and validates each line against room type limits (BR-12).

An agent search gives aggregate rooms `R`, adults `A`, children `C`. A room type *fits* iff:
```
A ≥ R                                  (≥ 1 adult per room)
A ≤ R × max_adults
C ≤ R × max_children
A + C ≤ R × max_occupancy
```
Room types that don't fit are returned with `occupancyFits: false` and are not marked available.

## 11. Agent projection

Applied after BR-17 access checks and scope filtering (unauthorised room types are simply absent):

| Visibility | Returned per room type |
|---|---|
| `STATUS_ONLY` | `status`: AVAILABLE / LIMITED / ON_REQUEST / UNAVAILABLE / CLOSED |
| `CAPPED_COUNT` | + `availableDisplay`: `"0"`…`"cap−1"` or `"cap+"` |
| `EXACT_COUNT` | + `available` |
| `FULL_BREAKDOWN` **(default)** | `breakdown {total, booked (incl. held), blocked, outOfService, available}` |

The default comes from `property.agent_default_visibility` and can be overridden per agency access.

Rules:
- The agent sees `CLOSED` when `closed_agents OR closed_all`, regardless of counts.
- `ON_REQUEST` is shown when sellable < requested rooms but the access has `canRequestBooking` and the property accepts requests.
- Overbooking is never shown to agents: negative availability displays as 0.
- Projections are implemented as **pure functions in `packages/domain`** with snapshot tests, so no field can leak by accident. The response schema is strict and an extra field fails the contract test.

## 12. Reconciliation (proof of correctness)

```sql
WITH expected AS (
  SELECT room_type_id, date, SUM(booked) booked, SUM(held) held, SUM(blocked) blocked, SUM(oos) oos
  FROM (
    SELECT br.room_type_id, d::date AS date,
           (br.inventory_bucket = 'BOOKED')::int AS booked, (br.inventory_bucket = 'HELD')::int AS held,
           0 AS blocked, 0 AS oos
    FROM booking_room br
    CROSS JOIN LATERAL generate_series(br.inv_from, br.inv_to - 1, '1 day') d
    WHERE br.property_id = $1 AND br.inventory_bucket <> 'NONE'
    UNION ALL
    SELECT b.room_type_id, d::date, 0, 0,
           CASE WHEN b.kind = 'BLOCK' THEN b.quantity ELSE 0 END,
           CASE WHEN b.kind = 'OUT_OF_SERVICE' THEN b.quantity ELSE 0 END
    FROM room_block b
    CROSS JOIN LATERAL generate_series(b.start_date, b.end_date - 1, '1 day') d
    WHERE b.property_id = $1
  ) x
  GROUP BY 1, 2
),
actual AS (
  SELECT room_type_id, date, booked, held, blocked, out_of_service
  FROM inventory_day
  WHERE property_id = $1
)
SELECT COALESCE(a.room_type_id, e.room_type_id) AS room_type_id,
       COALESCE(a.date, e.date)                 AS date,
       a.booked  AS actual_booked,  e.booked  AS expected_booked,
       a.held    AS actual_held,    e.held    AS expected_held,
       a.blocked AS actual_blocked, e.blocked AS expected_blocked,
       a.out_of_service AS actual_oos, e.oos  AS expected_oos
FROM actual a
FULL OUTER JOIN expected e ON e.room_type_id = a.room_type_id AND e.date = a.date
WHERE COALESCE(a.booked, 0)         <> COALESCE(e.booked, 0)
   OR COALESCE(a.held, 0)           <> COALESCE(e.held, 0)
   OR COALESCE(a.blocked, 0)        <> COALESCE(e.blocked, 0)
   OR COALESCE(a.out_of_service, 0) <> COALESCE(e.oos, 0);
```

- Released blocks keep their truncated `[start, end)`, so they still count for past nights. This matches the counters, which never release past nights.
- Runs nightly per property and on demand from the platform Health page.
- **Any mismatch = incident.** An alert is raised. A repair runs only through an explicit, audited admin command that rewrites the counters from the oracle under the normal lock order. It never runs silently.

## 13. Individual-room layer

- `room_allocation(room_id, [start, end))` with `EXCLUDE USING gist (room_id WITH =, daterange WITH &&)` makes physical double-allocation impossible, whether booking vs booking or booking vs room-specific OOS/block.
- Counts and rooms stay consistent: allocations on night `d` ≤ booked + held + room-specific OOS/blocks ≤ total. Count-level availability is authoritative for selling.
- **Fragmentation:** count-level availability guarantees *a* room each night, but not necessarily *the same* room for the whole stay. The suggestion algorithm:
  1. rooms free for the entire stay, best-fit (smallest leftover gap), then
  2. if none, propose a room move (split assignment) for staff to accept.

  Selling is never blocked by fragmentation. The tape chart's "unassigned" lane shows what still needs rooms.
- Room-specific OOS = a `room_block` (kind OOS, `room_id`, quantity 1) + a `room_allocation` row. It fails if the room is already assigned on those dates; the UI offers to unassign or move the guests first.

## 14. Horizon, row lifecycle, performance

- Rows are pre-created for `[businessDate, businessDate + horizon]` when a room type is created; an hourly worker job keeps every property's rows up to its horizon (idempotent). The upsert in step 3 is the safety net. New rows take their closure flags from active stop-sells; stop-sell changes and room type creation are serialised per property by an advisory lock, so a new row can never miss a concurrent stop-sell.
- The worker runs in each tenant's RLS context; it learns which properties exist only through the `SECURITY DEFINER` function `worker_inventory_targets()` (ids and scheduling fields only).
- Every reconciliation run is recorded in the append-only `inventory_reconciliation` table; mismatches also emit `inventory.reconciliation_failed`. The repair command (`pnpm --filter @staydesk/worker inventory repair --property <id> --actor <name> --reason "…"`) rebuilds counters from the oracle, proves the result and writes an audit entry.
- A total change also resets `overbook_allowance` to `max(0, consumed − total)`, so a stale allowance never weakens the CHECK backstop.
- Indexes: PK `(room_type_id, date)` serves both lock and read paths; `(property_id, date)` serves property-wide grids and reports.
- Budget: a 30-night × 20-type search touches 600 rows (< 5 ms). A booking writes ≤ 90 nights × types-in-booking rows.
- Past rows are kept permanently as the "rooms sold" fact table (partitioned yearly at scale).

## 15. Future channel bookings (design note, not v1)

OTA and channel-manager bookings are "must-accept". They will call `apply()` with `channel: 'CHANNEL'` and a policy that converts shortfall into a recorded overbooking: the allowance is raised, the booking is flagged `overbooked`, and an urgent alert goes out. Outbound `inventory.changed` events feed ARI pushes, so channel inventory follows the same ledger.
