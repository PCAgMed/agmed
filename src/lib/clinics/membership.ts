// AGM-24 commit C — lookup de membership ativa.
//
// **Uso cross-clinic legítimo de `dbUnscopedDangerous`**: para validar que
// um usuário pode "entrar" numa clínica, ainda não há tenant ativo — a
// validação É a etapa que estabelece o contexto. Usar `withClinicScope` aqui
// seria circular (precisaria do clinicId pra setar o app.clinic_id pra então
// consultar o membership, mas a policy `tenant_isolation` em
// clinic_memberships só enxergaria a linha se já estivesse no escopo certo).
//
// Como `clinic_memberships` é tabela de controle de acesso, ela roda como
// `agenda_owner` (não recebe policy de tenant). Lookup direto é seguro.
import { dbUnscopedDangerous } from '@/lib/db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MembershipRole = 'owner' | 'admin' | 'receptionist' | 'doctor'

export type ActiveMembership = {
  membershipId: string
  userId: string
  clinicId: string
  role: MembershipRole
}

/**
 * Retorna a membership ativa de `userId` em `clinicId`, ou `null` se não
 * houver. "Ativa" = `status = 'active' AND revoked_at IS NULL`.
 *
 * Esta é a função autorizativa do switch de clínica: o endpoint
 * `POST /api/session/active-clinic` chama isto antes de gravar o claim no JWT.
 * O middleware do commit D vai chamar isto novamente per-request para revalidar.
 *
 * Retorno `null` ⇒ negar o acesso. Não logar PII aqui — caller emite audit
 * com `outcome: 'denied'` se quiser.
 */
export async function getActiveMembership(
  userId: string,
  clinicId: string,
): Promise<ActiveMembership | null> {
  if (typeof userId !== 'string' || userId.length === 0) return null
  if (typeof clinicId !== 'string' || !UUID_RE.test(clinicId)) return null

  const pool = dbUnscopedDangerous()
  const result = await pool.query<{
    id: string
    user_id: string
    clinic_id: string
    role: MembershipRole
  }>(
    `SELECT id, user_id, clinic_id, role
     FROM clinic_memberships
     WHERE user_id = $1
       AND clinic_id = $2
       AND status = 'active'
       AND revoked_at IS NULL
     LIMIT 1`,
    [userId, clinicId],
  )

  const row = result.rows[0]
  if (!row) return null
  return {
    membershipId: row.id,
    userId: row.user_id,
    clinicId: row.clinic_id,
    role: row.role,
  }
}
