import NextAuth from 'next-auth'
import { NextResponse, type NextRequest } from 'next/server'
import { authConfig } from './auth.config'
import { getAppEnv, getReleaseTag, getServiceName } from './lib/observability/env'

const { auth } = NextAuth(authConfig)

const REQUEST_ID_HEADER = 'x-request-id'

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

export default auth((req: NextRequest) => {
  const startedAt = Date.now()
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID()

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
