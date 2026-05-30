DROP INDEX IF EXISTS "user_sessions_expires_at_idx";
DROP INDEX IF EXISTS "user_sessions_user_id_idx";
DROP INDEX IF EXISTS "user_sessions_jti_uq";
ALTER TABLE "user_sessions"
  DROP CONSTRAINT IF EXISTS "user_sessions_user_id_users_id_fk";
DROP TABLE IF EXISTS "user_sessions";
