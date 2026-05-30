DROP POLICY IF EXISTS "tenant_isolation" ON "consents";
ALTER TABLE "consents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "consents" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "audit_log";
ALTER TABLE "audit_log" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "clinic_memberships";
ALTER TABLE "clinic_memberships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "clinic_memberships" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "clinics";
ALTER TABLE "clinics" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "clinics" DISABLE ROW LEVEL SECURITY;

ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  REVOKE USAGE, SELECT ON SEQUENCES FROM "agenda_app";
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "agenda_app";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "agenda_app";
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  "users", "clinics", "clinic_memberships", "audit_log", "consents",
  "retention_run", "_db_ready"
  FROM "agenda_app";
REVOKE USAGE ON SCHEMA "public" FROM "agenda_app";

DROP ROLE IF EXISTS "agenda_app";
