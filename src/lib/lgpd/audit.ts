import { randomUUID } from 'crypto'
import { dbUnscopedDangerous } from '@/lib/db'
import { childLogger } from '@/lib/observability/logger'

// Subset of Art. 18 + Art. 9 ações que esta tabela registra. Mantido como
// enum string para facilitar consultas Loki/Postgres por ação.
export type AuditAction =
  | 'rights.access'
  | 'rights.export'
  | 'rights.delete'
  | 'rights.profile.update'
  | 'rights.consent.revoke'
  | 'rights.subprocessors.read'
  | 'rights.denied'

export type AuditOutcome = 'success' | 'denied' | 'error'

export type ActorType = 'professional' | 'patient' | 'system' | 'anonymous'

export interface RecordAuditInput {
  actorType: ActorType
  actorId?: string | null
  subjectType?: string | null
  subjectId?: string | null
  action: AuditAction
  outcome: AuditOutcome
  reason?: string | null
  protocol: string
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
  metadata?: Record<string, unknown> | null
}

const log = childLogger({ component: 'lgpd.audit' })

// Append-only insert. The function never throws — auditoria perdida por falha
// de banco vira log estruturado e é alertada via Loki, mas não derruba o
// fluxo do titular (o pedido em si pode ter sucesso e a falha de auditoria
// é tratada como incidente operacional).
// AGM-24: recordAudit escreve com `clinic_id IS NULL` por enquanto — todos
// os eventos atuais (signup, rights.access do profissional, sweep) são
// system-level. Quando AGM-39 adicionar fluxos de paciente, este helper ganha
// um parâmetro `clinicId` e a chamada migra para `withClinicScope`.
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const id = randomUUID()
  const pool = dbUnscopedDangerous()
  try {
    await pool.query(
      `INSERT INTO audit_log
       (id, actor_type, actor_id, subject_type, subject_id, action, outcome,
        reason, protocol, ip, user_agent, request_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        input.actorType,
        input.actorId ?? null,
        input.subjectType ?? null,
        input.subjectId ?? null,
        input.action,
        input.outcome,
        input.reason ?? null,
        input.protocol,
        input.ip ?? null,
        input.userAgent ?? null,
        input.requestId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    )
  } catch (err) {
    log.error(
      {
        event: 'audit.write.failed',
        action: input.action,
        outcome: input.outcome,
        protocol: input.protocol,
        actorId: input.actorId,
        err,
      },
      'failed to persist audit log entry',
    )
  }
}
