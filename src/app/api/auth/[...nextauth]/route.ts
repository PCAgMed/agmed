import { handlers } from '@/auth'
import { logRateLimitBlock, rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

export const { GET } = handlers

const SIGNIN_PER_IP = { limit: 5, windowSec: 60 }
const SIGNIN_PER_EMAIL = { limit: 10, windowSec: 15 * 60 }

// Wrap the NextAuth POST handler to apply rate-limit on the credentials
// callback only. Other NextAuth POST routes (CSRF token, etc.) pass through
// untouched so we don't break Auth.js internals.
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if (!url.pathname.endsWith('/callback/credentials')) {
    return handlers.POST(req as Parameters<typeof handlers.POST>[0])
  }

  const ip = getClientIp(req)
  const ipResult = rateLimit({ key: `signin:ip:${ip}`, ...SIGNIN_PER_IP })
  if (!ipResult.allowed) {
    logRateLimitBlock({
      endpoint: '/api/auth/callback/credentials',
      reason: 'ip',
      keyClass: 'ip',
      result: ipResult,
    })
    return rateLimitedResponse({ retryAfterSec: ipResult.retryAfterSec })
  }

  // Clone before reading body — handlers.POST will read it again.
  const email = await peekEmailFromCredentials(req.clone())
  if (email) {
    const emailResult = rateLimit({
      key: `signin:email:${email.toLowerCase()}`,
      ...SIGNIN_PER_EMAIL,
    })
    if (!emailResult.allowed) {
      logRateLimitBlock({
        endpoint: '/api/auth/callback/credentials',
        reason: 'email',
        keyClass: 'email',
        result: emailResult,
      })
      return rateLimitedResponse({ retryAfterSec: emailResult.retryAfterSec })
    }
  }

  return handlers.POST(req as Parameters<typeof handlers.POST>[0])
}

async function peekEmailFromCredentials(req: Request): Promise<string | null> {
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text()
      const params = new URLSearchParams(text)
      const v = params.get('email')
      return v?.trim() || null
    }
    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData()
      const v = fd.get('email')
      return typeof v === 'string' ? v.trim() || null : null
    }
    if (contentType.includes('application/json')) {
      const j = (await req.json()) as { email?: unknown }
      return typeof j?.email === 'string' ? j.email.trim() || null : null
    }
  } catch {
    // Falling through to null means we still enforce the per-IP limit but
    // skip the per-email one for this request. That is intentional — Auth.js
    // will reject malformed bodies for us downstream.
  }
  return null
}
