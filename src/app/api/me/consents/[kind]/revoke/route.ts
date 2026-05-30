import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { recordAudit } from '@/lib/lgpd/audit'
import { CONSENT_KINDS, isConsentKind, revokeConsent } from '@/lib/lgpd/consents'
import { generateProtocol } from '@/lib/lgpd/protocol'
import { enforceLgpdRateLimit } from '@/lib/lgpd/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Art. 18 IX — revogação de consentimento. SLA: imediato (baseline §3.2).
// Idempotente: revogar algo já revogado retorna sucesso com `changed=false`.
export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id
  const { kind } = await ctx.params
  const blocked = enforceLgpdRateLimit(
    req,
    userId,
    '/api/me/consents/[kind]/revoke',
    'mutate',
  )
  if (blocked) return blocked

  if (!isConsentKind(kind)) {
    return NextResponse.json(
      {
        error: `kind desconhecido. Valores aceitos: ${CONSENT_KINDS.join(', ')}`,
      },
      { status: 400 },
    )
  }

  const protocol = generateProtocol()
  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent')
  const requestId = req.headers.get('x-request-id')

  const result = await revokeConsent('professional', userId, kind)

  await recordAudit({
    actorType: 'professional',
    actorId: userId,
    subjectType: 'professional',
    subjectId: userId,
    action: 'rights.consent.revoke',
    outcome: 'success',
    protocol,
    ip,
    userAgent,
    requestId,
    metadata: { kind, changed: result.changed, hadConsent: result.record !== null },
  })

  return NextResponse.json(
    {
      protocol,
      receipt: {
        kind,
        changed: result.changed,
        revokedAt: result.record?.revokedAt?.toISOString() ?? new Date().toISOString(),
        hadConsent: result.record !== null,
      },
    },
    { status: 200 },
  )
}
