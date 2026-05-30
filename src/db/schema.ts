import { index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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
