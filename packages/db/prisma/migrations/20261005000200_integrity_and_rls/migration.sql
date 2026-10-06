-- Integrity constraints, context functions, row-level security and grants that Prisma
-- cannot express. Design: docs/04-database-architecture.md §5, docs/10-security-architecture.md §4.
--
-- Prerequisite: the runtime roles exist (infra/postgres/init/01-roles.sh):
--   sd_app      API (tenant + agency contexts)      RLS applies
--   sd_worker   background jobs                      RLS applies
--   sd_platform platform admin API                   BYPASSRLS, but no grants on operational tables
--   sd_readonly reporting                            RLS applies
-- Tables are owned by the migration role, which is never used at runtime. RLS is enabled (not
-- forced), so SECURITY DEFINER functions owned by the migration role can expose narrowly-defined
-- cross-tenant results (e.g. job candidates) without granting broad access.

-- ───────────────────────────── Context functions ─────────────────────────────
-- Fail closed: a missing or empty setting yields NULL, which matches no rows.

CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_agency_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.agency_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- "Today" for a property (BR-03).
CREATE FUNCTION business_date(p_timezone text) RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (now() AT TIME ZONE p_timezone)::date $$;

-- ───────────────────────────── CHECK constraints ─────────────────────────────

ALTER TABLE tenant
  ADD CONSTRAINT tenant_country_iso CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE plan_price
  ADD CONSTRAINT plan_price_amount_nonnegative CHECK (amount_minor >= 0),
  ADD CONSTRAINT plan_price_currency_iso CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE property
  ADD CONSTRAINT property_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT property_country_iso CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT property_times_hhmm CHECK (
    check_in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND check_out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT property_ref_prefix CHECK (booking_ref_prefix ~ '^[A-Z0-9]{2,8}$'),
  ADD CONSTRAINT property_policy_ranges CHECK (
    child_max_age BETWEEN 0 AND 17
    AND tentative_hold_hours BETWEEN 1 AND 336
    AND low_availability_threshold >= 0
    AND booking_horizon_days BETWEEN 1 AND 1095
    AND max_stay_nights BETWEEN 1 AND 365
    AND agent_count_cap >= 1
    AND agent_request_expiry_hours BETWEEN 1 AND 720);

ALTER TABLE room_type
  ADD CONSTRAINT room_type_occupancy CHECK (
    max_adults >= 1 AND max_children >= 0 AND max_occupancy >= 1
    AND max_occupancy <= max_adults + max_children),
  ADD CONSTRAINT room_type_total_nonnegative CHECK (total_inventory >= 0),
  ADD CONSTRAINT room_type_rate_nonnegative CHECK (base_rate_minor IS NULL OR base_rate_minor >= 0);

-- The overselling backstop (docs/08 §2): no code path can commit consumption above capacity.
ALTER TABLE inventory_day
  ADD CONSTRAINT inventory_day_nonnegative CHECK (
    total >= 0 AND booked >= 0 AND held >= 0 AND blocked >= 0
    AND out_of_service >= 0 AND overbook_allowance >= 0),
  ADD CONSTRAINT inventory_day_capacity CHECK (
    booked + held + blocked + out_of_service <= total + overbook_allowance);

ALTER TABLE room_block
  ADD CONSTRAINT room_block_dates CHECK (end_date >= start_date AND original_end_date > start_date
    AND end_date <= original_end_date),
  ADD CONSTRAINT room_block_quantity CHECK (quantity > 0 AND original_quantity >= quantity),
  ADD CONSTRAINT room_block_room_specific CHECK (room_id IS NULL OR quantity = 1);

ALTER TABLE stop_sell
  ADD CONSTRAINT stop_sell_dates CHECK (end_date > start_date);

ALTER TABLE room_allocation
  ADD CONSTRAINT room_allocation_single_source CHECK (num_nonnulls(booking_room_id, room_block_id) = 1),
  ADD CONSTRAINT room_allocation_dates CHECK (end_date >= start_date),
  -- A physical room can never be allocated to two overlapping stays/blocks (BR-11).
  ADD CONSTRAINT room_allocation_no_overlap
    EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date, '[)') WITH &&);

ALTER TABLE booking
  ADD CONSTRAINT booking_dates CHECK (check_out > check_in),
  ADD CONSTRAINT booking_occupancy CHECK (adults >= 1 AND children >= 0),
  ADD CONSTRAINT booking_agent_source CHECK (source <> 'TRAVEL_AGENT' OR agency_access_id IS NOT NULL),
  ADD CONSTRAINT booking_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT booking_amounts CHECK (total_amount_minor IS NULL OR total_amount_minor >= 0),
  ADD CONSTRAINT booking_version CHECK (version >= 1);

ALTER TABLE booking_room
  ADD CONSTRAINT booking_room_dates CHECK (check_out > check_in AND inv_to >= inv_from),
  ADD CONSTRAINT booking_room_occupancy CHECK (adults >= 1 AND children >= 0),
  ADD CONSTRAINT booking_room_cancelled_consumes_nothing CHECK (status = 'ACTIVE' OR inventory_bucket = 'NONE');

ALTER TABLE booking_payment
  ADD CONSTRAINT booking_payment_sign CHECK (
    (type IN ('PAYMENT', 'REFUND') AND amount_minor > 0) OR (type = 'ADJUSTMENT' AND amount_minor <> 0));

ALTER TABLE booking_request
  ADD CONSTRAINT booking_request_dates CHECK (check_out > check_in),
  ADD CONSTRAINT booking_request_party CHECK (rooms >= 1 AND adults >= rooms AND children >= 0);

ALTER TABLE waitlist_entry
  ADD CONSTRAINT waitlist_entry_dates CHECK (check_out > check_in),
  ADD CONSTRAINT waitlist_entry_party CHECK (rooms >= 1 AND adults >= 1 AND children >= 0);

ALTER TABLE agency_access
  ADD CONSTRAINT agency_access_validity CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  ADD CONSTRAINT agency_access_count_cap CHECK (count_cap IS NULL OR count_cap >= 1);

-- ───────────────────────────── Row-level security ─────────────────────────────

-- Standard tenant isolation for every table that carries a NOT NULL tenant_id.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscription', 'tenant_entitlement_override', 'idempotency_record', 'support_access_grant',
    'property', 'holiday', 'amenity', 'property_image',
    'room_type', 'room_type_amenity', 'room_type_image', 'room',
    'inventory_day', 'room_block', 'stop_sell', 'room_allocation',
    'guest', 'booking_sequence', 'booking', 'booking_room', 'booking_payment', 'waitlist_entry',
    'agency_access', 'agency_access_property', 'agency_access_room_type', 'agent_search_log',
    'membership_property', 'export_job'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO sd_app, sd_worker, sd_readonly '
      'USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- Tenants: the current tenant, plus (before a context is chosen at login) the user's own tenants.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_visible ON tenant TO sd_app, sd_worker, sd_readonly
  USING (id = app_tenant_id()
         OR id IN (SELECT m.tenant_id FROM tenant_membership m WHERE m.user_id = app_user_id()))
  WITH CHECK (id = app_tenant_id());

ALTER TABLE tenant_membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_visible ON tenant_membership TO sd_app, sd_worker, sd_readonly
  USING (tenant_id = app_tenant_id() OR user_id = app_user_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Roles: global (platform/agency) roles are readable; only the tenant's own roles are writable.
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_visible ON role TO sd_app, sd_worker, sd_readonly
  USING (tenant_id IS NULL OR tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permission_visible ON role_permission TO sd_app, sd_worker, sd_readonly
  USING (role_id IN (SELECT r.id FROM role r))
  WITH CHECK (role_id IN (SELECT r.id FROM role r WHERE r.tenant_id = app_tenant_id()));

-- Agencies: hotels see agencies they have a relationship with; agency users see their own.
ALTER TABLE agency ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_visible ON agency TO sd_app, sd_readonly
  USING (id = app_agency_id()
         OR id IN (SELECT a.agency_id FROM agency_access a WHERE a.tenant_id = app_tenant_id())
         OR id IN (SELECT m.agency_id FROM agency_membership m WHERE m.user_id = app_user_id()))
  WITH CHECK (id = app_agency_id());
CREATE POLICY agency_worker_read ON agency FOR SELECT TO sd_worker USING (true);

-- Booking requests: the hotel's tenant, or the requesting agency.
ALTER TABLE booking_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_request_visible ON booking_request TO sd_app, sd_worker, sd_readonly
  USING (tenant_id = app_tenant_id() OR agency_id = app_agency_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Files: tenant files only (platform-level files are handled by sd_platform).
ALTER TABLE file_object ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_object_visible ON file_object TO sd_app, sd_worker, sd_readonly
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Audit: tenant actions, or an agency's own actions that are not tied to a tenant.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_visible ON audit_log TO sd_app, sd_worker, sd_readonly
  USING (tenant_id = app_tenant_id() OR (tenant_id IS NULL AND actor_agency_id = app_agency_id()))
  WITH CHECK (tenant_id = app_tenant_id() OR (tenant_id IS NULL AND actor_agency_id = app_agency_id()));

-- Notifications belong to a user; the worker creates and delivers them for everyone.
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_own ON notification TO sd_app, sd_readonly
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY notification_worker ON notification TO sd_worker USING (true) WITH CHECK (true);

ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preference_own ON notification_preference TO sd_app, sd_readonly
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY notification_preference_worker ON notification_preference FOR SELECT TO sd_worker USING (true);

ALTER TABLE notification_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_template_visible ON notification_template TO sd_app, sd_worker, sd_readonly
  USING (tenant_id IS NULL OR tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Not RLS-protected, by design:
--   user, session, auth_token, recovery_code, agency_membership — identity tables read during
--     authentication before any tenant context exists; access is mediated by the auth module.
--   platform_membership, plan*, permission, platform_setting — platform configuration;
--     runtime tenant roles get read-only or no grants below.
--   outbox_event, notification_delivery — internal plumbing; sd_app may only INSERT outbox rows.

-- ───────────────────────────────── Grants ─────────────────────────────────

GRANT USAGE ON SCHEMA public TO sd_app, sd_worker, sd_platform, sd_readonly;
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_agency_id(), app_user_id(), business_date(text)
  TO sd_app, sd_worker, sd_platform, sd_readonly;

-- Tenant runtime roles: full DML by default, then narrowed.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sd_app, sd_worker;

-- Append-only records (C13, BR-22, BR-28).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, booking_payment, agent_search_log FROM sd_app, sd_worker;

-- Platform-managed configuration is read-only for tenant roles.
REVOKE INSERT, UPDATE, DELETE ON plan, plan_entitlement, plan_price, permission, platform_setting,
  subscription, tenant_entitlement_override FROM sd_app, sd_worker;
REVOKE INSERT, DELETE ON tenant FROM sd_app, sd_worker;
REVOKE ALL ON platform_membership FROM sd_app, sd_worker;

-- Outbox: the API only appends events; the worker processes them.
REVOKE SELECT, UPDATE, DELETE ON outbox_event FROM sd_app;
REVOKE ALL ON notification_delivery FROM sd_app;

-- Reporting role: read-only, RLS applies.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sd_readonly;

-- Platform role (BYPASSRLS) gets platform tables only — never guests, bookings or inventory (C11).
GRANT SELECT, INSERT, UPDATE ON plan, plan_entitlement, plan_price, platform_setting, tenant, subscription,
  tenant_entitlement_override, "user", platform_membership, role, agency, agency_membership,
  auth_token, session, recovery_code TO sd_platform;
GRANT DELETE ON plan_entitlement, plan_price, tenant_entitlement_override, recovery_code TO sd_platform;
GRANT SELECT, INSERT, DELETE ON role_permission TO sd_platform;
GRANT SELECT ON permission, tenant_membership, support_access_grant TO sd_platform;
GRANT INSERT ON audit_log, outbox_event TO sd_platform;
GRANT SELECT ON audit_log TO sd_platform;

-- Future tables created by migrations get the same default for tenant roles; any table with a
-- tenant_id must also get an RLS policy (enforced by the database test suite).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sd_app, sd_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sd_readonly;
