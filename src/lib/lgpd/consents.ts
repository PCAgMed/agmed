import { randomUUID } from 'crypto'
import { dbUnscopedDangerous } from '@/lib/db'

// AGM-24: enquanto `subject_type='professional'`, consents vivem com
// `clinic_id IS NULL` (consentimento dado à plataforma, não a uma clínica
// específica). Quando AGM-39 introduzir consent de paciente, este módulo
// ganha um par com `withClinicScope` — `listConsents` continua aqui (uso
// system-level pelo profissional na sua própria conta), `listPatientConsents`
// vira novo helper escopado.

// Catálogo de tipos de consentimento ativos no produto. Toda nova chave deve
// vir acompanhada de revisão do lgpd-baseline §1 e da página /legal/privacidade.
export const CONSENT_KINDS = ['marketing_email', 'analytics'] as const
export type ConsentKind = (typeof CONSENT_KINDS)[number]

export function isConsentKind(value: string): value is ConsentKind {
  return (CONSENT_KINDS as readonly string[]).includes(value)
}

export interface ConsentRecord {
  id: string
  subjectType: string
  subjectId: string
  kind: ConsentKind
  policyVersion: string
  grantedAt: Date
  revokedAt: Date | null
}

interface ConsentRow {
  id: string
  subject_type: string
  subject_id: string
  kind: string
  policy_version: string
  granted_at: Date
  revoked_at: Date | null
}

function toRecord(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    kind: row.kind as ConsentKind,
    policyVersion: row.policy_version,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  }
}

export async function listConsents(
  subjectType: string,
  subjectId: string,
): Promise<ConsentRecord[]> {
  const pool = dbUnscopedDangerous()
  const { rows } = await pool.query<ConsentRow>(
    'SELECT * FROM consents WHERE subject_type = $1 AND subject_id = $2',
    [subjectType, subjectId],
  )
  return rows.map(toRecord)
}

// Revoga o consentimento se existir e estiver ativo. Retorna o estado pós-op
// e um flag indicando se a chamada de fato mudou algo, para a auditoria.
export async function revokeConsent(
  subjectType: string,
  subjectId: string,
  kind: ConsentKind,
): Promise<{ changed: boolean; record: ConsentRecord | null }> {
  const pool = dbUnscopedDangerous()
  const { rows } = await pool.query<ConsentRow>(
    `UPDATE consents
     SET revoked_at = now(), updated_at = now()
     WHERE subject_type = $1 AND subject_id = $2 AND kind = $3 AND revoked_at IS NULL
     RETURNING *`,
    [subjectType, subjectId, kind],
  )
  if (rows.length > 0) {
    return { changed: true, record: toRecord(rows[0]) }
  }
  const existing = await pool.query<ConsentRow>(
    'SELECT * FROM consents WHERE subject_type = $1 AND subject_id = $2 AND kind = $3',
    [subjectType, subjectId, kind],
  )
  return { changed: false, record: existing.rows[0] ? toRecord(existing.rows[0]) : null }
}

// Insert/upsert helper used by the consent UX (AGM-35) to record a fresh grant.
// Kept here so the consent-write path is co-located with the read path.
export async function grantConsent(input: {
  subjectType: string
  subjectId: string
  kind: ConsentKind
  policyVersion: string
  sourceIp?: string | null
  userAgent?: string | null
}): Promise<ConsentRecord> {
  const pool = dbUnscopedDangerous()
  const { rows } = await pool.query<ConsentRow>(
    `INSERT INTO consents
       (id, subject_type, subject_id, kind, policy_version, source_ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (subject_type, subject_id, kind) DO UPDATE
       SET granted_at = now(),
           revoked_at = NULL,
           policy_version = EXCLUDED.policy_version,
           source_ip = EXCLUDED.source_ip,
           user_agent = EXCLUDED.user_agent,
           updated_at = now()
     RETURNING *`,
    [
      randomUUID(),
      input.subjectType,
      input.subjectId,
      input.kind,
      input.policyVersion,
      input.sourceIp ?? null,
      input.userAgent ?? null,
    ],
  )
  return toRecord(rows[0])
}
