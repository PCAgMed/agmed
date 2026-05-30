import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { recordAudit } from '@/lib/lgpd/audit'
import { generateProtocol } from '@/lib/lgpd/protocol'
import {
  type ProfessionalProfilePatch,
  updateProfessionalProfile,
} from '@/lib/lgpd/professional'
import { enforceLgpdRateLimit } from '@/lib/lgpd/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

const NAME_MAX = 200
const IMAGE_MAX = 2048

// Art. 18 III — correção de dados incompletos, inexatos ou desatualizados.
// Allowlist de campos editáveis para não permitir que o endpoint vire vetor
// de escrita em outras colunas (ex.: emailVerified, password).
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id
  const blocked = enforceLgpdRateLimit(req, userId, '/api/me/profile', 'mutate')
  if (blocked) return blocked

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const patch: ProfessionalProfilePatch = {}
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const value = body.name
    if (value === null) {
      patch.name = null
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
        return NextResponse.json(
          { error: `name deve ter entre 1 e ${NAME_MAX} caracteres` },
          { status: 400 },
        )
      }
      patch.name = trimmed
    } else {
      return NextResponse.json({ error: 'name deve ser string ou null' }, { status: 400 })
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'image')) {
    const value = body.image
    if (value === null) {
      patch.image = null
    } else if (typeof value === 'string') {
      if (value.length > IMAGE_MAX) {
        return NextResponse.json({ error: 'image excede tamanho máximo' }, { status: 400 })
      }
      patch.image = value
    } else {
      return NextResponse.json({ error: 'image deve ser string ou null' }, { status: 400 })
    }
  }

  const protocol = generateProtocol()
  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent')
  const requestId = req.headers.get('x-request-id')

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Nenhum campo editável fornecido. Campos permitidos: name, image.' },
      { status: 400 },
    )
  }

  const updated = await updateProfessionalProfile(userId, patch)
  if (!updated) {
    await recordAudit({
      actorType: 'professional',
      actorId: userId,
      subjectType: 'professional',
      subjectId: userId,
      action: 'rights.profile.update',
      outcome: 'error',
      reason: 'subject_not_found',
      protocol,
      ip,
      userAgent,
      requestId,
      metadata: { fields: Object.keys(patch) },
    })
    return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  }

  await recordAudit({
    actorType: 'professional',
    actorId: userId,
    subjectType: 'professional',
    subjectId: userId,
    action: 'rights.profile.update',
    outcome: 'success',
    protocol,
    ip,
    userAgent,
    requestId,
    metadata: { fields: Object.keys(patch) },
  })

  return NextResponse.json({ protocol, profile: updated }, { status: 200 })
}
