// AGM-24 commit D — callback `jwt` extraído pra ser unit-testável fora do
// runtime do NextAuth. LOW-1 do audit SE em [AGM-36](/AGM/issues/AGM-36).
//
// O callback original vivia inline em `src/auth.ts`. Importar `@/auth` no
// teste puxa o runtime do NextAuth (que importa `next/server`) — quebra em
// vitest sem ambiente Next.js. Aqui ficamos só com a lógica + injeções
// (`lookup`, `createSession`) pra testabilidade direta.
import { getActiveMembership } from '@/lib/clinics/membership'
import { createSession } from '@/lib/auth/sessions'

export type JwtCallbackArgs = {
  token: Record<string, unknown> & { id?: unknown; jti?: unknown; activeClinicId?: unknown }
  user?: { id?: string } | null
  trigger?: 'signIn' | 'signUp' | 'update' | string
  session?: unknown
}

export type JwtCallbackDeps = {
  lookupMembership?: typeof getActiveMembership
  createSession?: typeof createSession
}

export async function jwtCallback(
  args: JwtCallbackArgs,
  deps: JwtCallbackDeps = {},
): Promise<JwtCallbackArgs['token']> {
  const { token, user, trigger, session } = args
  const lookup = deps.lookupMembership ?? getActiveMembership
  const createSess = deps.createSession ?? createSession

  // 1) Sign-in: copia id do usuário pro token, gera `jti`, grava linha em
  //    `user_sessions` para suportar revogação. `activeClinicId` começa
  //    null e fica null até o cliente chamar `/api/session/active-clinic`.
  if (user && user.id) {
    token.id = user.id
    token.activeClinicId = null
    const created = await createSess({ userId: user.id })
    token.jti = created.jti
  }
  // 2) Update trigger: o endpoint chamou `unstable_update({ activeClinicId })`.
  //    Defesa em profundidade — revalida a membership ANTES de gravar o
  //    claim, mesmo que o endpoint já tenha validado. Cobre o caso de o
  //    membership ter sido revogado entre a validação do endpoint e o
  //    re-emit do JWT, e cobre qualquer caller que pule o endpoint e
  //    chame `update()` direto do client.
  if (trigger === 'update' && session && typeof session === 'object') {
    const candidate = (session as { activeClinicId?: unknown }).activeClinicId
    if (candidate === null) {
      token.activeClinicId = null
    } else if (typeof candidate === 'string' && typeof token.id === 'string') {
      const membership = await lookup(token.id, candidate)
      if (membership) {
        token.activeClinicId = membership.clinicId
      }
      // Membership inválida ⇒ silently drop. Endpoint já fez o check
      // explícito e respondeu 403; este caminho só protege contra abuso.
    }
  }
  return token
}
