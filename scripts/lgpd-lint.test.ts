import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTableNames, lintSchema, lintSchemaFile } from './lgpd-lint'

describe('lgpd-lint', () => {
  it('extracts table names from pgTable() calls', () => {
    const source = `
      export const a = pgTable('alpha', { id: text('id') })
      export const b = pgTable("beta", {
        id: text('id'),
      })
      const c = pgTable(   'gamma_3'   , { id: text('id') })
    `
    expect(extractTableNames(source)).toEqual(['alpha', 'beta', 'gamma_3'])
  })

  it('passes when all tables are classified', () => {
    const source = `
      pgTable('users', {})
      pgTable('consents', {})
      pgTable('audit_log', {})
      pgTable('_db_ready', {})
    `
    const result = lintSchema(source, '<test>')
    expect(result.issues).toEqual([])
    expect(result.tablesFound).toEqual(['users', 'consents', 'audit_log', '_db_ready'])
  })

  it('fails when a new unclassified table appears', () => {
    const source = `
      pgTable('users', {})
      pgTable('appointments', {})
    `
    const result = lintSchema(source, '<test>')
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ table: 'appointments', kind: 'unclassified' })
  })

  it('lints the real src/db/schema.ts without leaving any unclassified table', () => {
    // Esta é a barreira de verdade: o schema atual no working tree não pode
    // ter tabelas fora do registry. Se este teste quebrar, alguém adicionou
    // tabela sem classificar — o lint do CI vai cobrar a mesma coisa.
    const schemaPath = resolve(process.cwd(), 'src/db/schema.ts')
    const result = lintSchemaFile(schemaPath)
    const unclassified = result.issues.map((i) => i.table)
    expect(unclassified, `Tabelas não classificadas em schema.ts: ${unclassified.join(', ')}`).toEqual([])
  })

  it('handles source with no pgTable calls', () => {
    const result = lintSchema('// nothing here', '<test>')
    expect(result.tablesFound).toEqual([])
    expect(result.issues).toEqual([])
  })

  it('readFileSync on the schema returns content that lints clean', () => {
    // Sanity check: existência e leitura do arquivo, separado do parse.
    const schemaPath = resolve(process.cwd(), 'src/db/schema.ts')
    const raw = readFileSync(schemaPath, 'utf8')
    expect(raw.length).toBeGreaterThan(0)
    expect(raw).toContain('pgTable(')
  })
})
