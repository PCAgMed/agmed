// AGM-24 commit C — endpoint para "entrar" numa clínica nesta sessão.
//
// Contrato:
//  POST /api/session/active-clinic
//  body: { clinicId: string | null }   // null = sair (sem clínica ativa)
//  200 → { activeClinicId: string | null }      // claim gravado no JWT
//  400 → JSON inválido / UUID inválido
//  401 → não autenticado
//  403 → autenticado mas sem membership ativa nessa clínica
//
// Fluxo:
//  1) Auth.
//  2) Valida payload (UUID ou null).
//  3) `null` ⇒ unstable_update({ activeClinicId: null }) e retorna.
//  4) UUID ⇒ `getActiveMembership(userId, clinicId)`:
//     - null ⇒ audit `denied` + 403.
//     - hit  ⇒ unstable_update({ activeClinicId }) + audit `success` + 200.
//
// A revalidação per-request fica em commit D. Aqui o JWT carrega o claim
// "última clínica validada"; o middleware do D vai forçar re-check antes de
// cada query de domínio.
import { NextResponse } from 'next/server'
import { auth, unstable_update } from '@/auth'
import { getActiveMembership } from '@/lib/clinics/membership'
import { recordAudit } from '@/lib/lgpd/audit'
import { generateProtocol } from '@/lib/lgpd/protocol'
import { getClientIp } from '@/lib/rate-limit/client-ip'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const userId = session.user.id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }
  const candidate = (body as { clinicId?: unknown }).clinicId

  const protocol = generateProtocol()
  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent')
  const requestId = req.headers.get('x-request-id')

  if (candidate === null) {
    await unstable_update({ activeClinicId: null })
    await recordAudit({
      actorType: 'professional',
      actorId: userId,
      subjectType: 'professional',
      subjectId: userId,
      action: 'session.clinic.switch',
      outcome: 'success',
      protocol,
      ip,
      userAgent,
      requestId,
      metadata: { from: session.activeClinicId, to: null },
    })
    return NextResponse.json({ activeClinicId: null }, { status: 200 })
  }

  if (typeof candidate !== 'string' || !UUID_RE.test(candidate)) {
    return NextResponse.json(
      { error: 'clinicId deve ser UUID ou null' },
      { status: 400 },
    )
  }

  const membership = await getActiveMembership(userId, candidate)
  if (!membership) {
    await recordAudit({
      actorType: 'professional',
      actorId: userId,
      subjectType: 'professional',
      subjectId: userId,
      action: 'session.clinic.switch',
      outcome: 'denied',
      reason: 'no_active_membership',
      protocol,
      ip,
      userAgent,
      requestId,
      // `to` aqui registra a clínica tentada — ok ser auditado porque o user
      // já se identificou tentando ativar; não é vazamento (caller já sabe).
      metadata: { from: session.activeClinicId, to: candidate },
    })
    return NextResponse.json(
      { error: 'Sem membership ativa nessa clínica' },
      { status: 403 },
    )
  }

  await unstable_update({ activeClinicId: membership.clinicId })
  await recordAudit({
    actorType: 'professional',
    actorId: userId,
    subjectType: 'professional',
    subjectId: userId,
    action: 'session.clinic.switch',
    outcome: 'success',
    protocol,
    ip,
    userAgent,
    requestId,
    metadata: {
      from: session.activeClinicId,
      to: membership.clinicId,
      role: membership.role,
    },
  })
  return NextResponse.json(
    { activeClinicId: membership.clinicId, role: membership.role },
    { status: 200 },
  )
}
