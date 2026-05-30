#!/usr/bin/env tsx
/**
 * lgpd-lint — enforça a política de retenção (AGM-33).
 *
 * Toda chamada `pgTable('foo', …)` em src/db/schema.ts precisa ter `foo`
 * declarado em PII_TABLES (com retention_class) ou em NON_PII_TABLES (com razão
 * justificada) — ambos em src/lib/lgpd/retention.ts.
 *
 * Falha de CI = alguém adicionou tabela sem classificar. O processo é:
 * 1. Se a tabela carrega PII (Art. 5º I LGPD), adicionar entrada em PII_TABLES
 *    com a classe correta (ver lgpd-baseline §2 para qual escolher).
 * 2. Se não carrega PII, adicionar em NON_PII_TABLES com uma frase explicando
 *    por quê — vira parte da trilha auditável.
 *
 * Uso: `pnpm lgpd:lint` ou `tsx scripts/lgpd-lint.ts`.
 * Modo programático: `import { lintSchemaFile } from './scripts/lgpd-lint.ts'`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isNonPiiTable, findPiiEntry } from '../src/lib/lgpd/retention'

export interface LintIssue {
  table: string
  kind: 'unclassified'
  message: string
}

export interface LintResult {
  schemaPath: string
  tablesFound: string[]
  issues: LintIssue[]
}

// Captura o nome literal passado para pgTable('name', …). Não trata casos
// onde o nome é uma variável — todo o schema atual usa literal e o lint é
// pragmático: se alguém usar variável, força refactor para literal (a auditoria
// de retenção quer nomes grepables).
const PG_TABLE_RE = /pgTable\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g

export function extractTableNames(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(PG_TABLE_RE)) {
    names.push(match[1])
  }
  return names
}

export function lintSchema(source: string, schemaPath: string): LintResult {
  const tables = extractTableNames(source)
  const issues: LintIssue[] = []
  for (const table of tables) {
    if (findPiiEntry(table)) continue
    if (isNonPiiTable(table)) continue
    issues.push({
      table,
      kind: 'unclassified',
      message: `Tabela "${table}" não está em PII_TABLES nem em NON_PII_TABLES (src/lib/lgpd/retention.ts). Classifique antes de mergear.`,
    })
  }
  return { schemaPath, tablesFound: tables, issues }
}

export function lintSchemaFile(schemaPath: string): LintResult {
  const source = readFileSync(schemaPath, 'utf8')
  return lintSchema(source, schemaPath)
}

function formatReport(result: LintResult): string {
  const lines: string[] = []
  lines.push(`lgpd-lint: ${result.schemaPath}`)
  lines.push(`  tabelas encontradas: ${result.tablesFound.length}`)
  for (const table of result.tablesFound) {
    const entry = findPiiEntry(table)
    if (entry) {
      lines.push(`    ✓ ${table} → PII (${entry.retentionClass})`)
    } else if (isNonPiiTable(table)) {
      lines.push(`    ✓ ${table} → non-PII (allowlist)`)
    } else {
      lines.push(`    ✗ ${table} → não classificada`)
    }
  }
  if (result.issues.length > 0) {
    lines.push('')
    lines.push(`  ${result.issues.length} pendência(s):`)
    for (const issue of result.issues) {
      lines.push(`    - ${issue.message}`)
    }
  }
  return lines.join('\n')
}

async function main() {
  const schemaPath = resolve(process.cwd(), 'src/db/schema.ts')
  const result = lintSchemaFile(schemaPath)
  process.stdout.write(formatReport(result) + '\n')
  if (result.issues.length > 0) {
    process.exit(1)
  }
}

// Permite import em testes (vitest) sem rodar main()
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(2)
  })
}
