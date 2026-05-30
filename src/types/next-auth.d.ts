// AGM-24 commit C/D — Estende Session/JWT do NextAuth com clinic context
// e session revocation tracking.
//
// `activeClinicId` é o tenant ativo desta sessão. É `null` logo após signup/login
// (usuário ainda não escolheu clínica) e é populado pelo endpoint
// `POST /api/session/active-clinic` após validar membership.
//
// `jti` é o identificador único da sessão na tabela `user_sessions`. O
// middleware Edge propaga este valor para `/api/internal/tenant-check`, que
// confirma que a sessão segue ativa (não revogada, não expirada) a cada
// request. Sem `jti` ⇒ middleware termina a sessão.
//
// Nunca confiar nesta claim para autorização sem revalidação — o middleware
// do commit D verifica membership a cada request. Aqui só carregamos o valor.
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    activeClinicId: string | null
    jti: string | null
    user: {
      id: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    activeClinicId?: string | null
    jti?: string | null
  }
}
