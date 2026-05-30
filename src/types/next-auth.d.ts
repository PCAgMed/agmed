// AGM-24 commit C — Estende Session/JWT do NextAuth com clinic context.
//
// `activeClinicId` é o tenant ativo desta sessão. É `null` logo após signup/login
// (usuário ainda não escolheu clínica) e é populado pelo endpoint
// `POST /api/session/active-clinic` após validar membership.
//
// Nunca confiar nesta claim para autorização sem revalidação — o middleware do
// commit D vai verificar membership a cada request. Aqui só carregamos o valor.
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    activeClinicId: string | null
    user: {
      id: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    activeClinicId?: string | null
  }
}
