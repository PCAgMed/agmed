import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compareSync } from 'bcryptjs'
import { getPool } from '@/lib/db'
import { authConfig } from './auth.config'

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
        if (!email || !password) return null

        const pool = getPool()
        const result = await pool.query<{
          id: string
          name: string | null
          email: string
          password: string
        }>('SELECT id, name, email, password FROM users WHERE email = $1', [email.toLowerCase()])

        const user = result.rows[0]
        if (!user?.password) return null

        const valid = compareSync(password, user.password)
        if (!valid) return null

        return { id: user.id, name: user.name, email: user.email }
      },
    }),
  ],
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
