# StayDesk

Multi-tenant SaaS for hotel and resort **room inventory, bookings and B2B travel-agent availability**.

> **Status:** Design (Phases 1–12) is complete. Phase 13 milestones **M0 (foundations)**, **M1 (identity, tenancy, roles and permissions, audit)**, **M2 (properties, room types and rooms)** and **M3 (availability engine: inventory ledger, blocks, out of service, stop-sell, availability calendar, reconciliation)** are done. Next is **M4: the booking engine**.

## Getting started

Prerequisites:

- Node.js 24 LTS
- pnpm 12
- Git
- Docker Desktop (with WSL 2 on Windows)

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm infra:up
```

```bash
pnpm db:migrate
```

```bash
pnpm build
```

Create the first Super Admin. This prints a one-time setup link; open it, choose a password, then sign in on the admin portal and set up two-factor authentication:

```bash
pnpm --filter @staydesk/api bootstrap:super-admin --email you@example.com --name "Your Name"
```

```bash
pnpm dev
```

| What                  | Where                                                |
| --------------------- | ---------------------------------------------------- |
| Hotel portal          | http://app.localhost:3000 (or http://localhost:3000) |
| Agent portal          | http://agent.localhost:3000                          |
| Platform admin        | http://admin.localhost:3000                          |
| API health            | http://localhost:4000/api/v1/health/ready            |
| Dev mailbox (Mailpit) | http://localhost:8025                                |

Quality gates (also run in CI): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`.

`pnpm test:integration` needs Docker. It runs the database security suite against a throwaway PostgreSQL container, covering:

- row-level security across tenants
- role grants
- append-only records
- the overselling and double-allocation constraints
- schema drift

## Repository layout

| Path                 | Contents                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js 16: hotel (`app.`), agent (`agent.`) and admin (`admin.`) portals, routed by host in `src/proxy.ts`                             |
| `apps/api`           | NestJS 12 on Fastify: REST API under `/api/v1`, RFC 9457 errors, health checks                                                          |
| `apps/worker`        | NestJS standalone process for background jobs                                                                                           |
| `packages/domain`    | Pure business rules, no I/O: `LocalDate`/stays, the availability planner, agent visibility, booking state machine, permission catalogue |
| `packages/db`        | Prisma 7 schema, migrations (including hand-written constraints, row-level security and grants), database client with RLS context       |
| `packages/contracts` | API schemas and the error-code catalogue shared by web and API                                                                          |
| `packages/config`    | Brand constants (rename the product in one file) and environment validation                                                             |
| `infra`              | Docker Compose for local PostgreSQL 16, Redis 7 and Mailpit; database role setup script                                                 |
| `docs`               | Design documents                                                                                                                        |

## Conventions

- **Stay dates are `LocalDate`, never JS `Date`.** Enforced by lint in `packages/domain`.
- **All tenant-scoped database work runs inside `withDbContext`.** It sets the row-level security context. Every table with a `tenant_id` must have an RLS policy.
- **NestJS providers are injected with explicit tokens:** `@Inject(TOKEN)` on every constructor parameter. Tests then don't depend on decorator-metadata emission.
- **Errors leave the API only as problem+json** with a stable `code` from `packages/contracts`. Throw `ApiError` or `DomainError`; never return ad-hoc error bodies.
- **Unsafe raw SQL and `dangerouslySetInnerHTML` are banned** by lint.

## Design documents

| Phase      | Document                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1 & 3      | [Product requirements, challenged requirements, business rules, feature list](docs/01-product-requirements.md) |
| 2          | [Roles & permissions](docs/02-roles-and-permissions.md)                                                        |
| 4          | [User flows](docs/03-user-flows.md)                                                                            |
| 5          | [Database architecture](docs/04-database-architecture.md)                                                      |
| 6          | [System architecture](docs/05-system-architecture.md)                                                          |
| 7          | [API architecture](docs/06-api-architecture.md)                                                                |
| 8          | [UI/UX structure](docs/07-ui-ux-structure.md)                                                                  |
| 9          | [Availability engine](docs/08-availability-engine.md)                                                          |
| 10         | [Booking engine](docs/09-booking-engine.md)                                                                    |
| 11         | [Security architecture](docs/10-security-architecture.md)                                                      |
| 12, 14, 15 | [Development plan, test plan, deployment](docs/11-development-plan.md)                                         |

## Confirmed decisions (2026-10-05)

| Topic                    | Decision                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Agent bookings           | **Request-only.** Agents submit requests that consume no inventory; hotel staff confirm through the normal engine.    |
| Agent visibility default | **Full breakdown** (Total / Booked / Blocked / OOS / Available). Hotels can lower it per property or per agency.      |
| Hotel onboarding         | Super Admin creates tenants, plus optional self-signup with approval                                                  |
| Hosting                  | **VPS with Docker Compose** first (shared hosting cannot run this stack); same containers move to managed cloud later |
| Currency                 | One per property, **INR** default                                                                                     |
| Product name             | **StayDesk** (one-file rename via `packages/config/src/brand.ts`)                                                     |
| Team / timeline          | Large team working in parallel workstreams; launch gated on exit criteria, not dates                                  |

## Architecture in brief

1. **Tenant ≠ hotel.** A tenant is the customer account; a property is a hotel/resort.
2. **Agencies are platform identities.** Each hotel's `AgencyAccess` is private, inactive by default, and scoped to properties and room types.
3. **Availability is date-wise.** The `inventory_day` projection is written only under ordered row locks. A database CHECK constraint makes overselling impossible.
4. **Stays are half-open `[checkIn, checkOut)`** in the property's timezone.
5. **Tenant isolation in layers:**
   - session-derived context
   - permission guards
   - PostgreSQL row-level security
   - composite foreign keys
   - separate database roles: the platform role has no access to guest or booking tables
