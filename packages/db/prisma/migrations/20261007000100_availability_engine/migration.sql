-- M3: availability engine — reconciliation records and the worker's property directory.

-- CreateEnum
CREATE TYPE "reconciliation_trigger" AS ENUM ('SCHEDULED', 'MANUAL', 'REPAIR');

-- CreateTable
CREATE TABLE "inventory_reconciliation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "trigger" "reconciliation_trigger" NOT NULL,
    "mismatch_count" INTEGER NOT NULL,
    "mismatches" JSONB NOT NULL DEFAULT '[]',
    "actor" TEXT,
    "reason" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_reconciliation_property_id_started_at_idx" ON "inventory_reconciliation"("property_id", "started_at");

-- AddForeignKey
ALTER TABLE "inventory_reconciliation" ADD CONSTRAINT "inventory_reconciliation_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE inventory_reconciliation
  ADD CONSTRAINT inventory_reconciliation_count CHECK (mismatch_count >= 0),
  ADD CONSTRAINT inventory_reconciliation_period CHECK (finished_at >= started_at);

-- Tenant isolation, like every tenant-owned table.
ALTER TABLE inventory_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_reconciliation TO sd_app, sd_worker, sd_readonly
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

-- The proof trail is append-only (default privileges granted full DML).
REVOKE UPDATE, DELETE, TRUNCATE ON inventory_reconciliation FROM sd_app, sd_worker;

-- The worker runs per-property jobs (horizon roll, reconciliation) inside each tenant's RLS
-- context, so it first needs to know which properties exist. This definer function is its only
-- cross-tenant read: identifiers and scheduling fields, nothing else.
CREATE FUNCTION worker_inventory_targets()
RETURNS TABLE (tenant_id uuid, property_id uuid, timezone text, booking_horizon_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.tenant_id, p.id, p.timezone, p.booking_horizon_days
  FROM property p
  JOIN tenant t ON t.id = p.tenant_id
  WHERE p.archived_at IS NULL AND t.status <> 'DEACTIVATED'
  ORDER BY p.tenant_id, p.id
$$;
REVOKE ALL ON FUNCTION worker_inventory_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_inventory_targets() TO sd_worker;

-- A partial release of a running block ends the original row and continues as a new one.
ALTER TABLE "room_block" ADD COLUMN "split_from_id" UUID;
ALTER TABLE "room_block" ADD CONSTRAINT "room_block_tenant_id_split_from_id_fkey" FOREIGN KEY ("tenant_id", "split_from_id") REFERENCES "room_block"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
