// AGM-24 commit D — session revocation tracking.
//
// Tabela `user_sessions` armazena uma linha por JWT emitido. Quando o JWT
// é assinado em `authorize()`, geramos um `jti` (JWT id) e gravamos a
// linha. O middleware per-request valida `(jti, revoked_at IS NULL,
// expires_at > now())` em cada request. Logout chama `revokeSessionByJti`
// que marca `revoked_at = now()` e o próximo request com aquele JWT é
// terminado pelo middleware.
//
// Por que `dbUnscopedDangerous`: a tabela é per-user, não per-tenant.
// Lookup roda como `agenda_owner` (role de sessão), igual ao lookup de
// `users` no login. Não há RLS habilitada nesta tabela (ver migration
// 0006). Toda query filtra explicitamente por `(jti, user_id)` — o
// `jti` é único globalmente (UUID v4) e o `user_id` é defesa adicional.
import { createHash, randomUUID } from 'crypto'
import { dbUnscopedDangerous } from '@/lib/db'

// JWT lifetime: 15 minutos. SecEng brief: "Token de curta duração (15 min)
// + refresh token revogável. Lifetime ilimitado não passa." NextAuth com
// estratégia JWT rota o token no callback `jwt()` quando há atividade;
// o `expires_at` aqui serve como source of truth para o middleware (não
// confiamos só no `exp` do JWT — ele pode ter sido roubado e ainda estar
// dentro do prazo).
export const SESSION_TTL_SECONDS = 15 * 60

export type UserSession = {
  id: string
  userId: string
  jti: string
  issuedAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revokedReason: SessionRevokeReason | null
  lastSeenAt: Date | null
  ip: string | null
  userAgentHash: string | null
}

export type SessionRevokeReason = 'logout' | 'admin_revoke' | 'rotation' | 'expired_cleanup'

/**
 * Hash do user-agent para reduzir superfície de PII no banco. Permite
 * comparar "mesmo browser" sem armazenar o UA cru.
 */
export function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  return createHash('sha256').update(ua).digest('hex')
}

/**
 * Cria uma nova linha de sessão. Chamado pelo `authorize()` no login.
 * Retorna o `jti` gerado — caller copia pro JWT claim.
 *
 * Falha = login falha (failure-closed). Se a tabela está fora, melhor não
 * emitir um JWT que nunca poderá ser revogado.
 */
export async function createSession(input: {
  userId: string
  ip?: string | null
  userAgent?: string | null
  ttlSeconds?: number
}): Promise<{ jti: string; expiresAt: Date }> {
  const jti = randomUUID()
  const now = new Date()
  const ttl = input.ttlSeconds ?? SESSION_TTL_SECONDS
  const expiresAt = new Date(now.getTime() + ttl * 1000)
  const pool = dbUnscopedDangerous()
  await pool.query(
    `INSERT INTO user_sessions
       (user_id, jti, issued_at, expires_at, last_seen_at, ip, user_agent_hash)
     VALUES ($1, $2, $3, $4, $3, $5, $6)`,
    [input.userId, jti, now, expiresAt, input.ip ?? null, hashUserAgent(input.userAgent)],
  )
  return { jti, expiresAt }
}

/**
 * Lookup canônico: a sessão `jti` está ativa AGORA?
 *
 * Retorna `null` em qualquer caso de "não vale":
 *  - jti não existe (revogado e limpo, ou nunca emitido por nós)
 *  - revoked_at IS NOT NULL (logout, admin revoke, rotation)
 *  - expires_at <= now() (TTL expirou; middleware deve terminar a sessão)
 *  - user_id no JWT não bate com a row (defesa contra confusão / token
 *    forjado com jti válido mas user_id de outro)
 *
 * Atualiza `last_seen_at` no caminho feliz (best-effort, não bloqueia o
 * retorno) — útil pra admin panel listar sessões ativas e quando foram
 * vistas pela última vez. Failure de UPDATE não derruba a revalidação.
 */
export async function lookupActiveSession(input: {
  userId: string
  jti: string
}): Promise<UserSession | null> {
  if (typeof input.userId !== 'string' || input.userId.length === 0) return null
  if (typeof input.jti !== 'string' || input.jti.length === 0) return null

  const pool = dbUnscopedDangerous()
  const result = await pool.query<{
    id: string
    user_id: string
    jti: string
    issued_at: Date
    expires_at: Date
    revoked_at: Date | null
    revoked_reason: SessionRevokeReason | null
    last_seen_at: Date | null
    ip: string | null
    user_agent_hash: string | null
  }>(
    `SELECT id, user_id, jti, issued_at, expires_at, revoked_at, revoked_reason,
            last_seen_at, ip, user_agent_hash
       FROM user_sessions
      WHERE jti = $1
        AND user_id = $2
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [input.jti, input.userId],
  )
  const row = result.rows[0]
  if (!row) return null

  // Touch last_seen_at sem bloquear. Erro aqui é forensic loss, não risco
  // de auth — a row já passou no gate.
  void pool
    .query('UPDATE user_sessions SET last_seen_at = now() WHERE id = $1', [row.id])
    .catch(() => {})

  return {
    id: row.id,
    userId: row.user_id,
    jti: row.jti,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    lastSeenAt: row.last_seen_at,
    ip: row.ip,
    userAgentHash: row.user_agent_hash,
  }
}

/**
 * Revoga uma sessão pelo `jti`. Idempotente: já-revogada não faz nada;
 * jti inexistente não erra.
 *
 * Retorna `true` se a row foi efetivamente revogada nesta chamada,
 * `false` se já estava revogada ou não existia (útil pra audit).
 */
export async function revokeSessionByJti(
  jti: string,
  reason: SessionRevokeReason,
): Promise<boolean> {
  if (typeof jti !== 'string' || jti.length === 0) return false
  const pool = dbUnscopedDangerous()
  const result = await pool.query(
    `UPDATE user_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE jti = $1
        AND revoked_at IS NULL`,
    [jti, reason],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Revoga todas as sessões ativas de um usuário. Usado por:
 *  - "kill all sessions" no admin panel (futuro)
 *  - mudança de senha (segurança), Art. 18 IV / V (LGPD futuro)
 *  - suspensão de membership multi-clinic (talvez? — decidir em AGM-47)
 *
 * Retorna o número de sessões efetivamente revogadas.
 */
export async function revokeAllSessionsForUser(
  userId: string,
  reason: SessionRevokeReason,
): Promise<number> {
  if (typeof userId !== 'string' || userId.length === 0) return 0
  const pool = dbUnscopedDangerous()
  const result = await pool.query(
    `UPDATE user_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1
        AND revoked_at IS NULL`,
    [userId, reason],
  )
  return result.rowCount ?? 0
}
