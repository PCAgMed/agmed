// Job de descarte da política de retenção LGPD (AGM-33).
//
// Discover → Soft → Hard, por tabela com PII (PII_TABLES). A trilha de
// auditoria de cada fase é gravada em `retention_run` (mesma classe que
// `audit_log`: 10 anos).
//
// Convencionado:
// - Função assíncrona pura — não conhece "cron"; quem dispara é o endpoint
//   interno `/api/internal/retention/sweep` (ou um futuro scheduler de prod —
//   ver AGM-37).
// - Idempotente: chamar o sweep duas vezes seguidas no mesmo ponto-no-tempo
//   gera 0 linhas afetadas na segunda chamada.
// - Modo `dryRun` registra apenas a fase 'discover' (não muta).
// - Falha de uma classe NÃO derruba o sweep inteiro — outras classes seguem;
//   o erro vira linha em `retention_run.error` para investigação.

import { randomUUID } from 'crypto'
import type { Pool, PoolClient } from 'pg'
import { withRowSecurityOff } from '@/lib/db'
import { childLogger } from '@/lib/observability/logger'
import { PII_TABLES, RETENTION_POLICIES, type PiiTableEntry, type RetentionClass } from './retention'

export type SweepPhase = 'discover' | 'soft' | 'hard'

export interface SweepActor {
  // 'cron:retention_sweep' para o job semanal; 'manual:<userId>' quando humano
  // dispara via console; 'test:<name>' nos testes.
  kind: string
}

export interface RunRetentionSweepOptions {
  dryRun?: boolean
  actor?: SweepActor
  /**
   * Permite "viajar no tempo" para fins de teste — todo predicado SQL usa este
   * timestamp como "agora". Em produção, sempre `new Date()`.
   */
  now?: Date
  /**
   * Permite restringir a varredura a um subconjunto do registry (para sweeps
   * pontuais "rode só os logs"). Default: todas as entradas de PII_TABLES.
   */
  tables?: readonly PiiTableEntry[]
  /**
   * Injeta um Pool pg específico (para testes com pool dedicado). Default:
   * o pool compartilhado de `dbUnscopedDangerous()`. AGM-24: passar um pool
   * customizado é cross-clinic por design — chamadas em prod usam o helper
   * `withRowSecurityOff` para desligar RLS na transação.
   */
  pool?: Pool
}

export interface TablePhaseResult {
  table: string
  retentionClass: RetentionClass
  phase: SweepPhase
  rowsAffected: number
  error?: string
}

export interface SweepResult {
  runId: string
  startedAt: Date
  endedAt: Date
  dryRun: boolean
  actor: string
  phases: TablePhaseResult[]
  totals: {
    discovered: number
    softDeleted: number
    hardDeleted: number
    errors: number
  }
}

const log = childLogger({ component: 'lgpd.retention.sweep' })

export async function runRetentionSweep(
  opts: RunRetentionSweepOptions = {},
): Promise<SweepResult> {
  const dryRun = opts.dryRun ?? false
  const actor = opts.actor?.kind ?? 'cron:retention_sweep'
  const now = opts.now ?? new Date()
  const tables = opts.tables ?? PII_TABLES
  const runId = randomUUID()
  const startedAt = new Date()

  log.info({ event: 'retention.sweep.start', runId, dryRun, tables: tables.length }, 'retention sweep started')

  // AGM-24: sweep precisa atravessar a fronteira de tenant em LEITURA E ESCRITA
  // (auditoria de retenção é sobre todas as clínicas). Em produção, usa
  // `withRowSecurityOff` para abrir uma transação com RLS desligada. Testes
  // que injetam `opts.pool` controlam RLS por conta própria (DB de teste sem
  // policy aplicada ou usando role de owner).
  if (opts.pool) {
    const phases = await sweepTables(opts.pool, tables, dryRun, now, runId, startedAt, actor)
    return finalize(runId, startedAt, dryRun, actor, phases)
  }

  return await withRowSecurityOff(async (client) => {
    const phases = await sweepTables(client, tables, dryRun, now, runId, startedAt, actor)
    return finalize(runId, startedAt, dryRun, actor, phases)
  })
}

async function sweepTables(
  pool: Pool | PoolClient,
  tables: readonly PiiTableEntry[],
  dryRun: boolean,
  now: Date,
  runId: string,
  startedAt: Date,
  actor: string,
): Promise<TablePhaseResult[]> {
  const phases: TablePhaseResult[] = []
  for (const entry of tables) {
    try {
      // Sempre faz discover (cheap COUNT) — útil mesmo em modo normal pra ter
      // métrica de "quanto há vencido AGORA antes da mutação".
      const discovered = await discoverExpiredCount(pool, entry, now)
      phases.push({
        table: entry.table,
        retentionClass: entry.retentionClass,
        phase: 'discover',
        rowsAffected: discovered,
      })
      await recordPhase(pool, runId, startedAt, actor, entry, 'discover', discovered, null)

      if (dryRun) continue

      // Soft-delete só quando há coluna pra isso. Sem coluna, salta direto
      // pro hard-delete (gracePeriodDays = 0 — caso de consents revogados,
      // logs antigos, etc.).
      if (entry.deletedAtColumn) {
        const softCount = await softDeleteExpired(pool, entry, now)
        phases.push({
          table: entry.table,
          retentionClass: entry.retentionClass,
          phase: 'soft',
          rowsAffected: softCount,
        })
        await recordPhase(pool, runId, startedAt, actor, entry, 'soft', softCount, null)
      }

      const hardCount = await hardDeleteExpired(pool, entry, now)
      phases.push({
        table: entry.table,
        retentionClass: entry.retentionClass,
        phase: 'hard',
        rowsAffected: hardCount,
      })
      await recordPhase(pool, runId, startedAt, actor, entry, 'hard', hardCount, null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(
        { event: 'retention.sweep.error', runId, table: entry.table, err: message },
        'retention sweep failed for table',
      )
      phases.push({
        table: entry.table,
        retentionClass: entry.retentionClass,
        phase: 'discover',
        rowsAffected: 0,
        error: message,
      })
      await recordPhase(pool, runId, startedAt, actor, entry, 'discover', 0, message)
    }
  }
  return phases
}

function finalize(
  runId: string,
  startedAt: Date,
  dryRun: boolean,
  actor: string,
  phases: TablePhaseResult[],
): SweepResult {
  const endedAt = new Date()
  const totals = phases.reduce(
    (acc, p) => {
      if (p.error) acc.errors += 1
      if (p.phase === 'discover') acc.discovered += p.rowsAffected
      if (p.phase === 'soft') acc.softDeleted += p.rowsAffected
      if (p.phase === 'hard') acc.hardDeleted += p.rowsAffected
      return acc
    },
    { discovered: 0, softDeleted: 0, hardDeleted: 0, errors: 0 },
  )

  log.info(
    {
      event: 'retention.sweep.done',
      runId,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      ...totals,
    },
    'retention sweep completed',
  )

  return { runId, startedAt, endedAt, dryRun, actor, phases, totals }
}

// ------- Helpers ------------------------------------------------------------

function quoteIdent(name: string): string {
  // Identificadores vêm SEMPRE do registry estático (PII_TABLES) — nunca de
  // entrada de usuário. Mesmo assim, validamos defensivamente: só permite
  // [A-Za-z_][A-Za-z0-9_]* e envolvemos em aspas duplas para o caso de nome
  // reservado. Falhar duro se vier qualquer coisa fora disso.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`)
  }
  return `"${name}"`
}

function ageFilter(anchor: string, maxAgeDays: number | null, nowParam: string): string | null {
  if (maxAgeDays === null) return null
  // anchor < now() - interval 'X days'
  return `${quoteIdent(anchor)} < ${nowParam}::timestamptz - interval '${maxAgeDays} days'`
}

interface BuiltClause {
  where: string
  usesNow: boolean
}

function buildDiscoveryWhere(entry: PiiTableEntry, nowParam: string): BuiltClause {
  const policy = RETENTION_POLICIES[entry.retentionClass]
  const conditions: string[] = []
  let usesNow = false
  const age = ageFilter(entry.anchorColumn, policy.maxActiveAgeDays, nowParam)
  if (age) {
    conditions.push(age)
    usesNow = true
  }
  if (entry.extraWhere) conditions.push(entry.extraWhere)
  if (conditions.length === 0) {
    // Sem maxAge e sem extraWhere → não temos critério; nunca encontra nada.
    // Defesa em profundidade contra "deletar tudo".
    return { where: '1=0', usesNow: false }
  }
  return { where: conditions.join(' AND '), usesNow }
}

async function discoverExpiredCount(pool: Pool | PoolClient, entry: PiiTableEntry, now: Date): Promise<number> {
  const clause = buildDiscoveryWhere(entry, '$1')
  if (clause.where === '1=0') return 0
  const sql = `SELECT count(*)::int AS n FROM ${quoteIdent(entry.table)} WHERE ${clause.where}`
  const { rows } = await pool.query<{ n: number }>(sql, clause.usesNow ? [now.toISOString()] : [])
  return rows[0]?.n ?? 0
}

async function softDeleteExpired(pool: Pool | PoolClient, entry: PiiTableEntry, now: Date): Promise<number> {
  if (!entry.deletedAtColumn) return 0
  // Soft-delete sempre usa $1 (no SET deletedAtColumn = $1), então qualquer
  // placeholder na where vira $2.
  const clause = buildDiscoveryWhere(entry, '$2')
  if (clause.where === '1=0') return 0
  const sql = `
    UPDATE ${quoteIdent(entry.table)}
    SET ${quoteIdent(entry.deletedAtColumn)} = $1
    WHERE (${clause.where}) AND ${quoteIdent(entry.deletedAtColumn)} IS NULL
  `
  const values = clause.usesNow ? [now.toISOString(), now.toISOString()] : [now.toISOString()]
  const result = await pool.query(sql, values)
  return result.rowCount ?? 0
}

async function hardDeleteExpired(pool: Pool | PoolClient, entry: PiiTableEntry, now: Date): Promise<number> {
  const policy = RETENTION_POLICIES[entry.retentionClass]
  const conditions: string[] = []
  let usesNow = false

  // Quando há coluna de soft-delete: só hard-delete linhas já soft-deletadas
  // há mais que gracePeriodDays. Mantém a janela de "mudei de ideia".
  if (entry.deletedAtColumn) {
    conditions.push(
      `${quoteIdent(entry.deletedAtColumn)} IS NOT NULL AND ${quoteIdent(entry.deletedAtColumn)} < $1::timestamptz - interval '${policy.gracePeriodDays} days'`,
    )
    usesNow = true
  } else {
    // Sem soft-delete: aplica discovery + gracePeriod (que pode ser 0) sobre
    // o anchor. Para gracePeriod = 0, equivalente a "tudo que está vencido".
    if (policy.maxActiveAgeDays !== null) {
      const totalDays = policy.maxActiveAgeDays + policy.gracePeriodDays
      conditions.push(`${quoteIdent(entry.anchorColumn)} < $1::timestamptz - interval '${totalDays} days'`)
      usesNow = true
    }
    if (entry.extraWhere) {
      // Para extraWhere com gracePeriod > 0, aplica também idade sobre anchor.
      if (policy.gracePeriodDays > 0) {
        conditions.push(
          `${quoteIdent(entry.anchorColumn)} < $1::timestamptz - interval '${policy.gracePeriodDays} days'`,
        )
        usesNow = true
      }
      conditions.push(entry.extraWhere)
    }
  }

  if (conditions.length === 0) return 0
  const sql = `DELETE FROM ${quoteIdent(entry.table)} WHERE ${conditions.join(' AND ')}`
  const result = await pool.query(sql, usesNow ? [now.toISOString()] : [])
  return result.rowCount ?? 0
}

async function recordPhase(
  pool: Pool | PoolClient,
  runId: string,
  startedAt: Date,
  actor: string,
  entry: PiiTableEntry,
  phase: SweepPhase,
  rowsAffected: number,
  error: string | null,
): Promise<void> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO retention_run
       (id, run_id, started_at, ended_at, table_name, retention_class, phase, rows_affected, actor, error, metadata)
     VALUES ($1,$2,$3, now(), $4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      runId,
      startedAt.toISOString(),
      entry.table,
      entry.retentionClass,
      phase,
      rowsAffected,
      actor,
      error,
      null,
    ],
  )
}

// Métrica observável: idade média e quantidade de linhas pendentes por classe.
// Consumido pela rota interna `/api/internal/retention/metrics` (futura — fica
// como dado disponível para o painel quando observability matures).
export interface PendingDisposalMetric {
  table: string
  retentionClass: RetentionClass
  pendingCount: number
  oldestAnchorAtIso: string | null
}

export async function collectPendingDisposalMetrics(
  opts: { now?: Date; pool?: Pool } = {},
): Promise<PendingDisposalMetric[]> {
  const now = opts.now ?? new Date()
  // AGM-24: a coleta de métricas atravessa todos os tenants (é métrica
  // operacional global). Em prod desliga RLS na transação; em teste, usa o
  // pool injetado.
  if (opts.pool) {
    return collectMetrics(opts.pool, now)
  }
  return await withRowSecurityOff((client) => collectMetrics(client, now))
}

async function collectMetrics(
  pool: Pool | PoolClient,
  now: Date,
): Promise<PendingDisposalMetric[]> {
  const out: PendingDisposalMetric[] = []
  for (const entry of PII_TABLES) {
    const clause = buildDiscoveryWhere(entry, '$1')
    if (clause.where === '1=0') {
      out.push({
        table: entry.table,
        retentionClass: entry.retentionClass,
        pendingCount: 0,
        oldestAnchorAtIso: null,
      })
      continue
    }
    const sql = `
      SELECT count(*)::int AS n, min(${quoteIdent(entry.anchorColumn)}) AS oldest
      FROM ${quoteIdent(entry.table)}
      WHERE ${clause.where}
    `
    const { rows } = await pool.query<{ n: number; oldest: Date | null }>(
      sql,
      clause.usesNow ? [now.toISOString()] : [],
    )
    out.push({
      table: entry.table,
      retentionClass: entry.retentionClass,
      pendingCount: rows[0]?.n ?? 0,
      oldestAnchorAtIso: rows[0]?.oldest ? new Date(rows[0].oldest).toISOString() : null,
    })
  }
  return out
}
