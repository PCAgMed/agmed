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
      if (!isLoggedIn && !isPublicPath) {
        // For API routes, return a JSON 401 instead of bouncing to /login —
        // fetch() callers (PrivacyPanel etc.) need a parseable status code,
        // not an HTML redirect target.
        if (nextUrl.pathname.startsWith('/api/')) {
          return Response.json(
            { error: 'Não autenticado' },
            { status: 401, headers: { 'cache-control': 'no-store' } },
          )
        }
        return false
      }
      return true
    },
  },
}
