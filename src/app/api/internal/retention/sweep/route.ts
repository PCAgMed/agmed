import { NextResponse } from 'next/server'
import { childLogger } from '@/lib/observability/logger'
import { runRetentionSweep } from '@/lib/lgpd/retention-sweep'

// Endpoint interno para disparar o sweep de retenção (AGM-33).
//
// Auth: header `Authorization: Bearer ${INTERNAL_RETENTION_TOKEN}`. O token
// é provisionado em secrets de prod (AGM-37) e nunca aparece em código.
// Sem token configurado, o endpoint retorna 503 para falhar fechado.
//
// Body (opcional, JSON):
//   { "dryRun": true }   — modo discovery: conta sem mutar.
//
// Resposta: `SweepResult` (ver retention-sweep.ts). 200 sempre que o sweep
// rodou — erros parciais por tabela vêm em `phases[].error` e `totals.errors`.

const log = childLogger({ component: 'lgpd.retention.sweep.api' })

interface SweepRequestBody {
  dryRun?: boolean
}

export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.INTERNAL_RETENTION_TOKEN
  if (!expected) {
    log.error({ event: 'retention.sweep.api.misconfigured' }, 'INTERNAL_RETENTION_TOKEN not set')
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 })
  }

  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!presented || !timingSafeEq(presented, expected)) {
    log.warn({ event: 'retention.sweep.api.denied' }, 'unauthorized sweep call')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: SweepRequestBody = {}
  try {
    const raw = await req.text()
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as unknown
      if (isObject(parsed)) body = parsed as SweepRequestBody
    }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const dryRun = body.dryRun === true
  try {
    const result = await runRetentionSweep({ dryRun, actor: { kind: 'cron:retention_sweep' } })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ event: 'retention.sweep.api.error', err: message }, 'sweep failed catastrophically')
    return NextResponse.json({ error: 'sweep_failed', message }, { status: 500 })
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Comparação de tokens em tempo constante. Evita timing attack discreta na
// validação do bearer.
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
