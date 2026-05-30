import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { recordAudit } from '@/lib/lgpd/audit'
import { generateProtocol } from '@/lib/lgpd/protocol'
import { buildProfessionalDataPackage } from '@/lib/lgpd/professional'
import { enforceLgpdRateLimit } from '@/lib/lgpd/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Art. 18 V — portabilidade. Retorna um JSON com schema versionado
// (`clinica-agenda.lgpd.export.v1`) e Content-Disposition para download direto
// pelo navegador. SLA: 30 dias (baseline §3.2); o produto entrega imediato.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id
  const blocked = enforceLgpdRateLimit(req, userId, '/api/me/data/export', 'heavy')
  if (blocked) return blocked

  const protocol = generateProtocol()
  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent')
  const requestId = req.headers.get('x-request-id')

  const data = await buildProfessionalDataPackage(userId)
  if (!data) {
    await recordAudit({
      actorType: 'professional',
      actorId: userId,
      subjectType: 'professional',
      subjectId: userId,
      action: 'rights.export',
      outcome: 'error',
      reason: 'subject_not_found',
      protocol,
      ip,
      userAgent,
      requestId,
    })
    return NextResponse.json({ error: 'Dados não encontrados' }, { status: 404 })
  }

  await recordAudit({
    actorType: 'professional',
    actorId: userId,
    subjectType: 'professional',
    subjectId: userId,
    action: 'rights.export',
    outcome: 'success',
    protocol,
    ip,
    userAgent,
    requestId,
  })

  const payload = { protocol, data }
  const body = JSON.stringify(payload, null, 2)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="clinica-agenda-export-${protocol}.json"`,
      'X-LGPD-Protocol': protocol,
    },
  })
}
