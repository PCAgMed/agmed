// Páginas legais públicas ficam atrás de flag até o CEO aprovar o conteúdo
// (idealmente após revisão por jurídico externo). Default fechado: publicar
// texto não-revisado seria pior do que não publicar.
//
// Server-only — não exponho via NEXT_PUBLIC_* para que ninguém ative pela
// camada cliente acidentalmente. CEO setando a env var no host = único toggle.
//
// Comportamento de toggle:
//   - Rotas /legal/* são renderizadas dinamicamente (force-dynamic no layout),
//     então o flag é avaliado a cada request — flipar a env var no host e
//     reiniciar o processo basta para destravar as páginas.
//   - Footer global (LegalFooter) é renderizado por páginas estáticas como
//     /login e /signup, que são prerendered no build. Para os links aparecerem
//     no footer dessas páginas, é preciso refazer o build/deploy.

export function isLegalPagesEnabled(): boolean {
  return process.env.LEGAL_PAGES_ENABLED === 'true'
}
