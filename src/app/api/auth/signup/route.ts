import { NextResponse } from 'next/server'
import { hashSync } from 'bcryptjs'
import { randomUUID } from 'crypto'
// AGM-24: signup ocorre ANTES de a conta ter qualquer clínica. Lookup por
// e-mail em `users` é cross-clinic por natureza — uso legítimo de
// `dbUnscopedDangerous`.
import { dbUnscopedDangerous } from '@/lib/db'
import { emailDomain, logAuthEvent } from '@/lib/observability/auth-events'
import { childLogger } from '@/lib/observability/logger'
import { logRateLimitBlock, rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Uniform 200 response — never reveal whether the email is taken. The real
// "welcome" email is sent by the verification flow (separate ticket).
const UNIFORM_BODY = {
  ok: true,
  message: 'Se este e-mail estiver disponível, você receberá instruções por e-mail.',
}

const PER_IP = { limit: 10, windowSec: 60 * 60 }
const PER_EMAIL = { limit: 3, windowSec: 60 * 60 }

export async function POST(req: Request) {
  const log = childLogger({ component: 'auth.signup' })

  const ip = getClientIp(req)
  const ipResult = rateLimit({ key: `signup:ip:${ip}`, ...PER_IP })
  if (!ipResult.allowed) {
    logRateLimitBlock({
      endpoint: '/api/auth/signup',
      reason: 'ip',
      keyClass: 'ip',
      result: ipResult,
    })
    return rateLimitedResponse({ retryAfterSec: ipResult.retryAfterSec })
  }

  let body: { name?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { name, email, password } = body
  const domain = emailDomain(email)
  logAuthEvent({ event: 'auth.signup.attempt', emailDomain: domain })

  if (!email || !password || password.length < 8) {
    logAuthEvent({
      event: 'auth.signup.error',
      emailDomain: domain,
      reason: 'invalid_payload',
    })
    return NextResponse.json(
      { error: 'E-mail e senha (mínimo 8 caracteres) são obrigatórios.' },
      { status: 400 },
    )
  }

  const normalizedEmail = email.toLowerCase()
  const emailResult = rateLimit({
    key: `signup:email:${normalizedEmail}`,
    ...PER_EMAIL,
  })
  if (!emailResult.allowed) {
    logRateLimitBlock({
      endpoint: '/api/auth/signup',
      reason: 'email',
      keyClass: 'email',
      result: emailResult,
    })
    return rateLimitedResponse({ retryAfterSec: emailResult.retryAfterSec })
  }

  const pool = dbUnscopedDangerous()
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail])
  if (existing.rows.length > 0) {
    // Log distinguishes the case for ops, but the HTTP response stays uniform
    // so an attacker cannot enumerate registered emails.
    logAuthEvent({
      event: 'auth.signup.error',
      emailDomain: domain,
      reason: 'email_taken',
    })
    return NextResponse.json(UNIFORM_BODY, { status: 200 })
  }

  const id = randomUUID()
  const hashed = hashSync(password, 12)
  try {
    await pool.query('INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, $4)', [
      id,
      name ?? null,
      normalizedEmail,
      hashed,
    ])
  } catch (err) {
    log.error({ event: 'auth.signup.error', err }, 'signup db insert failed')
    // Still uniform — surface a generic 500 only on genuine infra failure.
    return NextResponse.json({ error: 'Erro ao criar conta.' }, { status: 500 })
  }

  logAuthEvent({
    event: 'auth.signup.success',
    emailDomain: domain,
    userId: id,
  })
  return NextResponse.json(UNIFORM_BODY, { status: 200 })
}
