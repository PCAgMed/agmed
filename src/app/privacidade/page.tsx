import { PrivacyPanel } from './PrivacyPanel'

export const metadata = {
  title: 'Minha privacidade — Clínica Agenda',
  description:
    'Exerça os direitos garantidos pelo Art. 18 da LGPD sobre seus dados pessoais.',
}

export default function PrivacidadePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Minha privacidade</h1>
        <p className="text-sm text-gray-600">
          Esta página reúne os direitos que a Lei Geral de Proteção de Dados (LGPD, Art. 18)
          garante a você como titular dos seus dados pessoais. Toda solicitação gera um
          protocolo e fica registrada em nossa trilha de auditoria.
        </p>
      </header>
      <PrivacyPanel />
    </main>
  )
}
