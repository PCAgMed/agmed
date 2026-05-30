import type { Metadata } from 'next'
import Link from 'next/link'
import { TERMS_LAST_UPDATED, TERMS_VERSION } from '@/lib/legal/version-history'

export const metadata: Metadata = {
  title: 'Termos de Uso — Clínica Agenda',
  description: 'Termos de uso do serviço Clínica Agenda. Em construção.',
  robots: { index: true, follow: true },
}

export default function TermosPage() {
  return (
    <article className="flex flex-col gap-6 leading-relaxed">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Documento legal
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Termos de Uso</h1>
        <p className="text-sm text-gray-600">
          Versão {TERMS_VERSION} ·{' '}
          {new Date(TERMS_LAST_UPDATED).toLocaleDateString('pt-BR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          })}
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Em construção</p>
        <p>
          Estamos finalizando o texto dos Termos de Uso. Esta rota está reservada e ficará
          publicada com o conteúdo definitivo antes da abertura do serviço ao público.
        </p>
        <p>
          Para informações sobre tratamento de dados pessoais, consulte o{' '}
          <Link
            href="/legal/privacidade"
            className="font-medium underline underline-offset-2 hover:text-amber-700"
          >
            Aviso de Privacidade
          </Link>
          .
        </p>
      </section>
    </article>
  )
}
