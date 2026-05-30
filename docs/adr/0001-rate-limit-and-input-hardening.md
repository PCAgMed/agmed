# ADR-0001 — Rate-limit e hardening de endpoints públicos

- **Status:** aceito
- **Data:** 2026-05-30
- **Ticket:** AGM-27
- **Baseline:** AGM-17 (auditoria inicial)

## Contexto

Os endpoints `POST /api/auth/signup`, `POST /api/auth/[...nextauth]` (login) e
`POST /api/log/client-error` aceitavam volume ilimitado. O signup vazava
informação sobre quais e-mails já estavam cadastrados (409 ≠ 201, account
enumeration). O `/api/log/client-error` era anônimo, sem validação de origem,
sem cap de payload e sem throttling — pronto para virar vetor de log-flood.

Decisão de produto (CEO, AGM-27):

> Começar com rate-limit in-memory por instância como baseline (sem dependência
> de Upstash/Redis ainda) e migrar para backend distribuído quando virarmos
> multi-instância.

## Decisão

1. **Helper único `rateLimit({key, limit, windowSec, store?})`** em
   `src/lib/rate-limit/`. Implementação fixed-window em memória
   (`InMemoryFixedWindowStore`) por trás de uma interface `RateLimitStore`.
   Trocar para Redis/Upstash é uma implementação nova da interface, sem
   mudar nenhum call-site.

2. **Política por endpoint:**

   | Endpoint                                | Limite IP    | Limite por e-mail        |
   |-----------------------------------------|--------------|--------------------------|
   | `POST /api/auth/signup`                 | 10 / 1h      | 3 / 1h                   |
   | `POST /api/auth/callback/credentials`   | 5 / 1min     | 10 / 15min               |
   | `POST /api/log/client-error`            | 30 / 1min    | —                        |

3. **Respostas:** 429 com header `Retry-After` em segundos. Mensagem genérica
   em pt-BR para não vazar política.

4. **Signup uniforme:** sempre `200 { ok: true, message: "Se este e-mail
   estiver disponível, você receberá instruções por e-mail." }`. O log
   estruturado interno distingue success / email_taken / invalid_payload para
   ops, mas o HTTP é indistinguível para o atacante.

5. **`/api/log/client-error` hardening:**
   - `Origin` ou `Referer` precisam bater com `NEXT_PUBLIC_APP_URL`; senão 403.
   - Body > 16 KB → 413 (checado via `content-length` E via stream-cap).
   - `stack`, `componentStack`, `url`, `message`, `userAgent`, `name`
     truncados em limites fixos (ver `route.ts`).
   - `body.url` tem query string e hash removidos antes de logar.

6. **Métrica de bloqueio:** emitida como linha de log estruturada
   `event: "rate_limit.block"` com `endpoint`, `reason`, `keyClass`,
   `retryAfterSec`. Loki agrega via:

   ```logql
   sum by (endpoint, reason) (rate({event="rate_limit.block"}[1m]))
   ```

   Quando subirmos um endpoint Prometheus dedicado, transformamos em counter
   real `rate_limit_block_total{endpoint, reason}`.

## Consequências

- **Por instância apenas.** Se rodarmos N instâncias da app, cada uma terá
  sua própria janela; o limite efetivo vira N × `limit`. Aceitável enquanto
  rodamos single-VPS. Quando escalar, plugar Redis/Upstash via
  `RateLimitStore`.
- **Memória bounded.** A store faz sweep periódico de buckets expirados; o
  pior caso é O(keys_ativos_na_janela), o que para 30 req/min/IP é
  desprezível.
- **Signup uniforme tem custo de UX.** Usuários que tentarem se cadastrar
  com um e-mail já existente não recebem feedback explícito. Mitigamos via
  e-mail real (próximo ticket de verificação de e-mail): se o e-mail já
  estiver cadastrado, mandamos um e-mail "alguém tentou criar uma conta
  com seu endereço".
- **NextAuth wrap.** A rota catch-all do NextAuth detecta
  `/callback/credentials` e aplica rate-limit antes de delegar. Para isso
  precisamos `req.clone()` antes de ler o body, porque o handler downstream
  também consome o stream.

## Migração para Redis/Upstash (quando)

Disparar quando qualquer um destes for verdade:
- rodarmos mais de uma instância de web em produção;
- precisarmos compartilhar limites com workers fora do processo Next;
- quisermos persistir contadores entre restarts.

Implementação esperada: novo `RedisRateLimitStore` implementando
`RateLimitStore.hit()` via `INCR` + `EXPIRE` atômicos (script Lua). Trocar
`getDefaultStore()` para retornar o adapter remoto quando a env
`RATE_LIMIT_BACKEND=redis` estiver setada.

## Verificação

- Unit: `src/lib/rate-limit/rate-limit.test.ts`
- Integração: `src/tests/signup-rate-limit.test.ts`,
  `src/tests/client-error-hardening.test.ts`
- Cobre 11º POST de signup → 429; payload > 16 KB → 413; Origin inválido → 403.
