import type { NextAuthConfig } from 'next-auth'

const PUBLIC_PATHS = ['/login', '/signup', '/verify-email']

// Edge-safe config used by middleware (no Node.js-only imports)
export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isPublicPath = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p))

      if (isLoggedIn && isPublicPath) {
        return Response.redirect(new URL('/dashboard', nextUrl))
      }
      if (!isLoggedIn && !isPublicPath) return false
      return true
    },
  },
}
