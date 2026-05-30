// AGM-24 commit D — endpoint interno chamado pelo middleware Edge a cada
// request autenticada. Roda no runtime Node (não Edge) porque precisa de
// `pg` para consultar `user_sessions` e `clinic_memberships`.
//
// Contrato:
//  POST /api/internal/tenant-check
//  headers:
//    content-type: application/json
//    x-internal-call: 1   (set pelo middleware; protege contra hit casual)
//  body: { userId: string, jti: string, activeClinicId: string | null }
//
//  200 → { ok: true }                                  // sessão e tenant válidos
//  401 → { ok: false, reason: 'session_revoked_or_expired' }
//  403 → { ok: false, reason: 'membership_revoked' }
//  400 → { ok: false, reason: 'invalid_input' }
//
// Auditoria: 401/403 viram `audit_log` com `action='session.tenant.revalidate'`
// `outcome='denied'`. Alerta Loki/Grafana ([AGM-8](/AGM/issues/AGM-8))
// pode disparar em volume anormal — sinaliza tentativa de uso de sessão
// revogada ou cross-tenant.
//
// Não há rate-limit aqui: middleware é o único caller esperado e ele
// fetcha 1x por request. Header `x-internal-call` é check de sanidade, não
// authn — não vaza nada sensível pra quem hitar sem o header (todos os
// branches retornam 400/401/403 com mensagem genérica).
//
// **Não exportamos `runtime = 'edge'`** — propositalmente Node.
import { NextResponse } from 'next/server'
import { revalidateTenant } from '@/lib/http/tenant-revalidation'
import { recordAudit } from '@/lib/lgpd/audit'
import { generateProtocol } from '@/lib/lgpd/protocol'
import { getClientIp } from '@/lib/rate-limit/client-ip'
import { childLogger } from '@/lib/observability/logger'

const log = childLogger({ component: 'tenant-check' })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Body = {
  userId?: unknown
  jti?: unknown
  activeClinicId?: unknown
}

function statusForReason(
  reason: 'session_revoked_or_expired' | 'membership_revoked' | 'invalid_input',
): 401 | 403 | 400 {
  if (reason === 'invalid_input') return 400
  if (reason === 'session_revoked_or_expired') return 401
  return 403
}

export async function POST(req: Request) {
  // Header guard — sem isso, o handler retorna 400 com mensagem genérica.
  // Middleware sempre seta este header; quem chama sem ele de fora vai
  // bater no 400 mesmo antes de qualquer logica de DB.
  if (req.headers.get('x-internal-call') !== '1') {
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 })
  }

  const userId = typeof body.userId === 'string' ? body.userId : ''
  const jti = typeof body.jti === 'string' ? body.jti : ''
  const activeClinicId =
    body.activeClinicId === null
      ? null
      : typeof body.activeClinicId === 'string' && UUID_RE.test(body.activeClinicId)
        ? body.activeClinicId
        : undefined

  if (!userId || !jti || activeClinicId === undefined) {
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 })
  }

  const outcome = await revalidateTenant({ userId, jti, activeClinicId })
  if (outcome.ok) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Caminho denied — audit. Reason vira metadata estruturada pra alerta
  // diferenciar "session expirou" (normal, alta volumetria) de "membership
  // revogada" (alta severidade, indica suspensão de acesso). Sem PII —
  // userId + clinicId são UUIDs.
  try {
    await recordAudit({
      actorType: 'professional',
      actorId: userId,
      subjectType: 'professional',
      subjectId: userId,
      action: 'session.tenant.revalidate',
      outcome: 'denied',
      reason: outcome.reason,
      protocol: generateProtocol(),
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
      requestId: req.headers.get('x-request-id'),
      metadata: {
        jti,
        attemptedClinicId: activeClinicId,
      },
    })
  } catch (err) {
    log.warn(
      { event: 'tenant_check.audit.failed', err, userId, reason: outcome.reason },
      'failed to record tenant-revalidate audit event; denying anyway',
    )
  }

  const status = statusForReason(outcome.reason)
  return NextResponse.json({ ok: false, reason: outcome.reason }, { status })
}
