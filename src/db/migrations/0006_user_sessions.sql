-- AGM-24 commit D — refresh-token / session revocation table.
--
-- Motivação: o gate SE em [AGM-36](/AGM/issues/AGM-36) exige
-- "Token de curta duração (15 min) + refresh token revogável. Lifetime
-- ilimitado não passa. Logout invalida refresh token." NextAuth v5 com
-- estratégia JWT é "stateless" por default — assinatura criptográfica é a
-- única prova de validade. Para suportar revogação verdadeira (logout
-- imediato, suspensão por admin, revalidação per-request), gravamos o
-- `jti` do JWT como linha desta tabela e a checamos a cada request.
--
-- Pattern: `jti` é gerado em `authorize()` (login), gravado aqui com
-- `expires_at = now() + 15min`, propagado no JWT como claim. O middleware
-- per-request chama `revalidateSession(jti)` que confirma:
--   - `revoked_at IS NULL` (não foi revogada)
--   - `expires_at > now()` (não expirou)
-- Logout marca `revoked_at = now()` e `revoked_reason = 'logout'`.
--
-- Sem `clinic_id`: sessão é per-user, não per-tenant. Lookup roda como
-- `agenda_owner` (a role de sessão), igual aos lookups de `users`. RLS
-- explicitamente desligada nesta tabela — caller é sempre auth code que
-- já filtra por `(user_id, jti)`.
--
-- Encarregado de PII: `ip` e `user_agent_hash` são metadados de auditoria,
-- não PHI/PII de saúde. `ip` é necessário pra forense de session hijack;
-- `user_agent_hash` (SHA-256 do UA) substitui o UA cru pra reduzir
-- superfície de PII enquanto mantém a capacidade de comparar "mesmo
-- browser" sem armazenar o cabeçalho identificador completo.

CREATE TABLE "user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "jti" text NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  "last_seen_at" timestamp with time zone,
  "ip" text,
  "user_agent_hash" text,
  CONSTRAINT "user_sessions_revoked_reason_chk"
    CHECK (revoked_reason IS NULL
           OR revoked_reason IN ('logout', 'admin_revoke', 'rotation', 'expired_cleanup'))
);
--> statement-breakpoint

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "user_sessions_jti_uq" ON "user_sessions" USING btree ("jti");
--> statement-breakpoint

-- Listar sessões ativas de um usuário (admin panel futuro, "kill all sessions").
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");
--> statement-breakpoint

-- Sweep de sessões expiradas (job de limpeza futuro). Parcial: só varre
-- não-revogadas, pra não competir com queries de revalidação.
CREATE INDEX "user_sessions_expires_at_idx"
  ON "user_sessions" USING btree ("expires_at")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint

-- Grants explícitas pra agenda_app (a role NOBYPASSRLS do app). RLS não
-- está habilitada nesta tabela — auth code sempre roda com a role de
-- sessão (owner/superuser) via `dbUnscopedDangerous`, igual ao lookup de
-- `users`. ALTER DEFAULT PRIVILEGES já cobre, mas ser explícito ajuda
-- read-time review.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "agenda_app";
