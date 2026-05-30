import { NextResponse } from 'next/server'
import { hashSync } from 'bcryptjs'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { emailDomain, logAuthEvent } from '@/lib/observability/auth-events'
import { childLogger } from '@/lib/observability/logger'

export async function POST(req: Request) {
  const log = childLogger({ component: 'auth.signup' })

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

  const pool = getPool()
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [
    email.toLowerCase(),
  ])
  if (existing.rows.length > 0) {
    logAuthEvent({
      event: 'auth.signup.error',
      emailDomain: domain,
      reason: 'email_taken',
    })
    return NextResponse.json({ error: 'E-mail já cadastrado.' }, { status: 409 })
  }

  const id = randomUUID()
  const hashed = hashSync(password, 12)
  try {
    await pool.query('INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, $4)', [
      id,
      name ?? null,
      email.toLowerCase(),
      hashed,
    ])
  } catch (err) {
    log.error({ event: 'auth.signup.error', err }, 'signup db insert failed')
    return NextResponse.json({ error: 'Erro ao criar conta.' }, { status: 500 })
  }

  logAuthEvent({
    event: 'auth.signup.success',
    emailDomain: domain,
    userId: id,
  })
  return NextResponse.json({ success: true }, { status: 201 })
}
