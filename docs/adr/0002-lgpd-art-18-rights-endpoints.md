# ADR-0002 — Endpoints e UI de direitos do titular (LGPD Art. 18)

- **Status:** Aceito
- **Data:** 2026-05-30
- **Issue:** [AGM-32](/AGM/issues/AGM-32)
- **Baseline:** [lgpd-baseline §3](/AGM/issues/AGM-29#document-lgpd-baseline)

## Contexto

A Lei Geral de Proteção de Dados (Art. 18) garante aos titulares de dados
nove direitos exercíveis a qualquer tempo. O baseline organizacional foi
publicado em [AGM-29](/AGM/issues/AGM-29) com SLA, canal e bases legais.
Esta ADR documenta o desenho técnico da implementação inicial.

## Decisão

### 1. Corte de escopo: profissional primeiro

O schema atual só contém `users` (profissional) — não há tabela `patients`
nem modelo de tenant. Multi-tenancy é prerequisito ([AGM-24](/AGM/issues/AGM-24))
e ainda está `todo`. Portanto:

- **Implementamos** os endpoints `/api/me/*` para profissional (titular = usuário SaaS).
- **Adiamos** os endpoints `/api/tenants/{tenantId}/patients/{patientId}/*`
  para uma child issue bloqueada por AGM-24.

### 2. Endpoints implementados

| Direito (Art. 18) | Método + Rota | Resultado |
|---|---|---|
| I + II — Confirmação/acesso | `GET /api/me/data` | JSON com schema versionado |
| III — Correção | `PATCH /api/me/profile` | Allowlist de campos editáveis (`name`, `image`) |
| V — Portabilidade | `POST /api/me/data/export` | Download JSON com `Content-Disposition` + `X-LGPD-Protocol` |
| VI — Eliminação | `POST /api/me/data/delete` | Revoga consentimentos + agenda hard-delete em 30 dias |
| VII — Compartilhamento | `GET /api/me/data/subprocessors` | Lista estática (mesma fonte de `/legal/subprocessadores`) |
| IX — Revogação de consentimento | `POST /api/me/consents/[kind]/revoke` | Idempotente |

Todo response inclui um **protocolo** (`LGPD-YYYYMMDD-XXXXXXXX`) que o
titular pode citar em qualquer recurso ou follow-up.

### 3. Schema versionado para portabilidade

O JSON do export é estabilizado por `schema: 'clinica-agenda.lgpd.export.v1'`.
Mudanças incompatíveis sobem para `v2`; mudanças compatíveis (campos novos
opcionais) ficam em `v1`. O contrato é com o titular (não com a clínica),
por isso ele vive em código e não em banco.

### 4. Auditoria

- Nova tabela `audit_log` (append-only): `actor_*`, `subject_*`, `action`,
  `outcome`, `reason`, `protocol`, `ip`, `user_agent`, `request_id`, `metadata`.
- Retenção: **10 anos** (lgpd-baseline §2).
- Falha de auditoria nunca derruba o pedido do titular — vira log estruturado
  e dispara alerta via Loki. O pedido segue, a falha vira incidente operacional.
- Helper centralizado em `src/lib/lgpd/audit.ts` para ser reutilizado pelos
  endpoints de paciente quando AGM-24 destravar.

### 5. Consentimento granular

- Nova tabela `consents`: `(subject_type, subject_id, kind)` único.
  `granted_at`/`revoked_at` para histórico, `policy_version` para rastreio
  de qual texto foi consentido.
- Catálogo inicial: `marketing_email`, `analytics` (`src/lib/lgpd/consents.ts`).
- Helpers `grantConsent`/`revokeConsent`/`listConsents` — usados tanto pelo
  endpoint de revogação quanto pelo futuro UX de opt-in (AGM-35).

### 6. Rate limit

- Buckets dedicados em `src/lib/lgpd/rate-limit.ts`:
  - `read` — 30/min por user + por IP
  - `mutate` — 10/min
  - `heavy` (export, delete) — 3/hora
- Mitiga risco **R4** do RIPD (exfiltração via portabilidade abusiva).
- Reaproveita store/logger da AGM-27.

### 7. Eliminação fundamentada

A rota `POST /api/me/data/delete`:

1. Exige `{"scope":"all","confirm":"ELIMINAR"}` no body (defesa em
   profundidade — a UI também pede confirmação dupla).
2. Revoga todos os consentimentos ativos imediatamente.
3. Marca `users.deletion_requested_at = now()`.
4. Responde com `accountHardDeleteAt = now + 30d` (janela de reversão da
   baseline §2). O hard-delete em si é executado pelo job da AGM-33.
5. Inclui no recibo a categoria `audit_log` como **retida sob obrigação
   legal** — operator-side accountability, não dado pessoal do titular.

Quando AGM-33 introduzir `retention_class`, a lógica de recusa fundamentada
passa a ser calculada por classe (ex.: prontuário 20 anos).

### 8. UI

- Página `/privacidade` (server component) + `PrivacyPanel` (client) com
  cards por direito.
- Botões de eliminação e export usam **dupla confirmação** (alerta + prompt
  com palavra `ELIMINAR`).
- Recibo na tela contém protocolo + detalhe + JSON cru, para o titular
  copiar/comparar.
- A UX final é refinada pelo time de design ([AGM-35](/AGM/issues/AGM-35));
  esta página é o baseline funcional.

### 9. Hardening de middleware (side effect)

O `authorized()` do Auth.js v5 (beta) não auto-bloqueava o handler interno
quando retornava `false`, então `/dashboard`, `/privacidade` etc. eram
servidas sem sessão (UX degradada, sem vazamento porque os dados só vêm
das APIs autenticadas). Corrigido em `src/middleware.ts` — agora redireciona
para `/login?callbackUrl=...` quando `req.auth` é nulo e a rota não é
pública nem `/api/*`. APIs continuam recebendo 401 JSON via `auth.config`.

## Alternativas consideradas

- **Construir tabela `patients` agora para entregar tudo de uma vez.**
  Rejeitada: violaria a ordem definida pelo SecurityEngineer no
  audit-baseline (multi-tenancy ANTES de qualquer tabela de domínio com PII).
- **Aceitar `scope: 'consents_only'` por default.** Rejeitada: o direito é
  "eliminação dos dados" — o default deve ser o pedido amplo, com o usuário
  optando explicitamente por escopo mais restrito.
- **Persistir subprocessadores em banco.** Rejeitada para v1: lista pública,
  curta, raramente muda; PR + notificação prévia de 30 dias é o controle.

## Consequências

- Próxima entrega pode focar em paciente sem rework no contrato — os
  endpoints `/api/tenants/.../patients/...` reusam `audit.ts`, `consents.ts`,
  `protocol.ts` e `rate-limit.ts` sem mudança.
- O job de hard-delete (AGM-33) precisa apenas processar
  `users WHERE deletion_requested_at < now() - interval '30 days'`.
- Auditoria fica disponível para queries operacionais
  (`SELECT * FROM audit_log WHERE protocol = ?`) sem retrofit.
