import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { recordAudit } from '@/lib/lgpd/audit'
import { generateProtocol } from '@/lib/lgpd/protocol'
import { buildProfessionalDataPackage } from '@/lib/lgpd/professional'
import { enforceLgpdRateLimit } from '@/lib/lgpd/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Art. 18 I + II — confirmação de existência e acesso. Retorna o mesmo schema
// versionado usado pelo /export, mas via GET para que a tela "Minha
// privacidade" consiga renderizar sem trigger pesada de portabilidade.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id
  const blocked = enforceLgpdRateLimit(req, userId, '/api/me/data', 'read')
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
      action: 'rights.access',
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
    action: 'rights.access',
    outcome: 'success',
    protocol,
    ip,
    userAgent,
    requestId,
  })

  return NextResponse.json({ protocol, data }, { status: 200 })
}
