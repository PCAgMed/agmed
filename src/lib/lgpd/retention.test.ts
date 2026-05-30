import { describe, expect, it } from 'vitest'
import {
  classifyTable,
  findPiiEntry,
  isNonPiiTable,
  isRetentionClass,
  NON_PII_TABLES,
  PII_TABLES,
  RETENTION_CLASSES,
  RETENTION_POLICIES,
} from './retention'

describe('retention registry', () => {
  it('every class in RETENTION_CLASSES has a policy', () => {
    for (const cls of RETENTION_CLASSES) {
      const policy = RETENTION_POLICIES[cls]
      expect(policy).toBeDefined()
      expect(policy.retentionClass).toBe(cls)
      expect(policy.description.length).toBeGreaterThan(10)
      expect(policy.legalBasis.length).toBeGreaterThan(5)
      expect(policy.gracePeriodDays).toBeGreaterThanOrEqual(0)
    }
  })

  it('policy max ages match baseline §2 in days', () => {
    expect(RETENTION_POLICIES.prontuario_20y.maxActiveAgeDays).toBe(20 * 365)
    expect(RETENTION_POLICIES.log_access_5y.maxActiveAgeDays).toBe(5 * 365)
    expect(RETENTION_POLICIES.log_app_12m.maxActiveAgeDays).toBe(365)
    expect(RETENTION_POLICIES.profissional_active.maxActiveAgeDays).toBeNull()
    expect(RETENTION_POLICIES.profissional_offboarded_5y.maxActiveAgeDays).toBe(5 * 365)
    expect(RETENTION_POLICIES.payment_5y.maxActiveAgeDays).toBe(5 * 365)
    // marketing_consent não tem disposal etário — só via revoked_at (extraWhere).
    // A regra de renovação 2y é UX, não sweep.
    expect(RETENTION_POLICIES.marketing_consent.maxActiveAgeDays).toBeNull()
    expect(RETENTION_POLICIES.audit_log_10y.maxActiveAgeDays).toBe(10 * 365)
    expect(RETENTION_POLICIES.transient.maxActiveAgeDays).toBe(1)
  })

  it('every PII table entry references a valid class and has anchor column', () => {
    for (const entry of PII_TABLES) {
      expect(isRetentionClass(entry.retentionClass)).toBe(true)
      expect(entry.anchorColumn.length).toBeGreaterThan(0)
    }
  })

  it('PII_TABLES and NON_PII_TABLES are disjoint', () => {
    const piiNames = new Set(PII_TABLES.map((t) => t.table))
    for (const entry of NON_PII_TABLES) {
      expect(piiNames.has(entry.table)).toBe(false)
    }
  })

  it('classifyTable returns pii / non-pii / unclassified', () => {
    expect(classifyTable('users')).toEqual({ table: 'users', status: 'pii', retentionClass: 'profissional_active' })
    expect(classifyTable('_db_ready').status).toBe('non-pii')
    expect(classifyTable('nope_does_not_exist').status).toBe('unclassified')
  })

  it('multi-tenancy tables (AGM-24) carry the right class and anchor', () => {
    expect(classifyTable('clinics')).toMatchObject({ status: 'pii', retentionClass: 'profissional_active' })
    expect(classifyTable('clinic_memberships')).toMatchObject({
      status: 'pii',
      retentionClass: 'profissional_active',
    })
  })

  it('isRetentionClass narrows correctly', () => {
    expect(isRetentionClass('prontuario_20y')).toBe(true)
    expect(isRetentionClass('not_a_class')).toBe(false)
  })

  it('findPiiEntry / isNonPiiTable agree with classifyTable', () => {
    expect(findPiiEntry('users')?.table).toBe('users')
    expect(findPiiEntry('_db_ready')).toBeUndefined()
    expect(isNonPiiTable('_db_ready')).toBe(true)
    expect(isNonPiiTable('users')).toBe(false)
  })
})
