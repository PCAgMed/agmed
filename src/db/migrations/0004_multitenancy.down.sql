DROP INDEX IF EXISTS "consents_clinic_idx";
DROP INDEX IF EXISTS "audit_log_clinic_idx";
ALTER TABLE "consents" DROP CONSTRAINT IF EXISTS "consents_clinic_id_clinics_id_fk";
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_clinic_id_clinics_id_fk";
ALTER TABLE "consents" DROP COLUMN IF EXISTS "clinic_id";
ALTER TABLE "audit_log" DROP COLUMN IF EXISTS "clinic_id";
DROP TABLE IF EXISTS "clinic_memberships";
DROP TABLE IF EXISTS "clinics";
