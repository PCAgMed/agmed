# Runbook — agente em `status=error` silencioso

Origem: [AGM-55](/AGM/issues/AGM-55) (hardening). Incidente reproduzido em [AGM-52](/AGM/issues/AGM-52), diagnosticado em [AGM-51](/AGM/issues/AGM-51).

## Quando este runbook se aplica

Um agente Paperclip (especialmente o `FoundingEngineer`, mas vale pra qualquer adapter `claude_local`) entrou em `status=error` SEM `pauseReason` populado. Sinais típicos:

- `GET /api/companies/{companyId}/agents` mostra o agente com `status: "error"`, `pauseReason: null`.
- Heartbeats pararam (`lastHeartbeatAt` ficou parado há vários minutos).
- A checkout que o agente detinha continua viva, bloqueando reassign.
- Issue automática `[health] {Agent} em status=error sem pauseReason` foi aberta pelo CEO via `scripts/agent-healthcheck.sh`.

`status=error` COM `pauseReason` é pausa de governance (budget, board), não-aplicável aqui.

## Por que acontece

Falha de runtime do adapter (crash silencioso do processo `claude_local`, asfixia de I/O, exception não-tratada na borda do harness). O supervisor do adapter **não** dispara wake do CEO/board automaticamente nesse caminho — daí o healthcheck externo.

Reproduzido em 2026-05-30 ~16:41 UTC: `FoundingEngineer` em error, segurando [AGM-24](/AGM/issues/AGM-24) (multi-tenancy, caminho crítico). Não houve retry automático.

## Diagnóstico rápido (~1 min)

```bash
# 1. Confirma o estado do agente
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/agents/<agent-id>" | jq '{status, pauseReason, lastHeartbeatAt, updatedAt}'

# 2. Confere checkouts pendentes (issues que o agente ainda "detém")
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?assigneeAgentId=<agent-id>&status=in_progress" \
  | jq '.[] | {identifier, title, updatedAt}'

# 3. Último run do agente (verificar exit code / stderr no log do adapter)
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/agents/<agent-id>/runs?limit=3" | jq '.[] | {id, status, finishedAt, lastWakeReason}'
```

Critérios de decisão:

| Sintoma | Ação |
| --- | --- |
| `status=error`, `pauseReason=null`, último run com `status=error` | Restart manual (próxima seção) |
| `status=error`, `pauseReason` populado | NÃO é runtime crash — é governance. Resolver a causa do pause antes de retomar |
| Reincidiu em < 30min após restart | Escalar pro board humano (provável bug do adapter — não tentar restart de novo) |
| Múltiplos agentes ao mesmo tempo | Provável incidente de infra (DB, rede). Não restartar individualmente — checar saúde do servidor Paperclip primeiro |

## Restart manual (procedimento canônico)

Executado em [AGM-52](/AGM/issues/AGM-52). Reproduzir os passos:

1. **Identificar o processo do adapter local**. Adapters `claude_local` rodam como processos filhos do servidor Paperclip. No host de dev:
   ```bash
   ps -ef | grep -E "(paperclipai|claude_local).*<agent-id>" | grep -v grep
   ```
2. **Capturar o stderr tail antes de matar** (para postmortem):
   ```bash
   # Localizar o log do run mais recente
   find ~/.paperclip/instances/default -path "*runs*<run-id>*" -name "*.log" 2>/dev/null
   tail -n 200 <log-file> > /tmp/agent-crash-<agent-id>.log
   ```
3. **Resetar o status do agente via API** (libera o supervisor pra aceitar próximo wake):
   ```bash
   curl -s -X PATCH \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H "Content-Type: application/json" \
     "$PAPERCLIP_API_URL/api/agents/<agent-id>" \
     -d '{"status": "idle"}'
   ```
4. **Liberar checkouts presas**, uma a uma:
   ```bash
   curl -s -X POST \
     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     "$PAPERCLIP_API_URL/api/issues/<issue-id>/release"
   ```
   Em seguida, reassign manualmente se for o caso (PATCH com `assigneeAgentId` ou comentário pedindo retomada).
5. **Disparar um wake de teste** para confirmar que o adapter recuperou:
   - Comentar na issue mais recente do agente com um `@-mention` curto, ou
   - Fazer PATCH para mover uma issue do agente de `backlog` → `todo`.
   - Acompanhar `lastHeartbeatAt` em `GET /api/agents/<id>`; deve atualizar em < 30s.
6. **Fechar a issue automática** do healthcheck com comentário explicando o que aconteceu (root cause + tail do stderr, se identificável).

## Quando escalar

Escalar pro board humano se:

- Reincidência em < 30 min após restart.
- Restart falha (agente volta a `error` imediatamente, ou não pega o wake).
- Tail do stderr mostra crash do harness Paperclip (não do código do agente) — isso é bug upstream.
- Mais de um agente em error simultaneamente.

Forma da escalação: comentário no issue automático do healthcheck marcando o board user com `@-mention`, OU criação de approval `request_board_approval` com payload do crash.

## Follow-up upstream (parqueado)

O fix definitivo é tornar o supervisor do adapter resiliente: auto-restart com backoff, wake estruturado do CEO em `status=error`, release automático de checkout. Está parqueado até [AGM-24](/AGM/issues/AGM-24) ser concluída — decisão registrada em [AGM-55](/AGM/issues/AGM-55) plan. Reavaliar quando houver slack pra contribuir em `paperclipai/paperclip`.

## Automação atual

- **Detecção**: `scripts/agent-healthcheck.sh` (no repo do produto).
- **Trigger**: routine cron `*/5 * * * *` atribuída ao CEO.
- **Saída**: cria issue crítica com `HC-Idempotency-Key: {agentId}:status-error:{YYYY-MM-DDTHH}` no rodapé. Issues abertas pela mesma key (mesma janela de 1h) são deduplicadas via search.
- **Latência máxima**: ~5 minutos entre o crash e o alerta (cron). Aceitável dado o pré-revenue stage.
