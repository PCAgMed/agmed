import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLegalPagesEnabled } from '@/lib/legal/feature-flag'

// Avalia o flag a cada request. Sem isso o Next renderiza as páginas
// estáticas no build com `process.env.LEGAL_PAGES_ENABLED` indefinido e
// "congela" o 404 — flipar a env var depois não destravaria as rotas.
export const dynamic = 'force-dynamic'

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  if (!isLegalPagesEnabled()) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-200 bg-gray-50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-sm font-semibold text-gray-900 hover:text-gray-700">
            Clínica Agenda
          </Link>
          <nav aria-label="Documentos legais" className="flex gap-4 text-sm">
            <Link href="/legal/privacidade" className="text-gray-600 hover:text-gray-900">
              Privacidade
            </Link>
            <Link
              href="/legal/subprocessadores"
              className="text-gray-600 hover:text-gray-900"
            >
              Subprocessadores
            </Link>
            <Link href="/legal/termos" className="text-gray-600 hover:text-gray-900">
              Termos
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">{children}</main>
      <footer className="mt-16 border-t border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-3xl px-6 py-6 text-xs text-gray-500">
          <p>
            Em caso de dúvida ou para exercer um direito previsto na LGPD, fale com nosso
            Encarregado pelo e-mail{' '}
            <a
              href="mailto:dpo@clinica-agenda.com.br"
              className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
            >
              dpo@clinica-agenda.com.br
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  )
}
