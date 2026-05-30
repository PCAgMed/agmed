import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryFixedWindowStore, setDefaultStore } from '@/lib/rate-limit/store'

vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

describe('POST /api/log/client-error hardening', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    setDefaultStore(new InMemoryFixedWindowStore())
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    setDefaultStore(undefined)
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_ENV
    vi.clearAllMocks()
  })

  it('rejects requests with a mismatched Origin (403)', async () => {
    const { POST } = await import('@/app/api/log/client-error/route')
    const res = await POST(
      new Request('http://localhost/api/log/client-error', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://evil.example.com',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ message: 'boom' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('accepts requests with the allow-listed Origin', async () => {
    const { POST } = await import('@/app/api/log/client-error/route')
    const res = await POST(
      new Request('http://localhost/api/log/client-error', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ message: 'boom' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('rejects payloads larger than 16 KB with 413', async () => {
    const { POST } = await import('@/app/api/log/client-error/route')
    const huge = 'x'.repeat(17 * 1024)
    const res = await POST(
      new Request('http://localhost/api/log/client-error', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          'content-length': String(huge.length + 20),
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ message: huge }),
      }),
    )
    expect(res.status).toBe(413)
  })

  it('rate-limits at the 31st request within a minute', async () => {
    const { POST } = await import('@/app/api/log/client-error/route')
    for (let i = 0; i < 30; i++) {
      const ok = await POST(
        new Request('http://localhost/api/log/client-error', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-forwarded-for': '203.0.113.11',
          },
          body: JSON.stringify({ message: 'boom', n: i }),
        }),
      )
      expect(ok.status).toBe(200)
    }
    const blocked = await POST(
      new Request('http://localhost/api/log/client-error', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          'x-forwarded-for': '203.0.113.11',
        },
        body: JSON.stringify({ message: 'boom' }),
      }),
    )
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })
})
