import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { recordAudit } from '@/lib/lgpd/audit'
import { listConsents, revokeConsent, type ConsentKind } from '@/lib/lgpd/consents'
import { generateProtocol } from '@/lib/lgpd/protocol'
import {
  getProfessionalProfile,
  requestProfessionalDeletion,
} from '@/lib/lgpd/professional'
import { enforceLgpdRateLimit } from '@/lib/lgpd/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Art. 18 VI — eliminação de dados pessoais tratados com consentimento.
// Importante: dados sob base legal "execução de contrato" (cadastro ativo)
// só são eliminados após o cancelamento do contrato, com janela de 30 dias
// (baseline §2). Dados sob obrigação legal/regulatória (futuro: prontuário
// 20 anos via AGM-33) são RECUSADOS com resposta fundamentada — quando o
// retention_class entrar no schema, o cálculo passa a ser por classe; hoje
// a recusa é categórica para os módulos ainda não implementados.
//
// Body opcional: { scope: 'all' | 'consents_only' }. Default 'all'.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id
  const blocked = enforceLgpdRateLimit(req, userId, '/api/me/data/delete', 'heavy')
  if (blocked) return blocked

  let body: { scope?: string; confirm?: string } = {}
  try {
    if (req.headers.get('content-length') !== '0') {
      body = (await req.json()) as typeof body
    }
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const scope = body.scope === 'consents_only' ? 'consents_only' : 'all'
  // Confirmação dupla é exigida em produção pela UI; o backend também valida
  // para impedir click-through de um cliente desatualizado.
  if (scope === 'all' && body.confirm !== 'ELIMINAR') {
    return NextResponse.json(
      {
        error:
          'Confirmação ausente. Para eliminar a conta, envie {"scope":"all","confirm":"ELIMINAR"}.',
      },
      { status: 400 },
    )
  }

  const protocol = generateProtocol()
  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent')
  const requestId = req.headers.get('x-request-id')

  const profile = await getProfessionalProfile(userId)
  if (!profile) {
    await recordAudit({
      actorType: 'professional',
      actorId: userId,
      subjectType: 'professional',
      subjectId: userId,
      action: 'rights.delete',
      outcome: 'error',
      reason: 'subject_not_found',
      protocol,
      ip,
      userAgent,
      requestId,
    })
    return NextResponse.json({ error: 'Dados não encontrados' }, { status: 404 })
  }

  // 1) Revogar todos os consentimentos ativos (base "consentimento" sempre cai).
  const consents = await listConsents('professional', userId)
  const revoked: ConsentKind[] = []
  for (const c of consents) {
    if (c.revokedAt) continue
    const result = await revokeConsent('professional', userId, c.kind)
    if (result.changed) revoked.push(c.kind)
  }

  let scheduledFor: Date | null = null
  if (scope === 'all') {
    // 2) Marcar a conta para eliminação. O hard-delete em si será executado
    // pelo job da AGM-33 (30 dias). Idempotente.
    const requestedAt = await requestProfessionalDeletion(userId)
    scheduledFor = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
  }

  await recordAudit({
    actorType: 'professional',
    actorId: userId,
    subjectType: 'professional',
    subjectId: userId,
    action: 'rights.delete',
    outcome: 'success',
    protocol,
    ip,
    userAgent,
    requestId,
    metadata: {
      scope,
      revokedConsents: revoked,
      scheduledFor: scheduledFor?.toISOString() ?? null,
    },
  })

  return NextResponse.json(
    {
      protocol,
      receipt: {
        scope,
        eliminated: {
          consents: revoked,
        },
        scheduled:
          scope === 'all'
            ? {
                accountDeletionRequestedAt: new Date().toISOString(),
                accountHardDeleteAt: scheduledFor?.toISOString() ?? null,
                rationale:
                  'Conta de profissional é mantida por 30 dias (baseline LGPD §2) para reversão e prescrição de obrigações contratuais residuais. Após esse período, eliminação programática.',
              }
            : null,
        retainedUnderLegalObligation: [
          // Quando AGM-33 entrar com retention_class, esta lista é gerada por
          // classe. Hoje só registramos o que existe (audit_log) e que NÃO é
          // dado pessoal do titular no sentido do Art. 5º — é rastro
          // operatório do operador, retido por 10 anos.
          {
            category: 'audit_log',
            base: 'Art. 7º II LGPD (cumprimento de obrigação legal de prestação de contas)',
            retention: '10 anos',
          },
        ],
      },
    },
    { status: 200 },
  )
}
