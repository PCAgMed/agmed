import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compareSync } from 'bcryptjs'
import { getPool } from '@/lib/db'
import { authConfig } from './auth.config'
import { emailDomain, logAuthEvent } from '@/lib/observability/auth-events'

export const { handlers, signIn, signOut, auth } = NextAuth({
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

        const pool = getPool()
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
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      return session
    },
  },
})
