import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { collectPendingDisposalMetrics, runRetentionSweep } from './retention-sweep'
import type { PiiTableEntry } from './retention'

// Fake pool que captura SQL emitido e devolve respostas pré-programadas.
// Suficiente para validar a lógica de fases, predicates e auditoria sem
// dependência de Postgres real (os testes integration vão em sweep que
// usa o pool de @/lib/db quando DATABASE_URL existir).
interface FakeQuery {
  sql: string
  values: unknown[]
}

type Responder = (q: FakeQuery) => { rows?: unknown[]; rowCount?: number }

function makeFakePool(responder: Responder): { pool: Pool; queries: FakeQuery[] } {
  const queries: FakeQuery[] = []
  const pool = {
    query: (sql: string, values: unknown[] = []) => {
      const q = { sql, values }
      queries.push(q)
      const r = responder(q)
      return Promise.resolve({ rows: r.rows ?? [], rowCount: r.rowCount ?? 0 })
    },
  } as unknown as Pool
  return { pool, queries }
}

const T_USERS: PiiTableEntry = {
  table: 'users',
  retentionClass: 'profissional_active',
  anchorColumn: 'deletion_requested_at',
  deletedAtColumn: 'deleted_at',
  extraWhere: 'deletion_requested_at IS NOT NULL',
}

const T_CONSENTS: PiiTableEntry = {
  table: 'consents',
  retentionClass: 'marketing_consent',
  anchorColumn: 'revoked_at',
  extraWhere: 'revoked_at IS NOT NULL',
}

const T_AUDIT: PiiTableEntry = {
  table: 'audit_log',
  retentionClass: 'audit_log_10y',
  anchorColumn: 'occurred_at',
}

describe('runRetentionSweep', () => {
  it('dryRun executes only discover phase and records audit', async () => {
    const { pool, queries } = makeFakePool((q) => {
      if (q.sql.startsWith('SELECT count(*)')) return { rows: [{ n: 7 }] }
      return {}
    })

    const result = await runRetentionSweep({
      dryRun: true,
      pool,
      tables: [T_USERS],
      now: new Date('2026-06-01T00:00:00Z'),
      actor: { kind: 'test:dryrun' },
    })

    expect(result.dryRun).toBe(true)
    expect(result.actor).toBe('test:dryrun')
    expect(result.phases).toHaveLength(1)
    expect(result.phases[0]).toMatchObject({
      table: 'users',
      phase: 'discover',
      rowsAffected: 7,
    })
    expect(result.totals).toMatchObject({ discovered: 7, softDeleted: 0, hardDeleted: 0, errors: 0 })

    const sqls = queries.map((q) => q.sql.trim())
    // Exatamente uma discovery SELECT e uma INSERT na retention_run
    expect(sqls.filter((s) => s.startsWith('SELECT count(*)'))).toHaveLength(1)
    expect(sqls.filter((s) => s.startsWith('INSERT INTO retention_run'))).toHaveLength(1)
    expect(sqls.some((s) => s.startsWith('UPDATE'))).toBe(false)
    expect(sqls.some((s) => s.startsWith('DELETE'))).toBe(false)
  })

  it('full sweep on table with soft-delete column runs discover → soft → hard', async () => {
    const { pool, queries } = makeFakePool((q) => {
      if (q.sql.startsWith('SELECT count(*)')) return { rows: [{ n: 3 }] }
      if (q.sql.trim().startsWith('UPDATE')) return { rowCount: 3 }
      if (q.sql.trim().startsWith('DELETE')) return { rowCount: 2 }
      return {}
    })

    const result = await runRetentionSweep({
      pool,
      tables: [T_USERS],
      now: new Date('2026-06-01T00:00:00Z'),
    })

    const phases = result.phases.map((p) => p.phase)
    expect(phases).toEqual(['discover', 'soft', 'hard'])
    expect(result.totals).toMatchObject({ discovered: 3, softDeleted: 3, hardDeleted: 2, errors: 0 })

    // Verifica que o predicate do hard-delete usa deleted_at + gracePeriod
    const hardSql = queries.find((q) => q.sql.includes('DELETE FROM'))?.sql ?? ''
    expect(hardSql).toContain('"deleted_at" IS NOT NULL')
    expect(hardSql).toContain("interval '30 days'")
  })

  it('table without soft-delete column skips soft phase (consents revoked → hard direto)', async () => {
    const { pool, queries } = makeFakePool((q) => {
      if (q.sql.startsWith('SELECT count(*)')) return { rows: [{ n: 5 }] }
      if (q.sql.trim().startsWith('DELETE')) return { rowCount: 5 }
      return {}
    })

    const result = await runRetentionSweep({
      pool,
      tables: [T_CONSENTS],
      now: new Date('2026-06-01T00:00:00Z'),
    })

    expect(result.phases.map((p) => p.phase)).toEqual(['discover', 'hard'])
    expect(result.totals.hardDeleted).toBe(5)
    expect(queries.some((q) => q.sql.trim().startsWith('UPDATE'))).toBe(false)

    const hardSql = queries.find((q) => q.sql.trim().startsWith('DELETE'))?.sql ?? ''
    expect(hardSql).toContain('revoked_at IS NOT NULL')
  })

  it('audit_log uses maxAge (10 years) with no extraWhere', async () => {
    const { pool, queries } = makeFakePool((q) => {
      if (q.sql.startsWith('SELECT count(*)')) return { rows: [{ n: 0 }] }
      if (q.sql.trim().startsWith('DELETE')) return { rowCount: 0 }
      return {}
    })

    await runRetentionSweep({
      pool,
      tables: [T_AUDIT],
      now: new Date('2026-06-01T00:00:00Z'),
    })

    const discoverSql = queries.find((q) => q.sql.startsWith('SELECT count(*)'))?.sql ?? ''
    expect(discoverSql).toContain('"occurred_at"')
    expect(discoverSql).toContain("interval '3650 days'") // 10y * 365
    const hardSql = queries.find((q) => q.sql.trim().startsWith('DELETE'))?.sql ?? ''
    expect(hardSql).toContain("interval '3680 days'") // 10y + 30d grace
  })

  it('error in one table does not abort the sweep — other tables still run', async () => {
    let firstUpdateSeen = false
    const { pool } = makeFakePool((q) => {
      if (q.sql.startsWith('SELECT count(*)')) return { rows: [{ n: 1 }] }
      if (q.sql.trim().startsWith('UPDATE') && !firstUpdateSeen) {
        firstUpdateSeen = true
        throw new Error('boom on users')
      }
      if (q.sql.trim().startsWith('DELETE')) return { rowCount: 4 }
      return {}
    })

    const result = await runRetentionSweep({
      pool,
      tables: [T_USERS, T_CONSENTS],
      now: new Date('2026-06-01T00:00:00Z'),
    })

    expect(result.totals.errors).toBe(1)
    const usersPhases = result.phases.filter((p) => p.table === 'users')
    expect(usersPhases.some((p) => p.error?.includes('boom'))).toBe(true)
    // consents seguiu normalmente
    const consentsPhases = result.phases.filter((p) => p.table === 'consents')
    expect(consentsPhases.map((p) => p.phase)).toEqual(['discover', 'hard'])
    expect(result.totals.hardDeleted).toBe(4)
  })

  it('rejects unsafe table identifier from a hand-rolled registry entry', async () => {
    const { pool } = makeFakePool(() => ({}))
    const bad: PiiTableEntry = {
      table: 'users; DROP TABLE patients',
      retentionClass: 'audit_log_10y',
      anchorColumn: 'occurred_at',
    }
    const result = await runRetentionSweep({ pool, tables: [bad], now: new Date() })
    // O erro vira linha em retention_run com error setado; o sweep não throwa.
    expect(result.totals.errors).toBe(1)
    expect(result.phases[0].error).toMatch(/Unsafe SQL identifier/)
  })

  it('records actor in retention_run insert', async () => {
    const { pool, queries } = makeFakePool((q) => {
      if (q.sql.startsWith('SELECT count(*)')) return { rows: [{ n: 0 }] }
      return {}
    })

    await runRetentionSweep({
      pool,
      tables: [T_AUDIT],
      dryRun: true,
      actor: { kind: 'manual:jonatas@orpen' },
      now: new Date('2026-06-01T00:00:00Z'),
    })

    const insertQ = queries.find((q) => q.sql.startsWith('INSERT INTO retention_run'))
    expect(insertQ).toBeDefined()
    // values[7] = actor (id, runId, startedAt, table_name, retention_class, phase, rows_affected, actor, error, metadata)
    expect(insertQ?.values[7]).toBe('manual:jonatas@orpen')
  })
})

describe('collectPendingDisposalMetrics', () => {
  it('returns one entry per PII table with pendingCount + oldest', async () => {
    const { pool } = makeFakePool((q) => {
      if (q.sql.includes('count(*)')) {
        return { rows: [{ n: 4, oldest: new Date('2020-01-01T00:00:00Z') }] }
      }
      return {}
    })
    const metrics = await collectPendingDisposalMetrics({
      pool,
      now: new Date('2026-06-01T00:00:00Z'),
    })
    expect(metrics.length).toBeGreaterThan(0)
    for (const m of metrics) {
      expect(m.table.length).toBeGreaterThan(0)
      expect(m.pendingCount).toBeGreaterThanOrEqual(0)
    }
  })
})
