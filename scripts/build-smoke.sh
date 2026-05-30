#!/usr/bin/env bash
# Smoke de boot do app (AGM-42).
#
# Sobe `next start` em uma porta efêmera, espera o `Ready` e bate algumas
# rotas que NÃO precisam de banco (`/login`, `/legal/*` com flag on).
# O objetivo é pegar regressões de bundling (pino/edge), de
# instrumentation e de middleware antes que cheguem no main — caso que
# o test runner sob JSDOM não cobre porque não exercita o bundler.
#
# Pré-requisitos: `next build` (turbopack ou webpack) já rodou e populou
# `.next/`.
set -euo pipefail

PORT="${PORT:-3399}"
URL="http://127.0.0.1:${PORT}"
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

export AUTH_SECRET="${AUTH_SECRET:-ci-stub-secret-do-not-use-in-prod}"
export AUTH_URL="${AUTH_URL:-${URL}}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-${URL}}"
export DATABASE_URL="${DATABASE_URL:-postgresql://clinica:password@localhost:5432/clinica_agenda}"
export LEGAL_PAGES_ENABLED="${LEGAL_PAGES_ENABLED:-true}"
export PORT
# Logger silencioso durante o smoke (mantém o stdout do script limpo).
export LOG_LEVEL="${LOG_LEVEL:-warn}"

echo "[smoke] starting next start on :${PORT}"
PORT="$PORT" node node_modules/next/dist/bin/next start -p "$PORT" >"$LOG" 2>&1 &
NEXT_PID=$!
cleanup() {
  if kill -0 "$NEXT_PID" 2>/dev/null; then
    kill "$NEXT_PID" 2>/dev/null || true
    wait "$NEXT_PID" 2>/dev/null || true
  fi
}
trap 'cleanup; rm -f "$LOG"' EXIT

# Espera até 60s pelo Ready do Next.
for i in $(seq 1 60); do
  if grep -q -E "Ready in|started server on" "$LOG" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[smoke] next start crashed before Ready" >&2
    cat "$LOG" >&2
    exit 1
  fi
  sleep 1
done

if ! grep -q -E "Ready in|started server on" "$LOG"; then
  echo "[smoke] timed out waiting for next to be ready" >&2
  cat "$LOG" >&2
  exit 1
fi

fail=0
hit() {
  local path="$1"
  local expected="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${URL}${path}")
  if [[ "$code" == "$expected" ]]; then
    echo "[smoke] ${path} -> ${code} (ok)"
  else
    echo "[smoke] ${path} -> ${code} (expected ${expected})" >&2
    fail=1
  fi
}

# Rotas que não dependem de Postgres:
hit "/login" 200
hit "/legal/privacidade" 200
hit "/legal/subprocessadores" 200
hit "/legal/termos" 200

if [[ "$fail" -ne 0 ]]; then
  echo "[smoke] FAILED" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "[smoke] OK"
