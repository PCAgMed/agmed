// AGM-24 commit D — testes do módulo `@/lib/auth/sessions`.
//
// Cobre a interface DB sem precisar de Postgres real (mock do pool):
//  - createSession gera UUID + grava com TTL default = 15 min
//  - lookupActiveSession retorna row quando ativa
//  - lookupActiveSession retorna null em jti/userId vazios (input invalido)
//  - lookupActiveSession atualiza last_seen_at no caminho feliz (touch)
//  - revokeSessionByJti retorna true em row UPDATEd, false em rowCount 0
//  - revokeAllSessionsForUser retorna count
//  - hashUserAgent é determinístico e produz sha256 hex
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const queryMock = vi.fn<
  (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>
>(async () => ({ rows: [], rowCount: 0 }))

vi.mock('@/lib/db', () => ({
  dbUnscopedDangerous: () => ({ query: queryMock }),
}))

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hashUserAgent', () => {
  it('returns null for null/undefined/empty', async () => {
    const { hashUserAgent } = await import('@/lib/auth/sessions')
    expect(hashUserAgent(null)).toBeNull()
    expect(hashUserAgent(undefined)).toBeNull()
    expect(hashUserAgent('')).toBeNull()
  })

  it('returns deterministic sha256 hex for the same input', async () => {
    const { hashUserAgent } = await import('@/lib/auth/sessions')
    const a = hashUserAgent('Mozilla/5.0')
    const b = hashUserAgent('Mozilla/5.0')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different hashes for different inputs', async () => {
    const { hashUserAgent } = await import('@/lib/auth/sessions')
    expect(hashUserAgent('a')).not.toBe(hashUserAgent('b'))
  })
})

describe('createSession', () => {
  it('inserts row with default TTL 15min and returns jti+expiresAt', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const { createSession, SESSION_TTL_SECONDS } = await import('@/lib/auth/sessions')
    const before = Date.now()
    const out = await createSession({ userId: 'prof-1' })
    const after = Date.now()

    expect(out.jti).toMatch(/^[0-9a-f-]{36}$/i)
    expect(out.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + SESSION_TTL_SECONDS * 1000 - 50,
    )
    expect(out.expiresAt.getTime()).toBeLessThanOrEqual(
      after + SESSION_TTL_SECONDS * 1000 + 50,
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
    const params = queryMock.mock.calls[0][1] as unknown[]
    expect(params[0]).toBe('prof-1')
    expect(params[1]).toBe(out.jti)
  })

  it('respects custom ttlSeconds', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const { createSession } = await import('@/lib/auth/sessions')
    const before = Date.now()
    const out = await createSession({ userId: 'prof-1', ttlSeconds: 30 })
    expect(out.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 1000 - 50)
    expect(out.expiresAt.getTime()).toBeLessThanOrEqual(before + 30 * 1000 + 200)
  })

  it('hashes user agent before INSERT', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const { createSession } = await import('@/lib/auth/sessions')
    await createSession({ userId: 'prof-1', userAgent: 'Mozilla/5.0' })
    const params = queryMock.mock.calls[0][1] as unknown[]
    // params[5] = user_agent_hash (after user_id, jti, issued_at, expires_at, ip)
    expect(params[5]).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('lookupActiveSession', () => {
  it('returns null for empty userId or jti', async () => {
    const { lookupActiveSession } = await import('@/lib/auth/sessions')
    expect(await lookupActiveSession({ userId: '', jti: 'x' })).toBeNull()
    expect(await lookupActiveSession({ userId: 'u', jti: '' })).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns null when no row found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const { lookupActiveSession } = await import('@/lib/auth/sessions')
    const out = await lookupActiveSession({ userId: 'u', jti: 'j' })
    expect(out).toBeNull()
  })

  it('returns mapped session when row found and triggers last_seen_at touch', async () => {
    const row = {
      id: 's-1',
      user_id: 'u',
      jti: 'j',
      issued_at: new Date('2026-05-30T00:00:00Z'),
      expires_at: new Date('2026-05-30T00:15:00Z'),
      revoked_at: null,
      revoked_reason: null,
      last_seen_at: null,
      ip: '203.0.113.42',
      user_agent_hash: 'abc',
    }
    // First call = SELECT, second call = UPDATE touch
    queryMock.mockResolvedValueOnce({ rows: [row], rowCount: 1 })
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const { lookupActiveSession } = await import('@/lib/auth/sessions')
    const out = await lookupActiveSession({ userId: 'u', jti: 'j' })
    expect(out).not.toBeNull()
    expect(out?.id).toBe('s-1')
    expect(out?.userId).toBe('u')
    expect(out?.jti).toBe('j')

    // SELECT filtra status active + non-expired (sanity check)
    const selectSql = queryMock.mock.calls[0][0]
    expect(selectSql).toMatch(/revoked_at\s+IS\s+NULL/i)
    expect(selectSql).toMatch(/expires_at\s*>\s*now\(\)/i)

    // Touch é fire-and-forget; aguarda um tick para que a Promise dispare
    await new Promise((r) => setImmediate(r))
    const sqls = queryMock.mock.calls.map((c) => c[0])
    expect(sqls.some((s) => /UPDATE user_sessions SET last_seen_at/i.test(s))).toBe(true)
  })
})

describe('revokeSessionByJti', () => {
  it('returns false for empty jti', async () => {
    const { revokeSessionByJti } = await import('@/lib/auth/sessions')
    expect(await revokeSessionByJti('', 'logout')).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns true when row was updated', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const { revokeSessionByJti } = await import('@/lib/auth/sessions')
    const ok = await revokeSessionByJti('jti-1', 'logout')
    expect(ok).toBe(true)
    const sql = queryMock.mock.calls[0][0]
    expect(sql).toMatch(/UPDATE\s+user_sessions/i)
    expect(sql).toMatch(/SET\s+revoked_at\s*=\s*now\(\)/i)
    expect(sql).toMatch(/revoked_at\s+IS\s+NULL/i) // idempotência
  })

  it('returns false when no row was updated (already revoked or absent)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const { revokeSessionByJti } = await import('@/lib/auth/sessions')
    expect(await revokeSessionByJti('jti-1', 'logout')).toBe(false)
  })
})

describe('revokeAllSessionsForUser', () => {
  it('returns 0 for empty userId', async () => {
    const { revokeAllSessionsForUser } = await import('@/lib/auth/sessions')
    expect(await revokeAllSessionsForUser('', 'admin_revoke')).toBe(0)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns rowCount when sessions revoked', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 3 })
    const { revokeAllSessionsForUser } = await import('@/lib/auth/sessions')
    expect(await revokeAllSessionsForUser('u', 'admin_revoke')).toBe(3)
    const sql = queryMock.mock.calls[0][0]
    expect(sql).toMatch(/UPDATE\s+user_sessions/i)
    expect(sql).toMatch(/WHERE\s+user_id\s*=\s*\$1/i)
  })
})
