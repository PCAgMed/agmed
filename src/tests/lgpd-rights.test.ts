import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryFixedWindowStore, setDefaultStore } from '@/lib/rate-limit/store'

// Auth mock — todos os endpoints LGPD exigem session.user.id. Sobrescrever
// nos próprios testes para simular não-autenticado.
type FakeSession = { user: { id: string; email?: string } } | null
const authMock = vi.fn<() => Promise<FakeSession>>(async () => ({
  user: { id: 'prof-1', email: 'prof@example.com' },
}))
vi.mock('@/auth', () => ({ auth: () => authMock() }))

vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
const queryMock = vi.fn<QueryFn>(async () => ({ rows: [] }))
vi.mock('@/lib/db', () => ({ dbUnscopedDangerous: () => ({ query: queryMock }) }))

function buildRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.42',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
}

function professionalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prof-1',
    name: 'Dra. Ana',
    email: 'prof@example.com',
    emailVerified: null,
    image: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
    deletion_requested_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  setDefaultStore(new InMemoryFixedWindowStore())
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rows: [] })
  authMock.mockReset()
  authMock.mockResolvedValue({ user: { id: 'prof-1', email: 'prof@example.com' } })
})

afterEach(() => {
  setDefaultStore(undefined)
})

describe('GET /api/me/data', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/me/data/route')
    const res = await GET(buildRequest('http://localhost/api/me/data'))
    expect(res.status).toBe(401)
  })

  it('returns the data package with a protocol on success', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return { rows: [professionalRow()] }
      if (sql.includes('FROM consents')) return { rows: [] }
      return { rows: [] }
    })
    const { GET } = await import('@/app/api/me/data/route')
    const res = await GET(buildRequest('http://localhost/api/me/data'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { protocol: string; data: { schema: string } }
    expect(json.protocol).toMatch(/^LGPD-\d{8}-[0-9A-Z]{8}$/)
    expect(json.data.schema).toBe('clinica-agenda.lgpd.export.v1')
  })

  it('emits a 429 once the user bucket is exhausted', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return { rows: [professionalRow()] }
      return { rows: [] }
    })
    const { GET } = await import('@/app/api/me/data/route')
    for (let i = 0; i < 30; i++) {
      const ok = await GET(buildRequest('http://localhost/api/me/data'))
      expect(ok.status).toBe(200)
    }
    const blocked = await GET(buildRequest('http://localhost/api/me/data'))
    expect(blocked.status).toBe(429)
  })
})

describe('PATCH /api/me/profile', () => {
  it('rejects unknown fields silently and ignores them, requiring at least one editable field', async () => {
    const { PATCH } = await import('@/app/api/me/profile/route')
    const res = await PATCH(
      buildRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ password: 'hacked', emailVerified: '2030-01-01' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects empty name', async () => {
    const { PATCH } = await import('@/app/api/me/profile/route')
    const res = await PATCH(
      buildRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: '   ' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('updates the allowlisted name field', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE users SET')) return { rows: [] }
      if (sql.includes('FROM users')) return { rows: [professionalRow({ name: 'Dra. Ana M.' })] }
      return { rows: [] }
    })
    const { PATCH } = await import('@/app/api/me/profile/route')
    const res = await PATCH(
      buildRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Dra. Ana M.' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { profile: { name: string } }
    expect(json.profile.name).toBe('Dra. Ana M.')
    // O UPDATE só deve atingir colunas autorizadas
    const updateCall = queryMock.mock.calls.find((call) =>
      String((call as unknown[])[0] ?? '').startsWith('UPDATE users SET'),
    )
    expect(updateCall).toBeTruthy()
    const updateSql = String((updateCall as unknown[])[0])
    expect(updateSql).not.toMatch(/password/i)
    expect(updateSql).not.toMatch(/email/i)
  })
})

describe('POST /api/me/data/export', () => {
  it('returns a JSON file with Content-Disposition + protocol header', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return { rows: [professionalRow()] }
      return { rows: [] }
    })
    const { POST } = await import('@/app/api/me/data/export/route')
    const res = await POST(
      buildRequest('http://localhost/api/me/data/export', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('x-lgpd-protocol')).toMatch(/^LGPD-\d{8}-[0-9A-Z]{8}$/)
    const body = await res.json()
    expect(body.data.schema).toBe('clinica-agenda.lgpd.export.v1')
  })
})

describe('POST /api/me/data/delete', () => {
  it('rejects without confirmation token for scope=all', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return { rows: [professionalRow()] }
      return { rows: [] }
    })
    const { POST } = await import('@/app/api/me/data/delete/route')
    const res = await POST(
      buildRequest('http://localhost/api/me/data/delete', {
        method: 'POST',
        body: JSON.stringify({ scope: 'all' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('schedules account deletion ~30 days out and revokes active consents', async () => {
    let updateRequestedAt: Date | null = null
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users WHERE id')) return { rows: [professionalRow()] }
      if (sql.includes('FROM consents WHERE subject_type')) {
        return {
          rows: [
            {
              id: 'c1',
              subject_type: 'professional',
              subject_id: 'prof-1',
              kind: 'marketing_email',
              policy_version: 'v1',
              granted_at: new Date(),
              revoked_at: null,
            },
          ],
        }
      }
      if (sql.startsWith('UPDATE consents')) {
        return {
          rows: [
            {
              id: 'c1',
              subject_type: 'professional',
              subject_id: 'prof-1',
              kind: 'marketing_email',
              policy_version: 'v1',
              granted_at: new Date(),
              revoked_at: new Date(),
            },
          ],
        }
      }
      if (sql.includes('SET deletion_requested_at')) {
        updateRequestedAt = new Date()
        return { rows: [{ deletion_requested_at: updateRequestedAt }] }
      }
      return { rows: [] }
    })
    const { POST } = await import('@/app/api/me/data/delete/route')
    const res = await POST(
      buildRequest('http://localhost/api/me/data/delete', {
        method: 'POST',
        body: JSON.stringify({ scope: 'all', confirm: 'ELIMINAR' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      protocol: string
      receipt: {
        eliminated: { consents: string[] }
        scheduled: { accountHardDeleteAt: string } | null
      }
    }
    expect(json.receipt.eliminated.consents).toContain('marketing_email')
    expect(json.receipt.scheduled).not.toBeNull()
    const scheduled = new Date(json.receipt.scheduled!.accountHardDeleteAt)
    const expected = (updateRequestedAt as Date | null) ?? new Date()
    const diff = scheduled.getTime() - expected.getTime()
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(diff - thirtyDaysMs)).toBeLessThan(5000)
  })
})

describe('POST /api/me/consents/[kind]/revoke', () => {
  it('400s on unknown kind', async () => {
    const { POST } = await import('@/app/api/me/consents/[kind]/revoke/route')
    const res = await POST(
      buildRequest('http://localhost/api/me/consents/banana/revoke', { method: 'POST' }),
      { params: Promise.resolve({ kind: 'banana' }) },
    )
    expect(res.status).toBe(400)
  })

  it('is idempotent — returns success with changed=false when nothing to revoke', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    const { POST } = await import('@/app/api/me/consents/[kind]/revoke/route')
    const res = await POST(
      buildRequest('http://localhost/api/me/consents/marketing_email/revoke', {
        method: 'POST',
      }),
      { params: Promise.resolve({ kind: 'marketing_email' }) },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { receipt: { changed: boolean; hadConsent: boolean } }
    expect(json.receipt.changed).toBe(false)
    expect(json.receipt.hadConsent).toBe(false)
  })
})

describe('GET /api/me/data/subprocessors', () => {
  it('returns the static subprocessor list with a version and a protocol', async () => {
    const { GET } = await import('@/app/api/me/data/subprocessors/route')
    const res = await GET(buildRequest('http://localhost/api/me/data/subprocessors'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      protocol: string
      version: string
      subprocessors: Array<{ name: string }>
    }
    expect(json.version).toBeTruthy()
    expect(json.subprocessors.length).toBeGreaterThan(0)
    expect(json.subprocessors[0]).toHaveProperty('name')
  })
})
