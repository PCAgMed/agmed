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

// AGM-24 commit D — paths onde NÃO chamamos revalidação per-request:
//  - rotas públicas (definido acima)
//  - `/api/internal/*` — caller é o próprio middleware via fetch; evitar
//    loop. (O matcher também exclui, mas defesa em profundidade.)
//  - `/api/session/active-clinic` — endpoint de switch de clínica. Faz a
//    própria validação de membership e re-emit do JWT; não precisa de
//    revalidação do middleware (e a chamada criaria um corner case onde
//    o user troca de clínica e o cache ainda guarda a anterior).
//  - `/api/auth/*` — já excluído do matcher (lida com signin/signout).
const REVALIDATION_SKIP_PATHS = [
  '/api/internal/',
  '/api/session/active-clinic',
]

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
type AuthedRequest = NextRequest & {
  auth: {
    user?: { id?: string }
    activeClinicId?: string | null
    jti?: string | null
  } | null
}

// AGM-24 commit D — kill switch para a revalidação. Permite operar com
// o middleware mas sem o roundtrip para `/api/internal/tenant-check` em
// emergência (e.g. tenant-check down + queremos manter usuários logados
// num modo degradado controlado). Default: ligado. Tirar do env vars de
// produção é sinal de incidente registrável.
const REVALIDATION_ENABLED =
  process.env.TENANT_REVALIDATION_ENABLED !== 'false'

async function revalidate(
  origin: string,
  payload: { userId: string; jti: string; activeClinicId: string | null },
  requestId: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 400; reason: string }> {
  const url = new URL('/api/internal/tenant-check', origin)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-call': '1',
        [REQUEST_ID_HEADER]: requestId,
      },
      body: JSON.stringify(payload),
      // Edge fetch defaults to no cache; explicit for clarity.
      cache: 'no-store',
    })
  } catch (err) {
    // Failure-closed: se não conseguimos confirmar que a sessão está
    // ativa, derrubamos. Alternativa "permissiva" (deixar passar) abriria
    // janela de uso de sessões revogadas sempre que a rota interna
    // estivesse com problemas.
    logRequestLine({
      event: 'request.revalidate.fetch_failed',
      requestId,
      err: String(err),
    })
    return { ok: false, status: 401, reason: 'revalidation_unavailable' }
  }
  if (res.ok) return { ok: true }
  let reason = 'unknown'
  try {
    const body = (await res.json()) as { reason?: string }
    if (typeof body?.reason === 'string') reason = body.reason
  } catch {
    // ignore — non-JSON body shouldn't happen but don't blow up the request
  }
  const status =
    res.status === 401 ? 401 : res.status === 403 ? 403 : res.status === 400 ? 400 : 401
  return { ok: false, status, reason }
}

function clearSessionAndRedirect(req: NextRequest, requestId: string): NextResponse {
  const loginUrl = new URL('/login', req.nextUrl)
  loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search)
  const response = NextResponse.redirect(loginUrl)
  // Tenta limpar os cookies de sessão conhecidos do NextAuth (prefixo padrão
  // em produção é `__Secure-`; em dev é `authjs.`). Cookie residual com JWT
  // assinado vai bater no nosso `requireActiveClinic` server-side e dar 401
  // de qualquer jeito, mas limpar agora dá melhor UX e tira o token do
  // tráfego subsequente.
  response.cookies.delete('authjs.session-token')
  response.cookies.delete('__Secure-authjs.session-token')
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

function clearSessionAndUnauthorizedJson(requestId: string): NextResponse {
  const response = NextResponse.json(
    { error: 'Sessão inválida ou expirada' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  )
  response.cookies.delete('authjs.session-token')
  response.cookies.delete('__Secure-authjs.session-token')
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export default auth(async (rawReq) => {
  const req = rawReq as AuthedRequest
  const startedAt = Date.now()
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID()

  const isLoggedIn = !!req.auth?.user?.id
  const isPublicPath = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))
  const isApiPath = req.nextUrl.pathname.startsWith('/api/')
  const skipRevalidation = REVALIDATION_SKIP_PATHS.some((p) =>
    req.nextUrl.pathname.startsWith(p),
  )

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

  // AGM-24 commit D — revalidação per-request: confirma que o JWT
  // corresponde a uma sessão não-revogada + membership ativa (se houver
  // `activeClinicId` no token). Cache TTL 60s na rota Node mantém a carga
  // de DB baixa.
  if (
    REVALIDATION_ENABLED &&
    isLoggedIn &&
    !isPublicPath &&
    !skipRevalidation
  ) {
    const userId = req.auth!.user?.id
    const jti = req.auth!.jti
    const activeClinicId = req.auth!.activeClinicId ?? null

    if (!userId || !jti) {
      // JWT sem jti = sessão pré-commit-D (legacy) ou JWT forjado sem
      // tracking. Failure-closed: termina a sessão.
      logRequestLine({
        event: 'request.revalidate.missing_claim',
        requestId,
        hasUserId: !!userId,
        hasJti: !!jti,
        path: req.nextUrl.pathname,
      })
      if (isApiPath) return clearSessionAndUnauthorizedJson(requestId)
      return clearSessionAndRedirect(req, requestId)
    }

    const outcome = await revalidate(
      req.nextUrl.origin,
      { userId, jti, activeClinicId },
      requestId,
    )
    if (!outcome.ok) {
      logRequestLine({
        event: 'request.revalidate.denied',
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        reason: outcome.reason,
        status: outcome.status,
      })
      if (isApiPath) return clearSessionAndUnauthorizedJson(requestId)
      return clearSessionAndRedirect(req, requestId)
    }
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
  // AGM-24 commit D — `api/internal` no negative lookahead pra evitar o
  // loop middleware → /api/internal/tenant-check → middleware → ...
  matcher: [
    '/((?!api/auth|api/internal|api/csp-report|_next/static|_next/image|favicon.ico).*)',
  ],
}
