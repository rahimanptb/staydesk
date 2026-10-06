#!/bin/bash
# Creates the StayDesk database and its roles (docs/04-database-architecture.md §5).
# Runs once, on first start of an empty data directory. The same script initialises a VPS.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$SD_OWNER_PASSWORD" \
  -v app_pw="$SD_APP_PASSWORD" \
  -v worker_pw="$SD_WORKER_PASSWORD" \
  -v platform_pw="$SD_PLATFORM_PASSWORD" \
  -v readonly_pw="$SD_READONLY_PASSWORD" \
  -v db="$STAYDESK_DB" <<'EOSQL'
-- Migration/schema owner. Never used by running applications.
CREATE ROLE sd_owner LOGIN PASSWORD :'owner_pw';
-- Runtime roles. Row-level security applies to all except sd_platform, which instead has
-- no grants on operational tables.
CREATE ROLE sd_app LOGIN PASSWORD :'app_pw';
CREATE ROLE sd_worker LOGIN PASSWORD :'worker_pw';
CREATE ROLE sd_platform LOGIN BYPASSRLS PASSWORD :'platform_pw';
CREATE ROLE sd_readonly LOGIN PASSWORD :'readonly_pw';

CREATE DATABASE :"db" OWNER sd_owner;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$STAYDESK_DB" \
  -v db="$STAYDESK_DB" <<'EOSQL'
ALTER SCHEMA public OWNER TO sd_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO sd_app, sd_worker, sd_platform, sd_readonly;
EOSQL
