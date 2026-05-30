import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compareSync } from 'bcryptjs'
// AGM-24: o lookup por e-mail no login é cross-clinic — não temos clínica
// ativa ANTES de autenticar. Uso legítimo de `dbUnscopedDangerous`. A clínica
// ativa é resolvida depois pelo middleware do commit D, a partir das
// memberships do usuário; o claim no JWT é populado pelo endpoint
// `POST /api/session/active-clinic` (commit C).
import { dbUnscopedDangerous } from '@/lib/db'
import { authConfig } from './auth.config'
import { getActiveMembership } from '@/lib/clinics/membership'
import { emailDomain, logAuthEvent } from '@/lib/observability/auth-events'

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string
        const password = credentials?.password as string
        if (!email || !password) {
          logAuthEvent({ event: 'auth.signin.failure', reason: 'missing_credentials' })
          return null
        }

        const domain = emailDomain(email)
        logAuthEvent({ event: 'auth.signin.attempt', emailDomain: domain })

        const pool = dbUnscopedDangerous()
        const result = await pool.query<{
          id: string
          name: string | null
          email: string
          password: string
        }>('SELECT id, name, email, password FROM users WHERE email = $1', [email.toLowerCase()])

        const user = result.rows[0]
        if (!user?.password) {
          logAuthEvent({
            event: 'auth.signin.failure',
            emailDomain: domain,
            reason: 'user_not_found',
          })
          return null
        }

        const valid = compareSync(password, user.password)
        if (!valid) {
          logAuthEvent({
            event: 'auth.signin.failure',
            emailDomain: domain,
            userId: user.id,
            reason: 'bad_password',
          })
          return null
        }

        logAuthEvent({
          event: 'auth.signin.success',
          emailDomain: domain,
          userId: user.id,
        })
        return { id: user.id, name: user.name, email: user.email }
      },
    }),
  ],
  events: {
    async signOut(message) {
      const userId =
        'token' in message && message.token && typeof message.token.id === 'string'
          ? message.token.id
          : undefined
      logAuthEvent({ event: 'auth.signout', userId })
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session }) {
      // 1) Sign-in: copia id do usuário pro token. activeClinicId começa null
      //    e fica null até o cliente chamar `/api/session/active-clinic`.
      if (user) {
        token.id = user.id
        token.activeClinicId = null
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
          const membership = await getActiveMembership(token.id, candidate)
          if (membership) {
            token.activeClinicId = membership.clinicId
          }
          // Membership inválida ⇒ silently drop. Endpoint já fez o check
          // explícito e respondeu 403; este caminho só protege contra abuso.
        }
      }
      return token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      session.activeClinicId =
        typeof token.activeClinicId === 'string' ? token.activeClinicId : null
      return session
    },
  },
})
