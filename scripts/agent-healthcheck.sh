#!/usr/bin/env bash
# Healthcheck de agentes Paperclip (AGM-55).
#
# Detecta agentes presos em `status=error` SEM `pauseReason` (falha de
# runtime do adapter, não pausa de governance) e abre uma issue crítica
# para o CEO quando o erro persiste por >= THRESHOLD_SECONDS.
#
# Idempotência: cada alerta carrega `HC-Idempotency-Key:` derivado de
# `{agentId}:status-error:{updatedAt-truncado-pra-hora}`. Antes de criar
# uma issue nova, o script faz `GET /api/companies/{id}/issues?q=<key>`
# e pula se já existe uma issue com a mesma chave (mesma janela de 1h).
# Isso evita empilhar issues idênticas enquanto o agente segue em erro.
#
# Uso: `scripts/agent-healthcheck.sh`. Designed para rodar como routine
# (cron `*/5 * * * *`) atribuída ao CEO.
#
# Variáveis de ambiente:
#   PAPERCLIP_API_URL       (obrigatório)
#   PAPERCLIP_API_KEY       (obrigatório)
#   PAPERCLIP_COMPANY_ID    (obrigatório)
#   PAPERCLIP_RUN_ID        (opcional — propagado pro audit trail)
#   THRESHOLD_SECONDS       (opcional, default 300)
#   COMPANY_PREFIX          (opcional, default "AGM" — pra links nas
#                            descrições das issues)
#   CEO_AGENT_ID            (opcional — descoberto via role=ceo se omitido)
#   DRY_RUN                 (opcional — qualquer valor != "" só loga,
#                            não cria issue)
#
# Exit codes:
#   0 — sucesso (mesmo se nenhum agente afetado)
#   2 — falha de configuração (deps, CEO não encontrado, env faltando)
#   3 — falha de API (curl/jq erro)

set -euo pipefail

THRESHOLD_SECONDS="${THRESHOLD_SECONDS:-300}"
COMPANY_PREFIX="${COMPANY_PREFIX:-AGM}"
CEO_AGENT_ID="${CEO_AGENT_ID:-}"
DRY_RUN="${DRY_RUN:-}"

: "${PAPERCLIP_API_URL:?PAPERCLIP_API_URL is required}"
: "${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY is required}"
: "${PAPERCLIP_COMPANY_ID:?PAPERCLIP_COMPANY_ID is required}"

for dep in curl jq date; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "[healthcheck] missing dependency: $dep" >&2
    exit 2
  fi
done

log() { echo "[healthcheck] $*"; }
err() { echo "[healthcheck] $*" >&2; }

api() {
  local method="$1"
  local path="$2"
  shift 2
  local args=(
    -sS
    -X "$method"
    -H "Authorization: Bearer ${PAPERCLIP_API_KEY}"
    -H "Content-Type: application/json"
  )
  if [[ -n "${PAPERCLIP_RUN_ID:-}" ]]; then
    args+=(-H "X-Paperclip-Run-Id: ${PAPERCLIP_RUN_ID}")
  fi
  curl "${args[@]}" "$@" "${PAPERCLIP_API_URL}${path}"
}

urlencode() {
  jq -sRr @uri <<<"$1"
}

now_epoch=$(date -u +%s)

agents_json=$(api GET "/api/companies/${PAPERCLIP_COMPANY_ID}/agents") || {
  err "failed to fetch agents list"
  exit 3
}

if [[ -z "$CEO_AGENT_ID" ]]; then
  CEO_AGENT_ID=$(jq -r 'map(select(.role == "ceo")) | .[0].id // empty' <<<"$agents_json")
fi
if [[ -z "$CEO_AGENT_ID" ]]; then
  err "CEO agent not found in company ${PAPERCLIP_COMPANY_ID}"
  exit 2
fi

# Filtra agentes em status=error com pauseReason vazio cujo updatedAt já
# está há >= THRESHOLD_SECONDS no passado.
broken=$(
  jq -c --argjson now "$now_epoch" --argjson threshold "$THRESHOLD_SECONDS" '
    map(
      select(.status == "error")
      | select((.pauseReason // "") | tostring | length == 0)
      | . + {
          updatedEpoch: (
            .updatedAt
            | sub("\\.[0-9]+Z$"; "Z")
            | fromdate
          )
        }
      | select(($now - .updatedEpoch) >= $threshold)
      | {id, name, urlKey, status, updatedAt, updatedEpoch}
    )
    | .[]
  ' <<<"$agents_json"
)

if [[ -z "$broken" ]]; then
  log "no silent-error agents above threshold (${THRESHOLD_SECONDS}s)"
  exit 0
fi

while IFS= read -r agent; do
  [[ -z "$agent" ]] && continue
  agent_id=$(jq -r '.id' <<<"$agent")
  agent_name=$(jq -r '.name' <<<"$agent")
  url_key=$(jq -r '.urlKey // .id' <<<"$agent")
  updated_at=$(jq -r '.updatedAt' <<<"$agent")
  updated_epoch=$(jq -r '.updatedEpoch' <<<"$agent")
  age_minutes=$(( (now_epoch - updated_epoch) / 60 ))

  # Hour bucket no formato YYYY-MM-DDTHH (UTC). Mesma janela de 1h →
  # mesma key → mesma issue. Após 1h sem recovery, a key muda e o
  # script abre uma nova issue (sinal de que ninguém atuou).
  hour_bucket=$(printf '%s' "$updated_at" | cut -c1-13)
  key="${agent_id}:status-error:${hour_bucket}"
  marker="HC-Idempotency-Key: ${key}"

  # Lookup de issue existente. O endpoint `q=` busca em título,
  # descrição e comentários. Como o marker tem formato único, basta
  # confirmar a presença de uma issue não-terminal com a mesma chave.
  search=$(api GET "/api/companies/${PAPERCLIP_COMPANY_ID}/issues?q=$(urlencode "$key")") || {
    err "search failed for agent ${agent_name}"
    continue
  }

  existing_count=$(
    jq --arg key "$key" '
      def items: if type == "array" then . elif (.items // .results // .data // null) != null then (.items // .results // .data) else [] end;
      [ items[]
        | select((.status // "") | IN("done", "cancelled") | not)
        | select(((.description // "") + " " + (.title // "")) | contains($key))
      ] | length
    ' <<<"$search"
  )

  if [[ "$existing_count" != "0" ]]; then
    log "${agent_name}: ${existing_count} open alert(s) already exist for key=${key}, skipping"
    continue
  fi

  title="[health] ${agent_name} em status=error sem pauseReason (~${age_minutes}min)"
  description=$(cat <<EOF
## Detecção automática

O agente [${agent_name}](/${COMPANY_PREFIX}/agents/${url_key}) está em \`status=error\` SEM \`pauseReason\` populado desde \`${updated_at}\` (~${age_minutes} minutos atrás, threshold = ${THRESHOLD_SECONDS}s).

\`status=error\` sem \`pauseReason\` indica falha de runtime do adapter (crash silencioso), e o supervisor não consegue se auto-curar. O agente permanece preso à checkout que detinha e bloqueia reassign automático.

## Próxima ação (CEO)

Seguir o runbook \`docs/runbooks/agent-error.md\` (no repo do produto). Resumo:

1. Confirmar o estado: \`curl -H "Authorization: Bearer \$PAPERCLIP_API_KEY" \$PAPERCLIP_API_URL/api/agents/${agent_id}\`.
2. Inspecionar o último run e o tail do stderr do adapter local.
3. Reiniciar o processo do agente conforme runbook.
4. Confirmar que voltou a \`idle\`/\`running\` e que checkouts pendentes foram liberados (ou reassign manual).
5. Se reincidir em < 30min, escalar pro board (humano).

## Contexto

- Issue de hardening: [AGM-55](/${COMPANY_PREFIX}/issues/AGM-55)
- Incidente origem: [AGM-52](/${COMPANY_PREFIX}/issues/AGM-52) (restart manual em 2026-05-30)
- Diagnóstico: [AGM-51](/${COMPANY_PREFIX}/issues/AGM-51)

---

> _${marker}_
EOF
)

  payload=$(
    jq -n \
      --arg title "$title" \
      --arg description "$description" \
      --arg assignee "$CEO_AGENT_ID" \
      '{title: $title, description: $description, status: "todo", priority: "critical", assigneeAgentId: $assignee}'
  )

  if [[ -n "$DRY_RUN" ]]; then
    log "DRY_RUN: would create issue for ${agent_name} (key=${key})"
    continue
  fi

  resp=$(api POST "/api/companies/${PAPERCLIP_COMPANY_ID}/issues" -d "$payload") || {
    err "failed to create issue for ${agent_name}"
    continue
  }
  identifier=$(jq -r '.identifier // .id // "?"' <<<"$resp")
  log "${agent_name} → created issue ${identifier} (key=${key})"
done <<<"$broken"

exit 0
