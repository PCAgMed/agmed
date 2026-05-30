import { NextResponse } from 'next/server'
import { childLogger } from '@/lib/observability/logger'
import { logRateLimitBlock, rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

interface ClientErrorPayload {
  message?: string
  stack?: string
  name?: string
  url?: string
  userAgent?: string
  componentStack?: string
}

const PER_IP = { limit: 30, windowSec: 60 }
const MAX_BODY_BYTES = 16 * 1024
const MAX_STACK_CHARS = 8 * 1024
const MAX_COMPONENT_STACK_CHARS = 8 * 1024
const MAX_URL_CHARS = 1024
const MAX_MESSAGE_CHARS = 1024
const MAX_USER_AGENT_CHARS = 512
const MAX_NAME_CHARS = 128

export async function POST(req: Request): Promise<NextResponse> {
  // Origin allow-list — only requests from the public app URL may post here.
  // Mitigates a CSRF-style log-flood from an arbitrary attacker page.
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!allowedOrigin || !isOriginAllowed(req, allowedOrigin)) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403 })
  }

  const ip = getClientIp(req)
  const ipResult = rateLimit({ key: `client-error:ip:${ip}`, ...PER_IP })
  if (!ipResult.allowed) {
    logRateLimitBlock({
      endpoint: '/api/log/client-error',
      reason: 'ip',
      keyClass: 'ip',
      result: ipResult,
    })
    return rateLimitedResponse({ retryAfterSec: ipResult.retryAfterSec })
  }

  // Enforce 16 KB body cap. Trust Content-Length when present; otherwise
  // count bytes as we read. This protects the log pipeline from a malicious
  // megabyte-stack flood.
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 })
  }

  const raw = await readBodyWithCap(req, MAX_BODY_BYTES)
  if (raw === null) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 })
  }

  let body: ClientErrorPayload
  try {
    body = JSON.parse(raw) as ClientErrorPayload
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const safe = sanitizeClientError(body)

  childLogger({ component: 'client' }).error(
    {
      event: 'client.error',
      err: {
        message: safe.message,
        stack: safe.stack,
        name: safe.name,
      },
      url: safe.url,
      userAgent: safe.userAgent,
      componentStack: safe.componentStack,
    },
    'client-side error reported',
  )

  return NextResponse.json({ ok: true })
}

function isOriginAllowed(req: Request, allowedOrigin: string): boolean {
  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const allowed = normalizeOrigin(allowedOrigin)
  if (origin && normalizeOrigin(origin) === allowed) return true
  if (referer && originOf(referer) === allowed) return true
  return false
}

function normalizeOrigin(value: string): string {
  try {
    const u = new URL(value)
    return `${u.protocol}//${u.host}`
  } catch {
    return value.replace(/\/+$/, '')
  }
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

async function readBodyWithCap(req: Request, maxBytes: number): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) {
    const text = await req.text()
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text
  }
  const decoder = new TextDecoder()
  let total = 0
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value?.byteLength ?? 0
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore — we've already decided to reject
      }
      return null
    }
    if (value) buffer += decoder.decode(value, { stream: true })
  }
  buffer += decoder.decode()
  return buffer
}

function sanitizeClientError(body: ClientErrorPayload): Required<ClientErrorPayload> {
  return {
    message: truncate(body.message, MAX_MESSAGE_CHARS) ?? 'unknown',
    stack: truncate(body.stack, MAX_STACK_CHARS) ?? '',
    name: truncate(body.name, MAX_NAME_CHARS) ?? '',
    url: stripQuery(truncate(body.url, MAX_URL_CHARS)),
    userAgent: truncate(body.userAgent, MAX_USER_AGENT_CHARS) ?? '',
    componentStack: truncate(body.componentStack, MAX_COMPONENT_STACK_CHARS) ?? '',
  }
}

function truncate(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > max ? value.slice(0, max) : value
}

function stripQuery(value: string | undefined): string {
  if (!value) return ''
  try {
    const u = new URL(value)
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    // Not a fully-qualified URL — drop any inline query string by chopping at '?'.
    const q = value.indexOf('?')
    return q < 0 ? value : value.slice(0, q)
  }
}
