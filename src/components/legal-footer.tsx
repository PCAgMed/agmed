import Link from 'next/link'
import { isLegalPagesEnabled } from '@/lib/legal/feature-flag'

// Footer global com links para as páginas legais públicas. Só renderiza
// quando o feature flag está ligado — assim nunca aponta para uma rota que
// retornaria 404.

export function LegalFooter() {
  if (!isLegalPagesEnabled()) return null

  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-4 text-xs text-gray-500 sm:flex-row">
        <p>© {new Date().getFullYear()} Clínica Agenda</p>
        <nav aria-label="Documentos legais" className="flex gap-4">
          <Link href="/legal/privacidade" className="hover:text-gray-900">
            Privacidade
          </Link>
          <Link href="/legal/subprocessadores" className="hover:text-gray-900">
            Subprocessadores
          </Link>
          <Link href="/legal/termos" className="hover:text-gray-900">
            Termos
          </Link>
        </nav>
      </div>
    </footer>
  )
}
