-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "billing_interval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "role_context" AS ENUM ('PLATFORM', 'TENANT', 'AGENCY');

-- CreateEnum
CREATE TYPE "auth_token_purpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'INVITATION', 'AGENCY_INVITATION');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "support_access_scope" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('HOTEL', 'RESORT', 'VILLA', 'HOMESTAY', 'HOSTEL', 'OTHER');

-- CreateEnum
CREATE TYPE "property_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "agent_visibility" AS ENUM ('STATUS_ONLY', 'CAPPED_COUNT', 'EXACT_COUNT', 'FULL_BREAKDOWN');

-- CreateEnum
CREATE TYPE "file_scan_status" AS ENUM ('PENDING', 'CLEAN', 'INFECTED');

-- CreateEnum
CREATE TYPE "room_type_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "room_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "housekeeping_status" AS ENUM ('CLEAN', 'DIRTY', 'INSPECTED');

-- CreateEnum
CREATE TYPE "block_kind" AS ENUM ('BLOCK', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "block_reason" AS ENUM ('MAINTENANCE', 'RENOVATION', 'OWNER_USE', 'GROUP_RESERVATION', 'VIP_RESERVATION', 'TEMPORARY_CLOSURE', 'INTERNAL_ALLOCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "block_status" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "stop_sell_scope" AS ENUM ('ALL_CHANNELS', 'AGENTS_ONLY');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('INQUIRY', 'TENTATIVE', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "booking_source" AS ENUM ('DIRECT', 'TRAVEL_AGENT', 'OTA', 'CORPORATE', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "booking_room_status" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "inventory_bucket" AS ENUM ('NONE', 'HELD', 'BOOKED');

-- CreateEnum
CREATE TYPE "payment_entry_type" AS ENUM ('PAYMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('OPEN', 'NOTIFIED', 'CONVERTED', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "agency_status" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "agency_access_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "pending_party" AS ENUM ('AGENCY', 'HOTEL');

-- CreateEnum
CREATE TYPE "booking_request_status" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'SYSTEM', 'PLATFORM_ADMIN', 'AGENT', 'API_KEY');

-- CreateEnum
CREATE TYPE "export_format" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlement" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "int_value" INTEGER,
    "bool_value" BOOLEAN,

    CONSTRAINT "plan_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_price" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interval" "billing_interval" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'PENDING',
    "legal_name" TEXT,
    "country" CHAR(2) NOT NULL,
    "billing_email" CITEXT,
    "overbooking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "require_staff_2fa" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "current_subscription_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "suspension_reason" TEXT,
    "deactivated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at" TIMESTAMPTZ(6),
    "external_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlement_override" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "int_value" INTEGER,
    "bool_value" BOOLEAN,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_entitlement_override_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "platform_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'INVITED',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "totp_secret_enc" BYTEA,
    "totp_enabled_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "context" "role_context" NOT NULL,
    "tenant_id" UUID,
    "agency_id" UUID,
    "support_grant_id" UUID,
    "csrf_token_hash" BYTEA NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(6),
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_token" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" CITEXT NOT NULL,
    "purpose" "auth_token_purpose" NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "context" "role_context" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "context" "role_context" NOT NULL,
    "tenant_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_editable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "tenant_membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "status" "membership_status" NOT NULL DEFAULT 'INVITED',
    "all_properties" BOOLEAN NOT NULL DEFAULT true,
    "invited_by_id" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_property" (
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,

    CONSTRAINT "membership_property_pkey" PRIMARY KEY ("membership_id","property_id")
);

-- CreateTable
CREATE TABLE "platform_membership" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_membership" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'INVITED',
    "invited_by_id" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "support_access_grant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "platform_user_id" UUID,
    "scope" "support_access_scope" NOT NULL DEFAULT 'READ_ONLY',
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "property_type" NOT NULL DEFAULT 'HOTEL',
    "status" "property_status" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "country" CHAR(2) NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "phone" TEXT,
    "email" CITEXT,
    "check_in_time" TEXT NOT NULL DEFAULT '14:00',
    "check_out_time" TEXT NOT NULL DEFAULT '11:00',
    "child_max_age" SMALLINT NOT NULL DEFAULT 12,
    "tentative_hold_hours" INTEGER NOT NULL DEFAULT 48,
    "low_availability_threshold" INTEGER NOT NULL DEFAULT 2,
    "booking_horizon_days" INTEGER NOT NULL DEFAULT 730,
    "max_stay_nights" INTEGER NOT NULL DEFAULT 90,
    "booking_ref_prefix" TEXT NOT NULL,
    "agent_default_visibility" "agent_visibility" NOT NULL DEFAULT 'FULL_BREAKDOWN',
    "agent_count_cap" INTEGER NOT NULL DEFAULT 5,
    "agent_request_expiry_hours" INTEGER NOT NULL DEFAULT 24,
    "is_discoverable" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_object" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "purpose" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "scan_status" "file_scan_status" NOT NULL DEFAULT 'PENDING',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_image" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,

    CONSTRAINT "property_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "max_adults" INTEGER NOT NULL,
    "max_children" INTEGER NOT NULL,
    "max_occupancy" INTEGER NOT NULL,
    "track_rooms" BOOLEAN NOT NULL DEFAULT false,
    "total_inventory" INTEGER NOT NULL DEFAULT 0,
    "base_rate_minor" BIGINT,
    "status" "room_type_status" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "internal_notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "room_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_amenity" (
    "tenant_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,

    CONSTRAINT "room_type_amenity_pkey" PRIMARY KEY ("room_type_id","amenity_id")
);

-- CreateTable
CREATE TABLE "room_type_image" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,

    CONSTRAINT "room_type_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT,
    "building" TEXT,
    "status" "room_status" NOT NULL DEFAULT 'ACTIVE',
    "housekeeping" "housekeeping_status" NOT NULL DEFAULT 'CLEAN',
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_day" (
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "out_of_service" INTEGER NOT NULL DEFAULT 0,
    "overbook_allowance" INTEGER NOT NULL DEFAULT 0,
    "closed_all" BOOLEAN NOT NULL DEFAULT false,
    "closed_agents" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_day_pkey" PRIMARY KEY ("room_type_id","date")
);

-- CreateTable
CREATE TABLE "room_block" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "room_id" UUID,
    "kind" "block_kind" NOT NULL,
    "reason" "block_reason" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "original_end_date" DATE NOT NULL,
    "original_quantity" INTEGER NOT NULL,
    "status" "block_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "override_used" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "release_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "room_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stop_sell" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "scope" "stop_sell_scope" NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "lifted_at" TIMESTAMPTZ(6),
    "lifted_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stop_sell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "booking_room_id" UUID,
    "room_block_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "country" CHAR(2),
    "notes" TEXT,
    "anonymized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_sequence" (
    "property_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "booking_sequence_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "booking_status" NOT NULL,
    "source" "booking_source" NOT NULL,
    "source_detail" TEXT,
    "agency_access_id" UUID,
    "agency_id" UUID,
    "guest_id" UUID NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "special_requests" TEXT,
    "internal_notes" TEXT,
    "currency" CHAR(3) NOT NULL,
    "total_amount_minor" BIGINT,
    "paid_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "hold_expires_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "checked_in_at" TIMESTAMPTZ(6),
    "checked_out_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancellation_reason" TEXT,
    "no_show_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_room" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "room_type_name_snapshot" TEXT NOT NULL,
    "room_type_code_snapshot" TEXT NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "occupant_name" TEXT,
    "status" "booking_room_status" NOT NULL DEFAULT 'ACTIVE',
    "assigned_room_id" UUID,
    "inv_from" DATE NOT NULL,
    "inv_to" DATE NOT NULL,
    "inventory_bucket" "inventory_bucket" NOT NULL DEFAULT 'NONE',
    "amount_minor" BIGINT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "payment_entry_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "guest_id" UUID,
    "contact_name" TEXT NOT NULL,
    "contact_email" CITEXT,
    "contact_phone" TEXT,
    "source" "booking_source" NOT NULL,
    "agency_id" UUID,
    "status" "waitlist_status" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "notified_at" TIMESTAMPTZ(6),
    "booking_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "registration_number" TEXT,
    "tax_id" TEXT,
    "country" CHAR(2) NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" CITEXT NOT NULL,
    "website" TEXT,
    "status" "agency_status" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verified_at" TIMESTAMPTZ(6),
    "verified_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_access" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "status" "agency_access_status" NOT NULL DEFAULT 'PENDING',
    "pending_on" "pending_party",
    "valid_from" DATE,
    "valid_to" DATE,
    "visibility" "agent_visibility",
    "count_cap" INTEGER,
    "can_request_booking" BOOLEAN NOT NULL DEFAULT false,
    "hotel_reference" TEXT,
    "contact_name" TEXT,
    "contact_email" CITEXT,
    "contact_phone" TEXT,
    "notes" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by_id" UUID,
    "suspended_at" TIMESTAMPTZ(6),
    "suspension_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_access_property" (
    "tenant_id" UUID NOT NULL,
    "agency_access_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "all_room_types" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "agency_access_property_pkey" PRIMARY KEY ("agency_access_id","property_id")
);

-- CreateTable
CREATE TABLE "agency_access_room_type" (
    "tenant_id" UUID NOT NULL,
    "agency_access_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,

    CONSTRAINT "agency_access_room_type_pkey" PRIMARY KEY ("agency_access_id","room_type_id")
);

-- CreateTable
CREATE TABLE "agent_search_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "room_type_id" UUID,
    "result_summary" JSONB NOT NULL,
    "ip" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_search_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "agency_access_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "room_type_id" UUID NOT NULL,
    "rooms" INTEGER NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_email" CITEXT,
    "guest_phone" TEXT,
    "agent_notes" TEXT,
    "hotel_message" TEXT,
    "status" "booking_request_status" NOT NULL DEFAULT 'PENDING',
    "responded_by_id" UUID,
    "responded_at" TIMESTAMPTZ(6),
    "booking_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "agency_id" UUID,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL,
    "notification_id" UUID,
    "outbox_event_id" UUID,
    "user_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "user_id" UUID NOT NULL,
    "context_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_id","context_id","event_type","channel")
);

-- CreateTable
CREATE TABLE "notification_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "event_type" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" UUID,
    "property_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_agency_id" UUID,
    "support_grant_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "booking_id" UUID,
    "room_type_id" UUID,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id","created_at")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "report_key" TEXT NOT NULL,
    "format" "export_format" NOT NULL,
    "params" JSONB NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'QUEUED',
    "file_id" UUID,
    "row_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlement_plan_id_key_key" ON "plan_entitlement"("plan_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_price_plan_id_currency_interval_key" ON "plan_price"("plan_id", "currency", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_current_subscription_id_key" ON "tenant"("current_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_id_current_subscription_id_key" ON "tenant"("id", "current_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_tenant_id_id_key" ON "subscription"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "recovery_code_user_id_idx" ON "recovery_code"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_absolute_expires_at_idx" ON "session"("absolute_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_token_token_hash_key" ON "auth_token"("token_hash");

-- CreateIndex
CREATE INDEX "auth_token_email_purpose_idx" ON "auth_token"("email", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_key_key" ON "role"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_id_key" ON "role"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_membership_tenant_id_user_id_key" ON "tenant_membership"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_membership_tenant_id_id_key" ON "tenant_membership"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_membership_user_id_key" ON "platform_membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_membership_agency_id_user_id_key" ON "agency_membership"("agency_id", "user_id");

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE INDEX "support_access_grant_tenant_id_idx" ON "support_access_grant"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_tenant_id_id_key" ON "property"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "property_tenant_id_code_key" ON "property"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "holiday_tenant_id_date_idx" ON "holiday"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "amenity_tenant_id_name_key" ON "amenity"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "amenity_tenant_id_id_key" ON "amenity"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "file_object_storage_key_key" ON "file_object"("storage_key");

-- CreateIndex
CREATE INDEX "property_image_property_id_idx" ON "property_image"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_tenant_id_id_key" ON "room_type"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_property_id_id_key" ON "room_type"("property_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_property_id_code_key" ON "room_type"("property_id", "code");

-- CreateIndex
CREATE INDEX "room_type_image_room_type_id_idx" ON "room_type_image"("room_type_id");

-- CreateIndex
CREATE INDEX "room_room_type_id_idx" ON "room"("room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_property_id_number_key" ON "room"("property_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "room_tenant_id_id_key" ON "room"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "room_property_id_id_key" ON "room"("property_id", "id");

-- CreateIndex
CREATE INDEX "inventory_day_property_id_date_idx" ON "inventory_day"("property_id", "date");

-- CreateIndex
CREATE INDEX "room_block_property_id_start_date_idx" ON "room_block"("property_id", "start_date");

-- CreateIndex
CREATE INDEX "room_block_room_type_id_start_date_end_date_idx" ON "room_block"("room_type_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "room_block_tenant_id_id_key" ON "room_block"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stop_sell_property_id_start_date_idx" ON "stop_sell"("property_id", "start_date");

-- CreateIndex
CREATE INDEX "room_allocation_room_id_start_date_idx" ON "room_allocation"("room_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "room_allocation_tenant_id_booking_room_id_key" ON "room_allocation"("tenant_id", "booking_room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_allocation_tenant_id_room_block_id_key" ON "room_allocation"("tenant_id", "room_block_id");

-- CreateIndex
CREATE INDEX "guest_tenant_id_email_idx" ON "guest"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "guest_tenant_id_phone_idx" ON "guest"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "guest_tenant_id_id_key" ON "guest"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_sequence_tenant_id_property_id_key" ON "booking_sequence"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "booking_property_id_check_in_idx" ON "booking"("property_id", "check_in");

-- CreateIndex
CREATE INDEX "booking_property_id_check_out_idx" ON "booking"("property_id", "check_out");

-- CreateIndex
CREATE INDEX "booking_property_id_status_idx" ON "booking"("property_id", "status");

-- CreateIndex
CREATE INDEX "booking_tenant_id_guest_id_idx" ON "booking"("tenant_id", "guest_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenant_id_reference_key" ON "booking"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenant_id_id_key" ON "booking"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_property_id_id_key" ON "booking"("property_id", "id");

-- CreateIndex
CREATE INDEX "booking_room_booking_id_idx" ON "booking_room"("booking_id");

-- CreateIndex
CREATE INDEX "booking_room_room_type_id_inv_from_inv_to_idx" ON "booking_room"("room_type_id", "inv_from", "inv_to");

-- CreateIndex
CREATE UNIQUE INDEX "booking_room_tenant_id_id_key" ON "booking_room"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "booking_payment_booking_id_idx" ON "booking_payment"("booking_id");

-- CreateIndex
CREATE INDEX "waitlist_entry_property_id_status_check_in_idx" ON "waitlist_entry"("property_id", "status", "check_in");

-- CreateIndex
CREATE UNIQUE INDEX "agency_access_tenant_id_agency_id_key" ON "agency_access"("tenant_id", "agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_access_tenant_id_id_key" ON "agency_access"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_access_property_tenant_id_agency_access_id_property__key" ON "agency_access_property"("tenant_id", "agency_access_id", "property_id");

-- CreateIndex
CREATE INDEX "agent_search_log_tenant_id_created_at_idx" ON "agent_search_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_search_log_agency_id_created_at_idx" ON "agent_search_log"("agency_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_request_property_id_status_idx" ON "booking_request"("property_id", "status");

-- CreateIndex
CREATE INDEX "booking_request_agency_id_created_at_idx" ON "booking_request"("agency_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_request_tenant_id_reference_key" ON "booking_request"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "booking_request_tenant_id_booking_id_key" ON "booking_request"("tenant_id", "booking_id");

-- CreateIndex
CREATE INDEX "outbox_event_status_available_at_idx" ON "outbox_event"("status", "available_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_delivery_status_created_at_idx" ON "notification_delivery"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_template_event_type_channel_locale_idx" ON "notification_template"("event_type", "channel", "locale");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_idx" ON "audit_log"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "export_job_tenant_id_created_at_idx" ON "export_job"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "plan_entitlement" ADD CONSTRAINT "plan_entitlement_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_id_current_subscription_id_fkey" FOREIGN KEY ("id", "current_subscription_id") REFERENCES "subscription"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_entitlement_override" ADD CONSTRAINT "tenant_entitlement_override_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_property" ADD CONSTRAINT "membership_property_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_property" ADD CONSTRAINT "membership_property_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_membership" ADD CONSTRAINT "platform_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_membership" ADD CONSTRAINT "platform_membership_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_membership" ADD CONSTRAINT "agency_membership_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_membership" ADD CONSTRAINT "agency_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_membership" ADD CONSTRAINT "agency_membership_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amenity" ADD CONSTRAINT "amenity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_image" ADD CONSTRAINT "property_image_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_image" ADD CONSTRAINT "property_image_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type" ADD CONSTRAINT "room_type_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_amenity" ADD CONSTRAINT "room_type_amenity_tenant_id_room_type_id_fkey" FOREIGN KEY ("tenant_id", "room_type_id") REFERENCES "room_type"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_amenity" ADD CONSTRAINT "room_type_amenity_tenant_id_amenity_id_fkey" FOREIGN KEY ("tenant_id", "amenity_id") REFERENCES "amenity"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_image" ADD CONSTRAINT "room_type_image_tenant_id_room_type_id_fkey" FOREIGN KEY ("tenant_id", "room_type_id") REFERENCES "room_type"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_image" ADD CONSTRAINT "room_type_image_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_day" ADD CONSTRAINT "inventory_day_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_day" ADD CONSTRAINT "inventory_day_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_block" ADD CONSTRAINT "room_block_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_block" ADD CONSTRAINT "room_block_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_block" ADD CONSTRAINT "room_block_property_id_room_id_fkey" FOREIGN KEY ("property_id", "room_id") REFERENCES "room"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_sell" ADD CONSTRAINT "stop_sell_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_sell" ADD CONSTRAINT "stop_sell_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_allocation" ADD CONSTRAINT "room_allocation_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_allocation" ADD CONSTRAINT "room_allocation_property_id_room_id_fkey" FOREIGN KEY ("property_id", "room_id") REFERENCES "room"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_allocation" ADD CONSTRAINT "room_allocation_tenant_id_booking_room_id_fkey" FOREIGN KEY ("tenant_id", "booking_room_id") REFERENCES "booking_room"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_allocation" ADD CONSTRAINT "room_allocation_tenant_id_room_block_id_fkey" FOREIGN KEY ("tenant_id", "room_block_id") REFERENCES "room_block"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest" ADD CONSTRAINT "guest_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_sequence" ADD CONSTRAINT "booking_sequence_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenant_id_guest_id_fkey" FOREIGN KEY ("tenant_id", "guest_id") REFERENCES "guest"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenant_id_agency_access_id_fkey" FOREIGN KEY ("tenant_id", "agency_access_id") REFERENCES "agency_access"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_room" ADD CONSTRAINT "booking_room_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_room" ADD CONSTRAINT "booking_room_property_id_booking_id_fkey" FOREIGN KEY ("property_id", "booking_id") REFERENCES "booking"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_room" ADD CONSTRAINT "booking_room_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_room" ADD CONSTRAINT "booking_room_property_id_assigned_room_id_fkey" FOREIGN KEY ("property_id", "assigned_room_id") REFERENCES "room"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payment" ADD CONSTRAINT "booking_payment_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "booking"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_tenant_id_guest_id_fkey" FOREIGN KEY ("tenant_id", "guest_id") REFERENCES "guest"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "booking"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_access" ADD CONSTRAINT "agency_access_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_access" ADD CONSTRAINT "agency_access_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_access_property" ADD CONSTRAINT "agency_access_property_tenant_id_agency_access_id_fkey" FOREIGN KEY ("tenant_id", "agency_access_id") REFERENCES "agency_access"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_access_property" ADD CONSTRAINT "agency_access_property_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_access_room_type" ADD CONSTRAINT "agency_access_room_type_tenant_id_agency_access_id_propert_fkey" FOREIGN KEY ("tenant_id", "agency_access_id", "property_id") REFERENCES "agency_access_property"("tenant_id", "agency_access_id", "property_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_access_room_type" ADD CONSTRAINT "agency_access_room_type_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "property"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_tenant_id_agency_access_id_fkey" FOREIGN KEY ("tenant_id", "agency_access_id") REFERENCES "agency_access"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_property_id_room_type_id_fkey" FOREIGN KEY ("property_id", "room_type_id") REFERENCES "room_type"("property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "booking"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;

