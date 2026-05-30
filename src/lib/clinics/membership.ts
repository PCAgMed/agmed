// AGM-24 commit C/D — lookup de membership ativa.
//
// Runs inside `withClinicScope(candidateClinicId, ...)`. Why this works even
// though we're about to *establish* the tenant context:
//
//   1. The RLS policy on `clinic_memberships` (migration 0005) is
//      `WHERE clinic_id = current_setting('app.clinic_id')::uuid`.
//   2. We set `app.clinic_id = candidate` and query
//      `WHERE user_id = $userId AND clinic_id = $candidate`.
//   3. If the user has a row for that clinic → it's visible → switch allowed.
//   4. If not → query returns 0 rows → switch denied.
//
// There's no circularity: `app.clinic_id` is acting as a query parameter,
// not as an access token. The membership row is the *proof* that the user
// belongs to `candidate`; the policy only narrows the visible set, our query
// asks the precise yes/no question.
//
// Critically, this survives [AGM-60](role hardening) — when the runtime role
// becomes NOBYPASSRLS for app routes, `dbUnscopedDangerous()` would
// return 0 rows for any `clinic_memberships` lookup (RLS would filter
// everything out without `app.clinic_id` set). Using `withClinicScope` here
// keeps the lookup correct in both pre- and post-AGM-60 worlds.
//
// SecurityEngineer audit (commit C, [AGM-36](/AGM/issues/AGM-36)) — LOW-3 fix.
import { withClinicScope, ClinicScopeError } from '@/lib/db'

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
 * Esta é a função autorizativa do switch de clínica e a base da revalidação
 * per-request (commit D). Retorno `null` ⇒ negar o acesso. Não logar PII
 * aqui — caller emite audit com `outcome: 'denied'` se quiser.
 */
export async function getActiveMembership(
  userId: string,
  clinicId: string,
): Promise<ActiveMembership | null> {
  if (typeof userId !== 'string' || userId.length === 0) return null
  if (typeof clinicId !== 'string' || !UUID_RE.test(clinicId)) return null

  try {
    return await withClinicScope(clinicId, async (tx) => {
      const result = await tx.query<{
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
    })
  } catch (err) {
    // UUID já foi validado acima; ClinicScopeError aqui seria bug interno —
    // failure-closed.
    if (err instanceof ClinicScopeError) return null
    throw err
  }
}
