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
import { jwtCallback, type JwtCallbackArgs } from '@/lib/auth/jwt-callback'
import { emailDomain, logAuthEvent } from '@/lib/observability/auth-events'

// TODO(next-auth-upgrade): `unstable_update` é prefixado `unstable_` por
// design da lib. Cada upgrade de next-auth (5.x → 6.x ou minor instável)
// pode renomeá-la ou mudar o contrato sem aviso. Re-validar:
//   1. Ainda existe em `next-auth`?
//   2. Assinatura `(partialSession) => Promise<Session | null>` se manteve?
//   3. O callback `jwt({ trigger: 'update', session })` ainda recebe o
//      payload que passamos aqui?
// Findings LOW-2 do audit SE em [AGM-36](/AGM/issues/AGM-36).
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
    jwt: (args) => jwtCallback(args as JwtCallbackArgs),
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      session.activeClinicId =
        typeof token.activeClinicId === 'string' ? token.activeClinicId : null
      return session
    },
  },
})
