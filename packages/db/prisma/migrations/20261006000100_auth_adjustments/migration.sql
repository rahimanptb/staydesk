-- CSRF tokens are derived from the session (HMAC), so nothing is stored per session.
ALTER TABLE "session" DROP COLUMN "csrf_token_hash";

-- Last accepted TOTP time step, so a code cannot be replayed within its validity window.
ALTER TABLE "user" ADD COLUMN "totp_last_step" INTEGER;

-- Tenant creation and owner recovery are platform operations (docs/02 §5).
GRANT INSERT, UPDATE ON tenant_membership TO sd_platform;
