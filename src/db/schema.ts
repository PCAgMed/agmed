import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// Sentinel table from AGM-5 bootstrap — kept for migration continuity.
export const dbReady = pgTable('_db_ready', {
  id: serial('id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
})

// `deletedAt` is the soft-delete marker introduced by AGM-32 so an Art. 18 VI
// request can be honored asynchronously (account scheduled for elimination
// 30 days after request, per lgpd-baseline §2).
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  password: text('password'),
  emailVerified: timestamp('emailVerified', { withTimezone: true }),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
})

// Granular consent registry. Marketing/analytics opt-ins live here; the LGPD
// base legal for them is Art. 11 II "g" (consentimento específico) and they are
// revogable at any time per Art. 18 IX. One row per (subject, kind) pair —
// `granted_at` is set when first opted in, `revoked_at` flips it off.
export const consents = pgTable(
  'consents',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(), // 'professional' for now, 'patient' later
    subjectId: text('subject_id').notNull(),
    kind: text('kind').notNull(), // e.g. 'marketing_email', 'analytics'
    policyVersion: text('policy_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subjectKindUnique: uniqueIndex('consents_subject_kind_uq').on(t.subjectType, t.subjectId, t.kind),
    subjectIdx: index('consents_subject_idx').on(t.subjectType, t.subjectId),
  }),
)

// Audit trail of every LGPD-relevant action (Art. 37 + ANPD orientação).
// Retention: 10 years (lgpd-baseline §2). Never expose this table to titulares
// directly — it is operator-side accountability, not personal data per se.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    actorType: text('actor_type').notNull(), // 'professional' | 'patient' | 'system' | 'anonymous'
    actorId: text('actor_id'),
    subjectType: text('subject_type'), // who the data belongs to
    subjectId: text('subject_id'),
    action: text('action').notNull(), // e.g. 'rights.access', 'rights.export', 'rights.delete'
    outcome: text('outcome').notNull(), // 'success' | 'denied' | 'error'
    reason: text('reason'),
    protocol: text('protocol').notNull(), // human-readable id returned to the titular
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    subjectIdx: index('audit_log_subject_idx').on(t.subjectType, t.subjectId),
    actionIdx: index('audit_log_action_idx').on(t.action),
    occurredIdx: index('audit_log_occurred_idx').on(t.occurredAt),
    protocolIdx: index('audit_log_protocol_idx').on(t.protocol),
  }),
)

// Trilha de auditoria do descarte por retention sweep (AGM-33). Uma linha por
// (run, table, phase). Retenção própria: 10 anos (baseline §2 — `audit_log_10y`).
// Esta trilha precisa sobreviver a Art. 18 IV ("excluam meus logs") — accountability
// operacional não cai sob direito de eliminação enquanto houver base legal de
// retenção.
export const retentionRun = pgTable(
  'retention_run',
  {
    id: text('id').primaryKey(),
    // Agrupa todas as linhas geradas por um único disparo do sweep — útil para
    // consultar "tudo que aconteceu na run X" e para idempotência (cron pode
    // disparar 2x; queries usam runId p/ deduplicar).
    runId: text('run_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    tableName: text('table_name').notNull(),
    retentionClass: text('retention_class').notNull(),
    // 'discover' = só contou, não mutou (modo dry-run ou primeira passada);
    // 'soft'     = SET deletedAtColumn = now() em N linhas;
    // 'hard'     = DELETE em N linhas (após gracePeriod).
    phase: text('phase').notNull(),
    rowsAffected: integer('rows_affected').notNull().default(0),
    // 'cron:retention_sweep' | 'manual:<userId|systemKey>' — quem disparou.
    actor: text('actor').notNull(),
    // Texto curto se houve erro parcial; phase ainda completa para gravar evidência.
    error: text('error'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    runIdx: index('retention_run_run_idx').on(t.runId),
    tableIdx: index('retention_run_table_idx').on(t.tableName),
    classIdx: index('retention_run_class_idx').on(t.retentionClass),
    startedIdx: index('retention_run_started_idx').on(t.startedAt),
  }),
)
