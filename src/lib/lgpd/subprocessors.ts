// Lista de subprocessadores espelhada do lgpd-baseline §4. Mantida em código
// (não em banco) porque é informação pública e versionada — toda alteração
// passa por PR e dispara notificação prévia de 30 dias às clínicas-controladoras.
// A página pública /legal/subprocessadores (AGM-34) consome a mesma lista.

export interface Subprocessor {
  name: string
  purpose: string
  dataCategories: string[]
  country: string
  status: 'active' | 'pending'
}

export const SUBPROCESSORS_VERSION = '2026-05-30'

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'Provedor de cloud (a definir)',
    purpose: 'Hospedagem da aplicação e do banco de dados',
    dataCategories: ['Todos'],
    country: 'Brasil (preferência)',
    status: 'pending',
  },
  {
    name: 'Provedor de e-mail transacional (a definir)',
    purpose: 'Envio de lembretes e notificações operacionais',
    dataCategories: ['Contato (e-mail, nome)'],
    country: 'EUA/UE',
    status: 'pending',
  },
  {
    name: 'Gateway de pagamento PIX (a definir)',
    purpose: 'Liquidação de pagamentos',
    dataCategories: ['Pagamento (CPF, valor, comprovante)'],
    country: 'Brasil',
    status: 'pending',
  },
  {
    name: 'WhatsApp Business API (a definir)',
    purpose: 'Lembrete transacional de consulta (opt-in)',
    dataCategories: ['Contato (telefone, nome)'],
    country: 'EUA/UE',
    status: 'pending',
  },
] as const
