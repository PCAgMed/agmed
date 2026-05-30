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
import { revokeSessionByJti } from '@/lib/auth/sessions'
import { emailDomain, logAuthEvent } from '@/lib/observability/auth-events'
import { childLogger } from '@/lib/observability/logger'

const authLog = childLogger({ component: 'auth' })

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
      const tokenJwt =
        'token' in message && message.token && typeof message.token === 'object'
          ? (message.token as { id?: unknown; jti?: unknown })
          : undefined
      const userId =
        tokenJwt && typeof tokenJwt.id === 'string' ? tokenJwt.id : undefined
      const jti = tokenJwt && typeof tokenJwt.jti === 'string' ? tokenJwt.jti : undefined
      logAuthEvent({ event: 'auth.signout', userId })

      // AGM-24 commit D — revoga a linha em `user_sessions` para que o
      // próximo request com este JWT (caso vaze) seja invalidado pelo
      // middleware. Erro de DB não derruba o logout (cookie já vai sair);
      // apenas registramos pra forense — a sessão expirará em 15min de
      // qualquer forma.
      if (jti) {
        try {
          await revokeSessionByJti(jti, 'logout')
        } catch (err) {
          authLog.warn(
            { event: 'auth.signout.revoke_failed', err, userId },
            'failed to revoke user_session row on signout; JWT cookie cleared regardless',
          )
        }
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    jwt: async (args) => {
      const out = await jwtCallback(args as unknown as JwtCallbackArgs)
      return out as typeof args.token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      session.activeClinicId =
        typeof token.activeClinicId === 'string' ? token.activeClinicId : null
      // jti vai pro session pra que o middleware Edge possa propagá-lo no
      // call interno ao /api/internal/tenant-check sem precisar decodificar
      // o JWT bruto novamente.
      session.jti = typeof token.jti === 'string' ? token.jti : null
      return session
    },
  },
})
