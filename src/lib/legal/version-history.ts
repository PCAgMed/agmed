// Histórico de versões dos documentos legais públicos. Toda alteração
// material (mudança de finalidade, base legal, retenção, subprocessador,
// canal do Encarregado) exige bump de versão + nova entrada aqui, revisada
// no PR. Sem `git blame` substitui auditoria de versão — usuários precisam
// ver a história visivelmente na página.

export interface LegalVersion {
  version: string
  date: string // ISO YYYY-MM-DD
  changes: string[]
}

export const PRIVACY_POLICY_VERSION = '1.0.0'
export const PRIVACY_POLICY_LAST_UPDATED = '2026-05-30'

export const PRIVACY_POLICY_HISTORY: readonly LegalVersion[] = [
  {
    version: '1.0.0',
    date: '2026-05-30',
    changes: [
      'Publicação inicial. Derivada do baseline LGPD interno (AGM-29).',
      'Define os papéis de controlador e operador da Clínica Agenda.',
      'Lista as 10 classes de tratamento, bases legais e retenções.',
      'Estabelece canal do Encarregado: dpo@clinica-agenda.com.br.',
    ],
  },
] as const

export const TERMS_VERSION = '0.0.0'
export const TERMS_LAST_UPDATED = '2026-05-30'
