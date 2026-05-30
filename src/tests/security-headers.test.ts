import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

async function getBaselineHeaders(): Promise<Record<string, string>> {
  if (typeof nextConfig.headers !== 'function') {
    throw new Error('next.config.headers() is not defined')
  }
  const groups = await nextConfig.headers()
  const root = groups.find((g) => g.source === '/:path*')
  if (!root) throw new Error('no headers group matched the root path')
  return Object.fromEntries(root.headers.map((h) => [h.key, h.value]))
}

describe('next.config security headers (AGM-25)', () => {
  it('exposes HSTS with 1y / includeSubDomains / preload', async () => {
    const headers = await getBaselineHeaders()
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    )
  })

  it('exposes the static hardening triad', async () => {
    const headers = await getBaselineHeaders()
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toMatch(/camera=\(\)/)
    expect(headers['Permissions-Policy']).toMatch(/microphone=\(\)/)
    expect(headers['Permissions-Policy']).toMatch(/geolocation=\(\)/)
  })

  it('ships CSP in Report-Only with the documented baseline directives', async () => {
    const headers = await getBaselineHeaders()
    expect(headers['Content-Security-Policy']).toBeUndefined()
    const csp = headers['Content-Security-Policy-Report-Only']
    expect(csp).toBeDefined()
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'report-uri /api/csp-report',
      'report-to csp-endpoint',
    ]) {
      expect(csp).toContain(directive)
    }
  })

  it('registers the csp-endpoint reporting group', async () => {
    const headers = await getBaselineHeaders()
    expect(headers['Reporting-Endpoints']).toContain('csp-endpoint="/api/csp-report"')
  })
})
