// Política de retenção e descarte da Clínica Agenda.
// Fonte: lgpd-baseline §2 (AGM-29). Esta é a única source-of-truth do
// produto sobre "quanto tempo cada dado vive". O lint LGPD (scripts/lgpd-lint.ts)
// usa PII_TABLES + NON_PII_TABLES para impedir que uma nova tabela com PII
// entre em schema.ts sem retention_class declarado.
//
// Decisão (AGM-33): mantemos a classificação como **atributo de tabela em código**
// e não como coluna por linha. Razão: cada tabela atual tem uma única classe
// (não há tabela mista). Quando aparecer uma tabela com classes mistas — ex.:
// `documents` com anexos de prontuário e anexos administrativos — adicionamos
// uma coluna `retention_class` na própria tabela e o registry continua sendo
// o índice "tabela → classe(s) permitidas". Até lá, registry tipado é mais
// barato, mais auditável e tão enforceable quanto coluna (via lint+CI).

/**
 * Classes de retenção definidas no baseline §2. Cada classe carrega regras
 * próprias de janela ativa, período de graça (entre soft-delete e hard-delete)
 * e a base normativa que justifica.
 */
export const RETENTION_CLASSES = [
  'prontuario_20y',
  'log_access_5y',
  'log_app_12m',
  'profissional_active',
  'profissional_offboarded_5y',
  'payment_5y',
  'marketing_consent',
  'audit_log_10y',
  'transient',
] as const

export type RetentionClass = (typeof RETENTION_CLASSES)[number]

/**
 * Política operacional por classe.
 *
 * - `maxActiveAgeDays`: tempo máximo, em dias, desde o ponto-âncora (`anchorColumn`)
 *   antes da linha entrar em fila de descarte. `null` significa "enquanto vínculo
 *   ativo" — o sweep precisa de um predicado externo (ex.: deletion_requested_at
 *   IS NOT NULL).
 * - `gracePeriodDays`: tempo entre soft-delete (marca `deletedAtColumn` se
 *   declarado) e hard-delete. `0` = hard-delete imediato sem soft-delete.
 * - `legalBasis`: artigos/normas que justificam a retenção; usado em respostas
 *   de Art. 18 IV ("Por que vocês ainda têm meu dado?").
 */
export interface RetentionPolicy {
  retentionClass: RetentionClass
  description: string
  maxActiveAgeDays: number | null
  gracePeriodDays: number
  legalBasis: string
}

export const RETENTION_POLICIES: Record<RetentionClass, RetentionPolicy> = {
  prontuario_20y: {
    retentionClass: 'prontuario_20y',
    description:
      'Prontuário eletrônico, anexos (exames/imagens) e cadastro de paciente vinculado. 20 anos após o último atendimento.',
    maxActiveAgeDays: 20 * 365,
    gracePeriodDays: 90,
    legalBasis: 'CFM 1.821/2007 Art. 4º + CFM 2.299/2021 + LGPD Art. 7º II',
  },
  log_access_5y: {
    retentionClass: 'log_access_5y',
    description:
      'Logs de acesso a prontuário/dado clínico. 6 meses online + até 5 anos em armazenamento frio para auditoria.',
    maxActiveAgeDays: 5 * 365,
    gracePeriodDays: 30,
    legalBasis: 'Marco Civil Art. 15 + boa prática auditável CFM/ANPD',
  },
  log_app_12m: {
    retentionClass: 'log_app_12m',
    description: 'Logs gerais da aplicação (IP, user agent, ação). 6 meses online + 6 meses cold = 12 meses.',
    maxActiveAgeDays: 365,
    gracePeriodDays: 0,
    legalBasis: 'Marco Civil Art. 15',
  },
  profissional_active: {
    retentionClass: 'profissional_active',
    description:
      'Profissional com conta ativa. Eliminação 30 dias após pedido de cancelamento (Art. 18 VI), respeitando obrigações fiscais que migram para profissional_offboarded_5y.',
    maxActiveAgeDays: null,
    gracePeriodDays: 30,
    legalBasis: 'LGPD Art. 7º V (execução de contrato) + Art. 18 VI',
  },
  profissional_offboarded_5y: {
    retentionClass: 'profissional_offboarded_5y',
    description:
      'Dados mínimos do profissional desligado (CPF, nome, CRM, datas de vínculo). 5 anos para fins fiscais e prescrição cível.',
    maxActiveAgeDays: 5 * 365,
    gracePeriodDays: 30,
    legalBasis: 'CTN + prescrição cível + LGPD Art. 7º II',
  },
  payment_5y: {
    retentionClass: 'payment_5y',
    description: 'Dados de pagamento (PIX, valor, comprovante). 5 anos para obrigação fiscal.',
    maxActiveAgeDays: 5 * 365,
    gracePeriodDays: 30,
    legalBasis: 'CTN + LGPD Art. 7º II',
  },
  marketing_consent: {
    retentionClass: 'marketing_consent',
    description:
      'Consentimento granular de marketing (Art. 11 II g). Eliminação imediata ao revogar; renovação obrigatória a cada 2 anos sem nova interação.',
    // 2 anos é o limite "sem interação"; sweep avalia também revogação (gracePeriodDays = 0).
    maxActiveAgeDays: 2 * 365,
    gracePeriodDays: 0,
    legalBasis: 'LGPD Art. 8º §5º + Art. 18 IX',
  },
  audit_log_10y: {
    retentionClass: 'audit_log_10y',
    description:
      'Trilha de auditoria operacional (acessos, exercícios de direitos, descartes). 10 anos para accountability conforme baseline §2.',
    maxActiveAgeDays: 10 * 365,
    gracePeriodDays: 30,
    legalBasis: 'LGPD Art. 37 + orientação ANPD',
  },
  transient: {
    retentionClass: 'transient',
    description: 'Dados efêmeros operacionais (rate-limit, locks). Eliminação em ≤ 24h.',
    maxActiveAgeDays: 1,
    gracePeriodDays: 0,
    legalBasis: 'Necessidade técnica (LGPD Art. 6º III)',
  },
}

/**
 * Como o sweep encontra linhas vencidas para uma tabela classificada.
 *
 * - `anchorColumn`: coluna timestamp que determina "vencimento" (ex.: `revoked_at`,
 *   `deletion_requested_at`, `occurred_at`).
 * - `deletedAtColumn`: opcional. Quando presente, sweep faz soft-delete primeiro
 *   (UPDATE … SET <deletedAtColumn> = now()) antes do hard-delete após
 *   `gracePeriodDays`. Quando ausente, hard-delete é direto.
 * - `extraWhere`: predicado SQL adicional aplicado na fase de discovery
 *   (sem placeholders — texto literal). Útil para classes com regra extra
 *   ("só descarta consents revogados", "só descarta users com deletion_requested_at NOT NULL").
 */
export interface PiiTableEntry {
  table: string
  retentionClass: RetentionClass
  anchorColumn: string
  deletedAtColumn?: string
  extraWhere?: string
  notes?: string
}

/**
 * Registry de tabelas com PII (Art. 5º I LGPD) + sua classe de retenção.
 *
 * **Toda nova tabela com PII tem que aparecer aqui.** O CI roda `lgpd:lint`
 * (scripts/lgpd-lint.ts) e falha se schema.ts ganhar `pgTable('x', …)` sem
 * `x` estar em PII_TABLES ou NON_PII_TABLES.
 *
 * Tabelas declaradas aqui podem ainda não existir em schema.ts (ex.: tabelas
 * planejadas em AGM-24/AGM-32 cujo PR está em revisão) — o lint só impõe
 * cobertura no sentido schema.ts → registry, não o contrário, para não bloquear
 * coordenação entre branches.
 */
export const PII_TABLES: readonly PiiTableEntry[] = [
  {
    table: 'users',
    retentionClass: 'profissional_active',
    anchorColumn: 'deletion_requested_at',
    deletedAtColumn: 'deleted_at',
    extraWhere: 'deletion_requested_at IS NOT NULL',
    notes:
      'Soft-delete depois de gracePeriod/2 (15d) → hard-delete em gracePeriod (30d). Ver retention-sweep.ts para a fórmula.',
  },
  {
    table: 'consents',
    retentionClass: 'marketing_consent',
    anchorColumn: 'revoked_at',
    extraWhere: 'revoked_at IS NOT NULL',
    notes: 'Hard-delete imediato após revoke (gracePeriodDays = 0). Renovação 2y trata-se separadamente do anchor.',
  },
  {
    table: 'audit_log',
    retentionClass: 'audit_log_10y',
    anchorColumn: 'occurred_at',
    notes: 'A própria trilha é PII (carrega actor_id/subject_id). Auto-classificada como 10 anos.',
  },
]

/**
 * Allowlist explícita de tabelas SEM PII. Manter curto e bem comentado:
 * cada adição é uma afirmação "esta tabela não carrega dado pessoal" auditável.
 */
export const NON_PII_TABLES: readonly { table: string; reason: string }[] = [
  {
    table: '_db_ready',
    reason: 'Sentinel de bootstrap (AGM-5). Apenas timestamp técnico, sem dado de titular.',
  },
]

export function getPolicy(retentionClass: RetentionClass): RetentionPolicy {
  return RETENTION_POLICIES[retentionClass]
}

export function findPiiEntry(table: string): PiiTableEntry | undefined {
  return PII_TABLES.find((entry) => entry.table === table)
}

export function isNonPiiTable(table: string): boolean {
  return NON_PII_TABLES.some((entry) => entry.table === table)
}

export interface ClassificationResult {
  table: string
  status: 'pii' | 'non-pii' | 'unclassified'
  retentionClass?: RetentionClass
}

export function classifyTable(table: string): ClassificationResult {
  const pii = findPiiEntry(table)
  if (pii) return { table, status: 'pii', retentionClass: pii.retentionClass }
  if (isNonPiiTable(table)) return { table, status: 'non-pii' }
  return { table, status: 'unclassified' }
}

export function isRetentionClass(value: string): value is RetentionClass {
  return (RETENTION_CLASSES as readonly string[]).includes(value)
}
