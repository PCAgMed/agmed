import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryFixedWindowStore, setDefaultStore } from '@/lib/rate-limit/store'

const warnSpy = vi.fn()

vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({
    info: () => {},
    warn: (...args: unknown[]) => warnSpy(...args),
    error: () => {},
    debug: () => {},
  }),
}))

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    setDefaultStore(new InMemoryFixedWindowStore())
    warnSpy.mockClear()
  })

  afterEach(() => {
    setDefaultStore(undefined)
    vi.clearAllMocks()
  })

  it('returns 204 and logs a violation for legacy report-uri payloads', async () => {
    const { POST } = await import('@/app/api/csp-report/route')
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://app.local/dashboard',
        'violated-directive': "script-src 'self'",
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/x.js',
        disposition: 'report',
        'line-number': 42,
      },
    })
    const res = await POST(
      new Request('http://localhost/api/csp-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/csp-report',
          'x-forwarded-for': '203.0.113.20',
        },
        body,
      }),
    )
    expect(res.status).toBe(204)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [payload] = warnSpy.mock.calls[0] as [Record<string, unknown>, string]
    expect(payload.event).toBe('csp.violation')
    expect(payload.blockedUri).toBe('https://evil.example.com/x.js')
    expect(payload.violatedDirective).toBe("script-src 'self'")
    expect(payload.lineNumber).toBe(42)
  })

  it('returns 204 and logs for Reporting-API array payloads', async () => {
    const { POST } = await import('@/app/api/csp-report/route')
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        age: 0,
        url: 'https://app.local/dashboard',
        user_agent: 'Mozilla/5.0',
        body: {
          documentURL: 'https://app.local/dashboard',
          blockedURL: 'inline',
          effectiveDirective: 'script-src-elem',
          disposition: 'report',
        },
      },
    ])
    const res = await POST(
      new Request('http://localhost/api/csp-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/reports+json',
          'x-forwarded-for': '203.0.113.21',
        },
        body,
      }),
    )
    expect(res.status).toBe(204)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [payload] = warnSpy.mock.calls[0] as [Record<string, unknown>, string]
    expect(payload.effectiveDirective).toBe('script-src-elem')
    expect(payload.blockedUri).toBe('inline')
  })

  it('returns 204 (not 4xx) on invalid JSON so browsers do not retry-storm', async () => {
    const { POST } = await import('@/app/api/csp-report/route')
    const res = await POST(
      new Request('http://localhost/api/csp-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/csp-report',
          'x-forwarded-for': '203.0.113.22',
        },
        body: 'not-json{',
      }),
    )
    expect(res.status).toBe(204)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('rate-limits at the 121st request within a minute', async () => {
    const { POST } = await import('@/app/api/csp-report/route')
    const payload = JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } })
    for (let i = 0; i < 120; i++) {
      const ok = await POST(
        new Request('http://localhost/api/csp-report', {
          method: 'POST',
          headers: {
            'content-type': 'application/csp-report',
            'x-forwarded-for': '203.0.113.30',
          },
          body: payload,
        }),
      )
      expect(ok.status).toBe(204)
    }
    const blocked = await POST(
      new Request('http://localhost/api/csp-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/csp-report',
          'x-forwarded-for': '203.0.113.30',
        },
        body: payload,
      }),
    )
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })
})
