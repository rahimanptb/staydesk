# Phase 12 — Development Plan (with Phase 14 test plan and Phase 15 deployment outline)

## 1. Build order and why

The riskiest parts come first: tenant isolation, the availability engine and the booking engine. Everything else is CRUD and UI around them. Each milestone ends with working, tested, deployable software, not scaffolding.

| # | Milestone | Deliverables | Exit criteria |
|---|---|---|---|
| **M0** | Foundations | Monorepo (pnpm + Turborepo), lint/format/typecheck, docker-compose (Postgres 16, Redis, Mailpit, MinIO), Prisma setup, DB roles, CI pipeline, env validation, logging, error filter, OpenAPI generation | `pnpm dev` runs web + api + worker locally; CI green on an empty feature |
| **M1** | Identity, tenancy, RBAC, audit | Users, sessions, login/logout/MFA, reset, invitations, tenants, memberships, roles/permissions, guards, tenant-scoped client + **RLS**, AuditWriter, outbox table, platform tenant/plan CRUD (API) | Cross-tenant test harness in place and green; PE-1…PE-7 tests green |
| **M2** | Properties and inventory setup | Properties, settings, room types, rooms (tracked mode), holidays, setup wizard UI, app shell, design system v1 | Hotel admin can onboard and configure a property end-to-end |
| **M3** | **Availability engine** | `packages/domain` LocalDate/stay math, InventoryLedger, horizon roll, blocks + OOS (count and room-specific), stop-sell, availability grid UI, reconciliation job | AV-*, BL-*, OOS-*, CC-* (blocks) and property-based tests green; reconciliation clean after randomised load |
| **M4** | **Booking engine** | Guests, booking create/modify/cancel, state machine, holds + expiry job, front-desk actions, room assignment + suggestions, idempotency, duplicate detection, booking list/detail/new pages, tape chart (read + open) | CC-01 (50-way last-room race) green; MD-*, CN-*, DT-*, HOLD-*, IDEM-* green |
| **M5** | B2B | Agencies, agency access lifecycle, scope, visibility projection, agency invite flow, agent portal (dashboard, search, recent searches), agency user management, search logging + rate limits | TA-* green; projection contract tests green; agent can't reach any tenant endpoint |
| **M6** | Dashboards and reports | Hotel/agent/platform dashboards, P0 reports, CSV/XLSX exports (async), read replica wiring | Report numbers reconcile with engine fixtures |
| **M7** | Notifications | Outbox dispatcher, email channel + templates, in-app notification centre, hold/expiry warnings, low/full availability alerts | Delivery retries and deduplication tested |
| **M8** | Subscriptions and limits | Entitlement service, plan limits enforcement, platform subscription management UI, public pricing from API, marketing site | PLAN_LIMIT tests green; downgrade behaviour verified |
| **M9** | Hardening | Security review against Phase 11, CSP, rate-limit tuning, load test (k6), a11y audit (axe + manual), backup/restore drill, pen test | No high/critical findings open; SLOs met under design-point load |
| **M10** | Launch | Production infrastructure, monitoring/alerting, runbooks, beta tenants, support process | Beta hotels live; reconciliation clean for 14 days |

### Parallel workstreams (large team; launch date open)

M0 and the contracts for M1 come first and are short; they unblock everyone. After that, workstreams run in parallel against shared interfaces: Zod contracts, the `InventoryLedger` interface, and the permission catalogue.

| Workstream | Owns | Starts after |
|---|---|---|
| Platform & DevOps | M0, CI, environments, VPS/infra, observability, backups | immediately |
| Identity & Security | M1 (auth, RBAC, RLS, audit), security suites, pen-test liaison | M0 |
| Inventory & Availability | M3 engine, blocks, OOS, stop-sell, reconciliation | M1 tenancy layer |
| Bookings | M4 booking engine, guests, front desk, holds | Ledger interface agreed (can stub) |
| B2B | M5 agencies, access, agent portal, requests | M1 + availability read API |
| Frontend & Design system | `packages/ui`, app shells, M2 setup screens, then each module's UI | M0 |
| Reports & Notifications | M6, M7 | Engine + booking schemas stable |
| Commercial | M8 subscriptions, marketing site | M1 |
| QA | Test harnesses (Testcontainers, concurrency, cross-tenant matrix, Playwright) from day one | M0 |

Rules for working in parallel:
- A module merges only with its tests.
- Schema changes go through one migration owner per week.
- The engine and booking modules require review by two engineers.

Launch is gated on exit criteria, not dates.

Phase 13 (implementation) proceeds module by module in this order. Each module ships with its schema migration, domain logic, API, UI and tests together.

## 2. Phase 14 — Test strategy

| Level | Tooling | Focus |
|---|---|---|
| Unit | Vitest | `packages/domain`: date math, availability formulas, classification, state machine, projection, permission resolution. Target 100 % branch coverage for domain. |
| Property-based | fast-check | Random sequences of create/modify/cancel/block/release/total-change → invariant holds and counters = reconciliation oracle |
| Integration | Vitest + **Testcontainers** (real Postgres 16 + Redis) | Repositories, RLS, constraints, ledger locking, services, job handlers |
| Concurrency | Integration harness with N parallel connections | Races, deadlock freedom, retry behaviour |
| API contract | Supertest against NestJS + Zod response validation | Status codes, error codes, field-level stripping, OpenAPI conformance |
| Security | Dedicated suites | Cross-tenant matrix (auto-generated from the route table), authz matrix (role × endpoint), CSRF, rate limits, session lifecycle |
| E2E | Playwright | Critical journeys across the three portals |
| Load | k6 | Search p95, booking p95, contention on hot room types |
| Accessibility | axe-core in Playwright + manual screen-reader passes | WCAG 2.2 AA |

### Named test cases (minimum set; IDs referenced by milestones)

**Availability and dates**
- **AV-01** The brief's example (10 Deluxe; A 1–3 Oct × 2; B 2–5 Oct × 3) → per-date 8/5/7/7/10; stay 1–5 Oct min = 5.
- **AV-02** One room remaining: booking 1 succeeds; booking 2 for an overlapping night → `NO_AVAILABILITY` with the correct shortfall.
- **AV-03** Non-overlapping bookings on the last room (different nights) both succeed.
- **AV-04** Multiple room types in one booking: shortfall on one type rejects the whole booking.
- **AV-05** Multiple properties: inventory and bookings in property 1 never affect property 2.
- **DT-01** Back-to-back on 1 room: A `[10, 12)`, B `[12, 14)` → both succeed. Room available on 12 Oct.
- **DT-02** `checkOut = checkIn` and `checkOut < checkIn` → `INVALID_DATE_RANGE`.
- **DT-03** Business date at timezone extremes (Pacific/Kiritimati UTC+14, Pacific/Pago_Pago UTC−11) around UTC midnight; walk-in allowed or denied correctly.
- **DT-04** Month/year boundaries and leap day (stay 28 Feb–1 Mar 2028 = 2 nights).
- **DT-05** Horizon and max-stay limits; back-dating requires `booking.backdate`.

**Concurrency**
- **CC-01** 50 parallel requests for the last room → exactly 1 created, 49 `NO_AVAILABILITY`, counters = oracle.
- **CC-02** Parallel bookings with overlapping ranges submitted in conflicting orders → no deadlock surfaces to users (retries succeed), invariant holds.
- **CC-03** Block creation racing a booking for the last room → exactly one wins.
- **CC-04** Total-inventory reduction racing bookings → no state where consumed > total.
- **CC-05** Two clerks assign the same physical room to overlapping stays → one gets `ROOM_UNAVAILABLE`.

**Booking lifecycle**
- **CN-01** Cancellation releases nights ≥ business date only. Past nights stay counted.
- **CN-02** Partial cancellation (1 of 3 lines) releases exactly one room per night.
- **CN-03** Cancel twice → `INVALID_STATUS_TRANSITION` (or idempotent replay with the same key).
- **MD-01** Extending into a full night → 409, booking unchanged (dates, lines, counters, version).
- **MD-02** Shortening releases nights. Moving dates nets correctly when old and new ranges overlap.
- **MD-03** Changing room type moves consumption atomically between types.
- **MD-04** Stale `If-Match` → 412.
- **HOLD-01** A tentative hold expires → status EXPIRED, inventory released, notification queued.
- **HOLD-02** Confirm racing expiry → exactly one outcome, consistent counters.
- **FD-01** Check-in before arrival → rejected. Early check-out releases the remaining nights. Overstay requires extension.
- **FD-02** No-show releases nights ≥ business date.
- **IDEM-01** The same Idempotency-Key twice → one booking, identical responses. Same key + different body → 422.
- **DUP-01** A duplicate guest/stay → warning. With `acknowledgeDuplicate` → created.

**Blocks and maintenance**
- **BL-01** A block exceeding availability → `INVENTORY_CONFLICT`. With override permission + tenant enabled → allowed, allowance set, audited.
- **BL-02** Partial release by date and by quantity → counters and history exact.
- **OOS-01** Room-specific OOS reduces the count and prevents assignment of that room.
- **OOS-02** Archiving a room / reducing total below future commitments → rejected with the conflicting nights.

**Travel agents**
- **TA-01** Pending access → 403 `AGENCY_ACCESS_PENDING`. Rejected → `_REJECTED`.
- **TA-02** Expired (`validTo` = yesterday in the property timezone) → denied even before the expiry job runs.
- **TA-03** Suspended mid-session → the next request is denied; sessions are invalidated.
- **TA-04** Room type out of scope → absent from results. Direct request with its ID → 404.
- **TA-05** Each visibility level returns exactly its field set (strict contract snapshot); negative availability shows as 0.
- **TA-06** An agent can't see other agencies' requests, or other users' requests without `b2b.request.viewAgency`.
- **TA-07** An agent session calling any `/api/v1/*` tenant endpoint → 401/403. Agent write attempts on inventory are impossible (no routes).
- **TA-08** Rate limits apply and searches are logged.

**Isolation and authorization**
- **XT-01** Generated matrix: every tenant endpoint × Tenant B resource IDs as a Tenant A user → 404, empty body, security metric emitted.
- **XT-02** DB level: queries as `sd_app` without `app.tenant_id` return 0 rows. Inserting with a mismatched `tenant_id` fails (RLS `WITH CHECK` + composite FK).
- **XT-03** `sd_platform` can't select from `booking`/`guest`.
- **AZ-01** Staff without `booking.cancel` → 403. The UI hides the action.
- **AZ-02** PE rules: can't grant unheld permissions, edit own role, or remove the last owner.
- **AZ-03** Unauthenticated → 401. Missing/invalid CSRF token → 403. A session cookie from `agent.` doesn't work on `app.`.
- **AZ-04** Property-scoped staff can't read or write another property (404).

**Reconciliation**
- **REC-01** Injected drift (manual counter change) is detected and reported, and never auto-repaired silently.

## 3. Phase 15 — Deployment outline

### 3.1 Why not shared hosting
Shared hosting (cPanel-style) can't run this system. StayDesk needs:
- long-running Node.js processes: the API, and a worker for holds, expiry, notifications and reconciliation
- PostgreSQL 16 with extensions (`btree_gist`, `citext`, `pg_trgm`) and row-level security
- Redis
- control over the reverse proxy and TLS

Shared plans provide PHP + MySQL at best.

### 3.2 Stage 1: VPS (initial target; confirmed 2026-10-05)
Everything runs with **Docker Compose** on Linux VPS servers (any provider: Hetzner, DigitalOcean, Hostinger VPS, Contabo, AWS Lightsail, etc.).

| Server | Size (start) | Runs |
|---|---|---|
| App VPS | 4 vCPU / 8 GB RAM / 80 GB SSD | Caddy (reverse proxy, automatic HTTPS for `www/app/agent/admin`, `/api` routing), `site`, `web`, `api` (2 replicas), `worker`, Redis |
| DB VPS | 4 vCPU / 8–16 GB RAM / NVMe SSD | PostgreSQL 16 (tuned), PgBouncer, WAL-G continuous backup |
| Staging | 2 vCPU / 4 GB (single box) | Full stack with synthetic data |

Supporting services (no lock-in; all have alternatives):
- **Object storage:** S3-compatible service (Cloudflare R2, Backblaze B2, Wasabi or the VPS provider's own) for uploads, exports, backups, audit archives.
- **Email:** SMTP/API provider (Amazon SES, Brevo, Postmark) with SPF/DKIM/DMARC.
- **Edge:** Cloudflare (DNS, CDN, WAF, DDoS protection) in front of the app VPS. The firewall allows only Cloudflare IPs on 80/443 and SSH from admin IPs (key-only).
- **Backups:**
  - WAL-G to off-site object storage (PITR, 35 days) plus nightly `pg_dump` (logical backup)
  - **quarterly restore drill** (mandatory)
  - VPS provider snapshots weekly
- **Monitoring:** Uptime checks, Sentry, Grafana Cloud free tier (or self-hosted Prometheus/Grafana/Loki), alerts to email/Slack.
- **Secrets:** `.env` files are root-only, encrypted at rest (SOPS + age) in a private infrastructure repo, and never in the app repo.

Deploy: CI builds images → pushes to a registry (GHCR) → SSH deploy runs `docker compose pull && docker compose up -d` with a migration step first. Downtime-free rolling restarts via 2 API replicas behind Caddy.

### 3.3 Stage 2: scale-up path (when load or availability needs it)
Same containers, no code changes:
1. Move PostgreSQL to a managed service (with a read replica).
2. Run multiple app VPSs behind a load balancer.
3. Move to container orchestration.

Reference cloud: **AWS ap-south-1 (Mumbai)**, as below. Everything stays cloud-agnostic: containers plus Postgres, Redis and S3-compatible storage.

| Component | Service |
|---|---|
| CDN / WAF | CloudFront + AWS WAF (managed rules, bot control, rate rules) |
| Routing | ALB: host rules (`www`, `app`, `agent`, `admin`), path rule `/api/*` → API |
| Compute | ECS Fargate services: `site`, `web`, `api`, `worker` (min 2 tasks for web/api across AZs) |
| Database | RDS PostgreSQL 16 Multi-AZ, PITR (35 days), read replica, RDS Proxy or PgBouncer |
| Cache / queues | ElastiCache Redis (cluster mode off, Multi-AZ) |
| Storage | S3 (private uploads, exports with lifecycle rules, audit archive with Object Lock) |
| Email | SES (dedicated domain, SPF/DKIM/DMARC) |
| Secrets / keys | Secrets Manager, KMS |
| Observability | OpenTelemetry collector → Grafana Cloud or CloudWatch; Sentry; uptime checks; on-call alerts |
| IaC | Terraform, one workspace per environment |

**CI/CD (GitHub Actions):** lint → typecheck → unit → integration (Testcontainers) → security suites → build images → scan → deploy to staging → E2E smoke → manual approval → production (rolling).

**Migrations:**
- Prisma migrate in a separate one-off task before rollout, using expand/contract for breaking changes: add new → dual-write → backfill → switch reads → remove old.
- Never destructive in the same release as the code change.
- RLS and constraint SQL is versioned in the same migration stream.

**Operations:**
- Runbooks: reconciliation drift, queue backlog, email bounces, lock contention spikes, tenant data export/offboarding, security incident.
- Quarterly restore drills. SLO dashboards for search/booking latency, error rate, job lag.
