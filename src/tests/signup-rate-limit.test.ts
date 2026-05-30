import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryFixedWindowStore, setDefaultStore } from '@/lib/rate-limit/store'

vi.mock('@/lib/db', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  return { getPool: () => ({ query }), __query: query }
})

// Pino-loki tries to connect on import; silence stdout noise during tests
// and avoid any network IO. We don't assert on logs in this suite.
vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

vi.mock('@/lib/observability/auth-events', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/observability/auth-events')>(
      '@/lib/observability/auth-events',
    )
  return { ...actual, logAuthEvent: () => {} }
})

// bcrypt salting in a tight loop would dominate the test budget. Stub it.
vi.mock('bcryptjs', () => ({ hashSync: () => 'hashed' }))

describe('POST /api/auth/signup hardening', () => {
  beforeEach(() => {
    setDefaultStore(new InMemoryFixedWindowStore())
  })

  afterEach(() => {
    setDefaultStore(undefined)
    vi.clearAllMocks()
  })

  it('returns a uniform 200 on success', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(buildSignupRequest({ email: 'a@example.com', password: 'longenough' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true })
    expect(json.message).toContain('disponível')
  })

  it('returns the same uniform 200 when the email already exists', async () => {
    const db = await import('@/lib/db')
    const pool = db.getPool() as unknown as { query: ReturnType<typeof vi.fn> }
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'taken' }] })

    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(buildSignupRequest({ email: 'taken@example.com', password: 'longenough' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true })
  })

  it('rate-limits at the 11th POST from the same IP within an hour', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    for (let i = 0; i < 10; i++) {
      const ok = await POST(
        buildSignupRequest({ email: `user${i}@example.com`, password: 'longenough' }),
      )
      expect(ok.status).toBe(200)
    }
    const blocked = await POST(
      buildSignupRequest({ email: 'user11@example.com', password: 'longenough' }),
    )
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })
})

function buildSignupRequest(payload: { email: string; password: string; name?: string }): Request {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify(payload),
  })
}
