import NextAuth from 'next-auth'
import { NextResponse, type NextRequest } from 'next/server'
import { authConfig } from './auth.config'
import { getAppEnv, getReleaseTag, getServiceName } from './lib/observability/env'

const { auth } = NextAuth(authConfig)

const REQUEST_ID_HEADER = 'x-request-id'
// Páginas públicas (sem sessão). `/legal/*` são documentos legais
// servidos atrás do flag LEGAL_PAGES_ENABLED — o layout em
// src/app/legal/layout.tsx devolve 404 quando o flag está off, então
// não precisamos duplicar o gate aqui (AGM-42).
const PUBLIC_PATHS = ['/login', '/signup', '/verify-email', '/legal']

// Edge runtime — cannot use pino here. Emit a minimal JSON line directly
// to stdout so Docker/Loki picks it up the same way it picks up pino lines.
function logRequestLine(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      service: getServiceName(),
      env: getAppEnv(),
      release: getReleaseTag(),
      level: 'info',
      time: new Date().toISOString(),
      ...payload,
    }),
  )
}

// `auth()` exposes `req.auth` populated from the session JWT. The wrapper
// always invokes this handler even when `authConfig.authorized()` returned
// `false`, so we enforce the redirect/401 here for non-public paths. API
// routes get a JSON 401 from the authConfig callback before reaching this
// handler (Response short-circuit); page routes get bounced to /login here.
type AuthedRequest = NextRequest & { auth: unknown }

export default auth((rawReq) => {
  const req = rawReq as AuthedRequest
  const startedAt = Date.now()
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID()

  const isLoggedIn = !!req.auth
  const isPublicPath = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))
  const isApiPath = req.nextUrl.pathname.startsWith('/api/')

  if (!isLoggedIn && !isPublicPath && !isApiPath) {
    const loginUrl = new URL('/login', req.nextUrl)
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search)
    logRequestLine({
      event: 'request.auth.redirect',
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
      to: '/login',
    })
    const redirect = NextResponse.redirect(loginUrl)
    redirect.headers.set(REQUEST_ID_HEADER, requestId)
    return redirect
  }

  // Make the request id available to downstream handlers/components.
  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(req.headers.entries()),
        [REQUEST_ID_HEADER]: requestId,
      }),
    },
  })
  response.headers.set(REQUEST_ID_HEADER, requestId)

  logRequestLine({
    event: 'request.start',
    requestId,
    method: req.method,
    path: req.nextUrl.pathname,
    durationMs: Date.now() - startedAt,
  })

  return response
})

export const config = {
  matcher: ['/((?!api/auth|api/csp-report|_next/static|_next/image|favicon.ico).*)'],
}
