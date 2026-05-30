import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { recordAudit } from '@/lib/lgpd/audit'
import { generateProtocol } from '@/lib/lgpd/protocol'
import { enforceLgpdRateLimit } from '@/lib/lgpd/rate-limit'
import { SUBPROCESSORS, SUBPROCESSORS_VERSION } from '@/lib/lgpd/subprocessors'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Art. 18 VII — informação sobre entidades públicas e privadas com as quais o
// controlador realizou uso compartilhado. Lista pública (mesma fonte da página
// /legal/subprocessadores) servida atrás de auth para fins de auditoria por
// titular, e com rate-limit baixo porque é leitura barata.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id
  const blocked = enforceLgpdRateLimit(req, userId, '/api/me/data/subprocessors', 'read')
  if (blocked) return blocked

  const protocol = generateProtocol()
  await recordAudit({
    actorType: 'professional',
    actorId: userId,
    subjectType: 'professional',
    subjectId: userId,
    action: 'rights.subprocessors.read',
    outcome: 'success',
    protocol,
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    requestId: req.headers.get('x-request-id'),
  })

  return NextResponse.json(
    {
      protocol,
      version: SUBPROCESSORS_VERSION,
      subprocessors: SUBPROCESSORS,
    },
    { status: 200 },
  )
}
