import { NextResponse } from 'next/server'
import { hashSync } from 'bcryptjs'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'

export async function POST(req: Request) {
  let body: { name?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { name, email, password } = body
  if (!email || !password || password.length < 8) {
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
    return NextResponse.json({ error: 'E-mail já cadastrado.' }, { status: 409 })
  }

  const id = randomUUID()
  const hashed = hashSync(password, 12)
  await pool.query('INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, $4)', [
    id,
    name ?? null,
    email.toLowerCase(),
    hashed,
  ])

  return NextResponse.json({ success: true }, { status: 201 })
}
