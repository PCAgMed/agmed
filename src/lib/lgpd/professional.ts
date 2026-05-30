import { getPool } from '@/lib/db'
import { listConsents, type ConsentRecord } from './consents'

export interface ProfessionalProfile {
  id: string
  name: string | null
  email: string
  emailVerified: Date | null
  image: string | null
  createdAt: Date
  deletedAt: Date | null
  deletionRequestedAt: Date | null
}

interface ProfessionalRow {
  id: string
  name: string | null
  email: string
  emailVerified: Date | null
  image: string | null
  created_at: Date
  deleted_at: Date | null
  deletion_requested_at: Date | null
}

export async function getProfessionalProfile(id: string): Promise<ProfessionalProfile | null> {
  const pool = getPool()
  const { rows } = await pool.query<ProfessionalRow>(
    `SELECT id, name, email, "emailVerified", image, created_at, deleted_at, deletion_requested_at
     FROM users WHERE id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    deletionRequestedAt: row.deletion_requested_at,
  }
}

// Atualização parcial. A lista de campos editáveis é deliberadamente curta —
// `email` requer fluxo de verificação separado (não implementado), `password`
// tem rota própria. Adições futuras (CRM, telefone, especialidade) entram aqui.
export interface ProfessionalProfilePatch {
  name?: string | null
  image?: string | null
}

export async function updateProfessionalProfile(
  id: string,
  patch: ProfessionalProfilePatch,
): Promise<ProfessionalProfile | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    fields.push(`name = $${i++}`)
    values.push(patch.name)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'image')) {
    fields.push(`image = $${i++}`)
    values.push(patch.image)
  }
  if (fields.length === 0) return getProfessionalProfile(id)

  values.push(id)
  const pool = getPool()
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values)
  return getProfessionalProfile(id)
}

// Marca o pedido de eliminação. O hard-delete é executado pelo job da AGM-33
// após `grace_period` (30 dias, conforme baseline §2). Idempotente.
export async function requestProfessionalDeletion(id: string): Promise<Date> {
  const pool = getPool()
  const { rows } = await pool.query<{ deletion_requested_at: Date }>(
    `UPDATE users
     SET deletion_requested_at = COALESCE(deletion_requested_at, now())
     WHERE id = $1
     RETURNING deletion_requested_at`,
    [id],
  )
  return rows[0]?.deletion_requested_at ?? new Date()
}

export interface ProfessionalDataPackage {
  schema: 'clinica-agenda.lgpd.export.v1'
  generatedAt: string
  subject: {
    type: 'professional'
    id: string
  }
  profile: ProfessionalProfile
  consents: ConsentRecord[]
  // Quando o produto crescer (sessões, agendamentos, mensagens, billing) a
  // lista é estendida aqui. O schema fica versionado em `schema` para a
  // portabilidade ser estável do ponto de vista do titular.
  relatedRecords: {
    appointments: never[]
    medicalRecords: never[]
    payments: never[]
  }
}

export async function buildProfessionalDataPackage(
  id: string,
): Promise<ProfessionalDataPackage | null> {
  const profile = await getProfessionalProfile(id)
  if (!profile) return null
  const consents = await listConsents('professional', id)
  return {
    schema: 'clinica-agenda.lgpd.export.v1',
    generatedAt: new Date().toISOString(),
    subject: { type: 'professional', id },
    profile,
    consents,
    relatedRecords: {
      appointments: [],
      medicalRecords: [],
      payments: [],
    },
  }
}
