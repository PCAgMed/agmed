-- AGM-24 commit B — Row-Level Security + role separation.
--
-- A defesa em profundidade do plan tem dois eixos:
--   (1) policy `tenant_isolation` em cada tabela com `clinic_id`;
--   (2) uma role de runtime SEM `BYPASSRLS` para que a policy DE FATO se
--       aplique (o owner/superuser bypassa RLS por default).
--
-- O eixo (2) é o que importa: em dev local e em CI a role de conexão é a
-- mesma que rodou as migrations (e portanto é dona das tabelas + superuser
-- na maioria dos setups). Sem separar a role de runtime, ENABLE/FORCE RLS
-- sozinhos NÃO bloqueiam nada. Por isso esta migration:
--   - cria a role `agenda_app` NOINHERIT NOLOGIN NOBYPASSRLS;
--   - dá GRANTs explícitas em cada tabela existente;
--   - define DEFAULT PRIVILEGES para o owner atual, para que migrations
--     futuras (patients, appointments…) auto-grant para `agenda_app` sem
--     precisar de ALTER em cada uma;
--   - habilita ENABLE + FORCE RLS e a policy `tenant_isolation`.
--
-- No app, o helper `withClinicScope` faz `SET LOCAL ROLE agenda_app` na
-- transação, o que faz a policy efetivamente bloquear leitura/escrita
-- cross-tenant. Helpers cross-clinic legítimos (`dbUnscopedDangerous`,
-- `withRowSecurityOff`) ficam como a role de sessão (superuser/owner) e
-- bypassam RLS — uso auditável por grep.

-- Role de runtime ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agenda_app') THEN
    CREATE ROLE "agenda_app" NOINHERIT NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "agenda_app";
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "users", "clinics", "clinic_memberships", "audit_log", "consents",
  "retention_run", "_db_ready"
  TO "agenda_app";
--> statement-breakpoint

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "agenda_app";
--> statement-breakpoint

-- Tabelas/sequences futuras criadas pelo owner atual auto-grant para agenda_app.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "agenda_app";
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT USAGE, SELECT ON SEQUENCES TO "agenda_app";
--> statement-breakpoint

-- Policies + ENABLE/FORCE RLS ------------------------------------------------
-- `current_setting('app.clinic_id', true)` retorna NULL se não setado.
-- NULLIF(..., '') trata o caso de a aplicação setar string vazia (defensivo).
-- NULL::uuid = NULL é sempre FALSE → fora de `withClinicScope`, tabela
-- invisível para `agenda_app`.

ALTER TABLE "clinics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinics" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "clinics"
  USING ("id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "clinic_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "clinic_memberships"
  USING ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_log"
  USING ("clinic_id" IS NULL OR "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" IS NULL OR "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "consents"
  USING ("clinic_id" IS NULL OR "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinic_id" IS NULL OR "clinic_id" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
