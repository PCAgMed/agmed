import type { Metadata } from 'next'
import Link from 'next/link'
import { SUBPROCESSORS, SUBPROCESSORS_VERSION } from '@/lib/lgpd/subprocessors'

export const metadata: Metadata = {
  title: 'Subprocessadores — Clínica Agenda',
  description:
    'Lista de subprocessadores que tratam dados pessoais em nome da Clínica Agenda. Atualizada com notificação prévia de 30 dias.',
  robots: { index: true, follow: true },
}

const FORMATTED_LAST_UPDATED = new Date(SUBPROCESSORS_VERSION).toLocaleDateString('pt-BR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

export default function SubprocessadoresPage() {
  return (
    <article className="flex flex-col gap-8 leading-relaxed">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Documento legal
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Subprocessadores</h1>
        <p className="text-sm text-gray-600">
          Atualizado em {FORMATTED_LAST_UPDATED}
        </p>
      </header>

      <section aria-labelledby="o-que-e" className="flex flex-col gap-3">
        <h2 id="o-que-e" className="text-xl font-semibold text-gray-900">
          O que é um subprocessador
        </h2>
        <p>
          Para operar o serviço, a Clínica Agenda contrata fornecedores que processam dados
          pessoais em nosso nome — esses fornecedores são chamados de{' '}
          <strong>subprocessadores</strong>. Cada um é selecionado por critérios técnicos e
          jurídicos, opera sob contrato (DPA) que reproduz nossos compromissos de
          confidencialidade, segurança e exercício de direitos do titular, e é submetido a
          revisão periódica.
        </p>
      </section>

      <section aria-labelledby="lista" className="flex flex-col gap-3">
        <h2 id="lista" className="text-xl font-semibold text-gray-900">
          Lista atual
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 bg-gray-50 text-left">
                <th scope="col" className="px-3 py-2 font-semibold">
                  Subprocessador
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Finalidade
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Categorias de dado
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  País
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((sp) => (
                <tr key={sp.name} className="border-b border-gray-200 align-top">
                  <td className="px-3 py-2 font-medium text-gray-900">{sp.name}</td>
                  <td className="px-3 py-2">{sp.purpose}</td>
                  <td className="px-3 py-2">{sp.dataCategories.join(', ')}</td>
                  <td className="px-3 py-2">{sp.country}</td>
                  <td className="px-3 py-2">
                    {sp.status === 'active' ? (
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Em definição
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-gray-600">
          Entradas com status &ldquo;Em definição&rdquo; indicam categorias de fornecedor já
          previstas na operação, cuja escolha específica ainda não foi finalizada. Antes da
          contratação efetiva, essa lista é atualizada com nome e país do fornecedor escolhido.
        </p>
      </section>

      <section aria-labelledby="notificacao" className="flex flex-col gap-3">
        <h2 id="notificacao" className="text-xl font-semibold text-gray-900">
          Notificação de mudanças
        </h2>
        <p>
          Antes de incluir ou substituir um subprocessador, notificamos as clínicas
          controladoras com pelo menos <strong>30 dias de antecedência</strong>, por
          e-mail e por aviso dentro do aplicativo. Isso dá tempo para a clínica avaliar e,
          se discordar da mudança, encerrar o contrato antes que a mudança entre em vigor.
        </p>
        <p className="text-sm text-gray-600">
          Pacientes que queiram receber as mesmas atualizações podem solicitar via canal do{' '}
          <Link
            href="/legal/privacidade#encarregado"
            className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            Encarregado
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="link-privacidade" className="flex flex-col gap-3">
        <h2 id="link-privacidade" className="text-xl font-semibold text-gray-900">
          Documento relacionado
        </h2>
        <p>
          A política completa de tratamento de dados está no{' '}
          <Link
            href="/legal/privacidade"
            className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            Aviso de Privacidade
          </Link>
          .
        </p>
      </section>
    </article>
  )
}
