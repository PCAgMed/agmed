import type { Metadata } from 'next'
import Link from 'next/link'
import {
  PRIVACY_POLICY_HISTORY,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
} from '@/lib/legal/version-history'

export const metadata: Metadata = {
  title: 'Aviso de Privacidade — Clínica Agenda',
  description:
    'Como a Clínica Agenda trata dados pessoais de profissionais e pacientes, em conformidade com a Lei Geral de Proteção de Dados (LGPD).',
  robots: { index: true, follow: true },
}

const FORMATTED_LAST_UPDATED = new Date(PRIVACY_POLICY_LAST_UPDATED).toLocaleDateString(
  'pt-BR',
  { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
)

export default function PrivacidadeLegalPage() {
  return (
    <article className="flex flex-col gap-8 leading-relaxed">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Documento legal
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Aviso de Privacidade
        </h1>
        <p className="text-sm text-gray-600">
          Versão {PRIVACY_POLICY_VERSION} · Atualizado em {FORMATTED_LAST_UPDATED}
        </p>
      </header>

      <section aria-labelledby="quem-somos" className="flex flex-col gap-3">
        <h2 id="quem-somos" className="text-xl font-semibold text-gray-900">
          1. Quem somos
        </h2>
        <p>
          A <strong>Clínica Agenda</strong> é um software de controle de agendamentos
          oferecido como serviço (SaaS) para clínicas médicas de pequeno e médio porte. Em
          relação aos dados que tratamos, atuamos em dois papéis distintos definidos pela
          LGPD:
        </p>
        <ul className="ml-6 list-disc space-y-2">
          <li>
            <strong>Controlador</strong> dos dados de profissionais de saúde que se cadastram
            para usar o sistema (cadastro, autenticação, faturamento do SaaS).
          </li>
          <li>
            <strong>Operador</strong> dos dados de pacientes que as clínicas registram em
            nossa plataforma. A clínica é a controladora desses dados; nós os tratamos em
            nome dela, sob suas instruções e dentro do contrato firmado.
          </li>
        </ul>
      </section>

      <section aria-labelledby="dados-tratados" className="flex flex-col gap-3">
        <h2 id="dados-tratados" className="text-xl font-semibold text-gray-900">
          2. Quais dados tratamos
        </h2>
        <p>Em condições normais de uso, tratamos as seguintes categorias de dados:</p>
        <ul className="ml-6 list-disc space-y-2">
          <li>
            <strong>Profissionais:</strong> nome, CPF, registro profissional (CRM/CRO/etc.),
            e-mail, telefone, credenciais de autenticação, logs de acesso.
          </li>
          <li>
            <strong>Pacientes:</strong> nome, CPF, data de nascimento, contato, endereço,
            dados de agendamento, prontuário eletrônico (anamnese, evolução, prescrição,
            exames e anexos).
          </li>
          <li>
            <strong>Pagamentos:</strong> dados necessários para liquidar transações via PIX
            (CPF do pagador, valor, comprovante).
          </li>
          <li>
            <strong>Comunicação automatizada:</strong> lembretes transacionais de consulta
            por e-mail ou WhatsApp.
          </li>
          <li>
            <strong>Métricas de uso:</strong> dados anonimizados, sem possibilidade de
            re-identificação.
          </li>
        </ul>
        <p>
          Dados de prontuário e correlatos são considerados <strong>dados sensíveis</strong>{' '}
          (art. 5º, II da LGPD) e recebem proteção adicional. Tratamos esses dados apenas
          quando há base legal específica do art. 11.
        </p>
      </section>

      <section aria-labelledby="finalidades" className="flex flex-col gap-3">
        <h2 id="finalidades" className="text-xl font-semibold text-gray-900">
          3. Por que tratamos seus dados
        </h2>
        <p>Cada tratamento que realizamos tem uma base legal definida na LGPD:</p>
        <ul className="ml-6 list-disc space-y-2">
          <li>
            <strong>Execução de contrato</strong> (art. 7º, V): para prestar o serviço de
            agendamento contratado (cadastro de profissional, autenticação, faturamento).
          </li>
          <li>
            <strong>Tutela da saúde</strong> (art. 11, II, &ldquo;f&rdquo;): para o
            atendimento em saúde realizado pela clínica controladora — inclui cadastro de
            paciente, agendamento, prontuário e lembretes de consulta.
          </li>
          <li>
            <strong>Cumprimento de obrigação legal</strong> (art. 7º, II e art. 11, II,
            &ldquo;a&rdquo;): para guarda de prontuário (CFM 1.821/2007), retenção de logs
            (Marco Civil da Internet) e obrigações fiscais.
          </li>
          <li>
            <strong>Consentimento específico e revogável</strong> (art. 11, II,
            &ldquo;g&rdquo;): apenas para comunicação não-transacional (newsletter,
            promoções da clínica). Você pode revogar a qualquer momento na sua área
            &ldquo;Minha privacidade&rdquo;.
          </li>
          <li>
            <strong>Legítimo interesse</strong> (art. 7º, IX): para segurança da conta e
            prevenção de fraude.
          </li>
        </ul>
      </section>

      <section aria-labelledby="retencao" className="flex flex-col gap-3">
        <h2 id="retencao" className="text-xl font-semibold text-gray-900">
          4. Por quanto tempo guardamos seus dados
        </h2>
        <p>
          A retenção segue a finalidade e a obrigação legal aplicável. As principais
          janelas são:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 bg-gray-50 text-left">
                <th scope="col" className="px-3 py-2 font-semibold">
                  Categoria
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Retenção
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Base
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="px-3 py-2">Prontuário eletrônico e anexos</td>
                <td className="px-3 py-2">20 anos após o último atendimento</td>
                <td className="px-3 py-2">CFM 1.821/2007</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-3 py-2">Cadastro de paciente</td>
                <td className="px-3 py-2">Junto do prontuário (20 anos)</td>
                <td className="px-3 py-2">Inseparável do prontuário</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-3 py-2">Logs de acesso a prontuário</td>
                <td className="px-3 py-2">5 anos</td>
                <td className="px-3 py-2">Auditoria CFM/ANPD</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-3 py-2">Logs de aplicação</td>
                <td className="px-3 py-2">Até 12 meses</td>
                <td className="px-3 py-2">Marco Civil art. 15</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-3 py-2">Cadastro de profissional desligado</td>
                <td className="px-3 py-2">5 anos</td>
                <td className="px-3 py-2">Prescrição cível e fiscal</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="px-3 py-2">Dados de pagamento</td>
                <td className="px-3 py-2">5 anos</td>
                <td className="px-3 py-2">Obrigação fiscal (CTN)</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Consentimento de marketing</td>
                <td className="px-3 py-2">Até a revogação</td>
                <td className="px-3 py-2">LGPD art. 8º</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          O descarte é programático e auditado — registramos quando, quantas linhas e qual
          classe foi descartada, mantendo essa trilha por 10 anos.
        </p>
      </section>

      <section aria-labelledby="compartilhamento" className="flex flex-col gap-3">
        <h2 id="compartilhamento" className="text-xl font-semibold text-gray-900">
          5. Com quem compartilhamos
        </h2>
        <p>
          Para operar o serviço, contamos com fornecedores que processam dados em nosso
          nome (subprocessadores). Cada um é contratualmente obrigado a manter o mesmo
          padrão de proteção que aplicamos.
        </p>
        <p>
          A lista atual está em{' '}
          <Link
            href="/legal/subprocessadores"
            className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            /legal/subprocessadores
          </Link>
          . Antes de incluir ou trocar um subprocessador, notificamos as clínicas
          controladoras com pelo menos 30 dias de antecedência.
        </p>
        <p>
          Não vendemos dados pessoais. Não compartilhamos prontuário ou dados sensíveis
          com terceiros para finalidades comerciais.
        </p>
      </section>

      <section aria-labelledby="direitos" className="flex flex-col gap-3">
        <h2 id="direitos" className="text-xl font-semibold text-gray-900">
          6. Seus direitos como titular
        </h2>
        <p>
          A LGPD (art. 18) garante a você os seguintes direitos sobre seus dados pessoais:
        </p>
        <ul className="ml-6 list-disc space-y-2">
          <li>Confirmação de que tratamos seus dados e acesso a eles.</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
          <li>
            Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou
            tratados em desconformidade com a lei.
          </li>
          <li>Portabilidade dos dados em formato estruturado.</li>
          <li>
            Eliminação dos dados tratados com base em consentimento, exceto quando há
            obrigação legal de retenção (como prontuário).
          </li>
          <li>Informação sobre as entidades com quem compartilhamos seus dados.</li>
          <li>Revogação do consentimento.</li>
        </ul>
        <p>
          <strong>Como exercer:</strong> profissionais cadastrados podem usar a área{' '}
          <Link
            href="/privacidade"
            className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            Minha privacidade
          </Link>{' '}
          dentro do sistema. Pacientes devem dirigir a solicitação primeiro à clínica que os
          atende (controladora dos dados). Em qualquer caso, o canal do Encarregado abaixo
          também está disponível.
        </p>
        <p>
          Toda solicitação gera um protocolo com data e fica registrada em nossa trilha de
          auditoria. O prazo legal para resposta é de 15 dias.
        </p>
      </section>

      <section aria-labelledby="seguranca" className="flex flex-col gap-3">
        <h2 id="seguranca" className="text-xl font-semibold text-gray-900">
          7. Segurança
        </h2>
        <p>
          Aplicamos medidas técnicas e administrativas para proteger os dados que tratamos:
          criptografia em trânsito (HTTPS), hash de senhas, controle de acesso por papel,
          logs de auditoria, rate limiting, monitoramento de incidentes e revisão periódica
          de subprocessadores.
        </p>
        <p>
          Em caso de incidente de segurança que envolva risco aos titulares, comunicamos a
          Autoridade Nacional de Proteção de Dados (ANPD) e os titulares afetados em prazo
          razoável, conforme art. 48 da LGPD.
        </p>
      </section>

      <section aria-labelledby="encarregado" className="flex flex-col gap-3">
        <h2 id="encarregado" className="text-xl font-semibold text-gray-900">
          8. Encarregado pelo tratamento de dados (DPO)
        </h2>
        <p>
          O Encarregado é a pessoa indicada pela Clínica Agenda como canal de comunicação
          entre a empresa, os titulares e a ANPD (art. 41 da LGPD).
        </p>
        <p>
          <strong>Canal:</strong>{' '}
          <a
            href="mailto:dpo@clinica-agenda.com.br"
            className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
          >
            dpo@clinica-agenda.com.br
          </a>
        </p>
      </section>

      <section aria-labelledby="atualizacoes" className="flex flex-col gap-3">
        <h2 id="atualizacoes" className="text-xl font-semibold text-gray-900">
          9. Atualizações deste aviso
        </h2>
        <p>
          Podemos atualizar este aviso periodicamente. Alterações materiais (mudança de
          finalidade, base legal, retenção, subprocessador relevante ou canal do
          Encarregado) bumpam a versão, ficam registradas no histórico abaixo e, quando
          envolvem novas finalidades, podem exigir novo consentimento.
        </p>
      </section>

      <section aria-labelledby="historico" className="flex flex-col gap-3">
        <h2 id="historico" className="text-xl font-semibold text-gray-900">
          10. Histórico de versões
        </h2>
        <ul className="ml-6 list-disc space-y-3">
          {PRIVACY_POLICY_HISTORY.map((entry) => (
            <li key={entry.version}>
              <p className="font-medium text-gray-900">
                Versão {entry.version} —{' '}
                {new Date(entry.date).toLocaleDateString('pt-BR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </p>
              <ul className="ml-6 list-disc text-sm text-gray-700">
                {entry.changes.map((change, idx) => (
                  <li key={idx}>{change}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
