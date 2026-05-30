import type { NextConfig } from 'next'

// Security header baseline (AGM-25).
//
// CSP ships in Report-Only mode while the front-end is minimal — see
// README "Security headers". Flip to enforce (Content-Security-Policy) and
// remove 'unsafe-inline'/'unsafe-eval' before the first public user-input
// flow lands. Dev keeps 'unsafe-eval' for Turbopack/HMR; prod does not.
const isDev = process.env.NODE_ENV !== 'production'

function buildContentSecurityPolicy(): string {
  // 'unsafe-inline' on script-src is needed for Next.js hydration until we
  // wire a per-request nonce via middleware (deferred — see README). It is
  // intentionally still listed here for the Report-Only phase so violations
  // we'd care about under enforce show up in the report stream too.
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'"

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ]
  return directives.join('; ')
}

const securityHeaders = [
  // HTTPS only. preload-ready; submit to hstspreload.org once we serve a
  // stable apex domain over TLS.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: buildContentSecurityPolicy(),
  },
  // Modern Reporting API endpoint group used by the report-to directive
  // above. Browsers that still only speak the legacy report-uri form will
  // post to /api/csp-report directly.
  {
    key: 'Reporting-Endpoints',
    value: 'csp-endpoint="/api/csp-report"',
  },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
