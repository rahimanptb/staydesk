# Phase 11 — Security Architecture

Baseline: **OWASP ASVS Level 2**, OWASP Top 10 (2021) and the API Security Top 10 (2023).

## 1. Threat model (summary)

| Asset | Threat | Primary controls |
|---|---|---|
| Tenant operational data | Cross-tenant access, IDOR | Session-derived tenant, scope guards, tenant-scoped repository, **Postgres RLS**, composite FKs, cross-tenant CI suite |
| Inventory integrity | Overselling, race conditions, tampering | Single ledger writer, ordered row locks, CHECK constraint, audit, reconciliation |
| Guest PII | Leakage via agents, exports, logs, platform staff | Audience mappers, PII permissions, `sd_platform` without grants, log redaction, export permissions + expiring links |
| Accounts | Credential stuffing, phishing, session theft | Argon2id, rate limits/lockout, breached-password check, TOTP, host-only `__Host-` cookies, session rotation |
| Agent channel | Scraping, sharing access, privilege abuse | Live BR-17 checks, visibility levels, per-user/agency rate limits, search logging, anomaly alerts |
| Platform admin | Insider misuse, account takeover | Separate host, mandatory 2FA, short sessions, optional IP allowlist, no operational-data grants, grant-based support access, platform audit |
| Audit trail | Repudiation, tampering | Same-transaction writes, no UPDATE/DELETE grants, monthly partitions archived to WORM storage (S3 Object Lock) |
| Files | Malware, stored XSS, path traversal | Presigned uploads to a private bucket, magic-byte validation, re-encoding, AV scan, random keys, `Content-Disposition: attachment` for non-images |

## 2. Authentication

- **Passwords:**
  - hashed with Argon2id (memory 64 MiB, 2 passes, parallelism 1; tune to ~250–400 ms on production hardware) using Node's built-in implementation (OpenSSL), with a random 16-byte salt per hash, stored as a standard PHC string so parameters can be raised later
  - pepper held in the secret manager and passed as Argon2's secret input (K), so a stolen database alone cannot be brute-forced
- **Policy:** minimum 10 characters, no composition rules, blocked if found in the breached corpus (HIBP k-anonymity, P1), max 128 characters. The password itself is never logged.
- **Login:**
  - constant-time comparison; a dummy hash for unknown emails (no timing-based enumeration)
  - generic error message
  - rate limits per account and IP; lockout 15 min after 10 consecutive failures, with an email notice to the user
- **Sessions:**
  - opaque 256-bit random token; only its SHA-256 hash is stored
  - cookie flags: `__Host-sd_session; Secure; HttpOnly; SameSite=Lax; Path=/` (no Domain attribute, so the cookie stays host-only)
  - **rotated** on login, MFA verification, privilege change and context switch
  - idle/absolute timeouts:

    | Portal | Idle | Absolute |
    |---|---|---|
    | Hotel | 8 h | 7 days |
    | Agent | 2 h | 7 days |
    | Platform | 30 min | 12 h |

  - all sessions revoked on password change/reset, membership revocation, or user disable
- **2FA:**
  - TOTP (RFC 6238, 30 s, ±1 step) with the secret encrypted using AES-256-GCM (data key from KMS)
  - 10 single-use recovery codes, hashed
  - mandatory for platform users; tenants can enforce it for staff (`tenant.require_staff_2fa`)
  - step-up re-authentication for sensitive actions: disabling 2FA, changing email, ownership transfer, support grants
  - WebAuthn/passkeys in P2
- **Tokens** (verify, reset, invite): 256-bit random, stored hashed, single-use, short TTL (reset 30 min, verify 24 h, invite 72 h), and invalidated when a newer one is issued.
- **Email change:** confirmation sent to the new address, plus a notice to the old address with a revert link valid for 72 h.

## 3. Authorization

- Deny by default: every route must declare a permission (CI check + boot-time assertion).
- Tenant and agency context come **only from the server-side session**. IDs in the body or path identify resources within the context and never select it.
- Resource lookups are always scoped: `WHERE id = $id AND tenant_id = ctx.tenant` (repository helper) *and* RLS. Out-of-scope resources return **404** and emit a `security.scope_violation` metric. A spike alerts.
- Field-level authorization lives in response mappers (internal notes, financials, PII).
- Privilege-escalation rules PE-1…PE-7 (Phase 2 §7) are enforced in the service layer with dedicated tests.
- Agents get an extra policy layer (BR-17) on every request; there is no long-lived cached decision.

## 4. Tenant isolation: defence in depth

| Layer | Mechanism | Catches |
|---|---|---|
| 1 | Context from session; portal host must match session context | Spoofed tenant/agency headers or params |
| 2 | Guards: permission + property scope + agency policy | Missing authorization |
| 3 | Tenant-scoped repository (Prisma extension injects `tenant_id` filters/values) | Forgotten `where` clauses |
| 4 | **PostgreSQL RLS** on every tenant table. Runtime roles never own tables, so policies always apply. Context functions such as `app_tenant_id()` fail closed. | Bugs in layers 1–3, raw SQL mistakes |
| 5 | Composite FKs `(tenant_id, parent_id)` | Cross-tenant references in writes |
| 6 | DB role separation (`sd_platform` has no operational grants) | Platform-side leaks |
| 7 | Automated tests: for every endpoint, call it as Tenant A with Tenant B's IDs → 404 and no data; DB tests run raw queries without context → 0 rows | Regressions |

## 5. Web and API hardening

- **CSRF:** `SameSite=Lax` cookies + a per-session CSRF token in the `X-CSRF-Token` header for unsafe methods + `Origin`/`Sec-Fetch-Site` validation. The API never accepts form-encoded bodies.
- **XSS:**
  - React auto-escaping; `dangerouslySetInnerHTML` is banned by lint
  - no user-provided HTML in v1; notes are plain text, rendered with preserved line breaks
  - **strict CSP** with per-request nonces: `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
- **SQL injection:** Prisma parameterisation; raw SQL only through `$queryRaw` tagged templates; `$queryRawUnsafe` and `$executeRawUnsafe` banned by lint; dynamic sort/filter columns come from allow-lists.
- **Input validation:** strict Zod schemas (unknown keys rejected), length and range limits on every field, 1 MB body limit, UUID format checks, date parsing via `LocalDate.parse` only.
- **Headers:** HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic, geolocation off), `Cross-Origin-Opener-Policy: same-origin`, `Cache-Control: no-store` on authenticated API responses.
- **Rate limiting:** Redis sliding windows (Phase 7 §4), plus WAF rules at the CDN (bot management, geo rules optional per platform setting).
- **Errors:** RFC 9457 bodies without internals; stack traces only in server logs, correlated by `requestId`.
- **Mass assignment:** DTO-to-entity mapping is explicit. Fields like `tenantId`, `status`, `isOwner` and `version` are never taken from request bodies except through their dedicated endpoints.
- **Enumeration:** forgot-password, signup and invitation endpoints return identical responses whether or not the email exists.

## 6. Secrets and configuration

- All secrets live in a cloud secret manager and are injected as environment variables at runtime, validated at boot. Nothing is in the repository; `gitleaks` runs in CI and in a pre-commit hook.
- The frontend bundle contains no secrets. Only allow-listed `NEXT_PUBLIC_*` values are allowed (lint).
- KMS-managed keys: TOTP secrets, the password pepper, the webhook signing key (P2). Rotation is documented.
- Database credentials are per role (`sd_app`, `sd_platform`, `sd_worker`, `sd_readonly`), rotated through the secret manager.

**Stage 1 (VPS) equivalents** for the cloud services named in this document:

| Cloud service | VPS equivalent |
|---|---|
| Secret manager | SOPS + age-encrypted env files, deployed root-only (`chmod 600`) |
| KMS-managed keys | Master key in the encrypted env; application-level AES-256-GCM envelope encryption (same code path, swappable for KMS later) |
| S3 Object Lock audit archive | Object-lock/immutable buckets on R2/B2/Wasabi |
| RDS/S3 encryption at rest | Provider disk encryption + encrypted backups (WAL-G with libsodium) |
| CloudFront/WAF | Cloudflare WAF, rate rules and DDoS protection; origin firewall allows only Cloudflare IPs |
| Host hardening | Unattended security updates, SSH key-only with fail2ban, non-root containers, Docker rootless or userns-remap, CIS-style baseline |

## 7. File handling

1. The client requests an upload: `POST /files/uploads {purpose, mimeType, size}`. Purpose-based allow-lists apply (images: JPEG/PNG/WebP, ≤ 10 MB).
2. The server returns a presigned `PUT` to a **private** bucket under a random key (`tenant/{tid}/{uuid}`) with content-type and length conditions.
3. `POST /files/{id}/complete` → the worker verifies the magic bytes, re-encodes images with `sharp` (which strips EXIF/GPS), scans for malware (ClamAV, P1), and sets `scan_status = CLEAN`.
4. Files are served through short-lived signed URLs, or a CDN with signed cookies for public property images. Exports use 15-minute signed URLs and are deleted after 7 days.

## 8. Logging, monitoring, audit

- Structured JSON logs with `requestId`, `tenantId`, `userId`, route, latency and status.
- **Redaction** of `password`, `token`, `authorization`, `cookie`, `email`, `phone` and guest names in logs.
- **Security events** (login failures, lockouts, MFA changes, permission denials, scope violations, agent rate-limit hits, support sessions) go to a dedicated stream with alert rules.
- The **audit log** (business actions) is separate from technical logs. It is transactional, immutable for runtime roles, visible to tenant admins, and exportable.

## 9. Data protection and privacy

- Encryption in transit (TLS 1.2+ everywhere, including to the database and Redis) and at rest (RDS/S3/Redis encryption with KMS).
- Data minimisation: agents never receive guest data; platform staff never receive operational data without a grant.
- Retention defaults (configurable per tenant within platform bounds):

  | Data | Kept for |
  |---|---|
  | Audit | 7 years |
  | Agent search log | 13 months |
  | Sessions | 90 days after expiry |
  | Guests | anonymised N years after last stay (tenant setting) |

- Data-subject requests: export of a guest's data (`guest.export`) and anonymisation. Tenant offboarding: export of all tenant data, then deletion after 30 days, with backups ageing out within 35 days.
- DPDP (India) / GDPR alignment: DPA template, sub-processor list, breach notification runbook.

## 10. Supply chain and SDLC

- Lockfile-pinned dependencies; Renovate for updates; `pnpm audit` / OSV scanning in CI; licence checks.
- SAST (CodeQL + Semgrep rules for `$queryRawUnsafe`, `dangerouslySetInnerHTML`, missing permission decorators).
- Container images built from minimal bases (distroless/alpine), scanned (Trivy), run as non-root with read-only filesystems.
- Branch protection: required reviews, required checks (including the cross-tenant and concurrency suites), signed commits recommended.
- **Pre-launch:** independent penetration test focused on tenant isolation, the agent portal and auth. Then annually, and after major changes.
