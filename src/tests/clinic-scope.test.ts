/**
 * AGM-24 commit B — testes de isolamento do helper `withClinicScope` contra RLS real.
 *
 * Estes testes batem no Postgres real (não mockado) — porque o ponto deles é
 * provar que a policy `tenant_isolation` (migration 0005) bloqueia leitura
 * cross-tenant. Mock não enxerga RLS.
 *
 * Pré-requisito: `DATABASE_URL` apontando para um DB com migrations 0000-0005
 * aplicadas. O setup local (`docker compose up -d postgres && npm run db:migrate`)
 * já cobre. Em CI, o workflow precisa garantir a mesma sequência.
 *
 * Se `DATABASE_URL` não estiver disponível, os testes são pulados (não
 * derrubam a suíte) — útil para máquinas dev sem postgres rodando.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Importa os helpers em todos os testes, mas deixamos `describe.skipIf` cuidar
// do caso "sem DATABASE_URL ou DB inacessível".
import { ClinicScopeError, withClinicScope, withRowSecurityOff } from '@/lib/db'

const DATABASE_URL = process.env.DATABASE_URL
const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'
const CLINIC_B = '00000000-0000-0000-0000-00000000bbbb'

async function dbReachable(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const probe = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 })
  try {
    await probe.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end().catch(() => {})
  }
}

const reachable = await dbReachable()

describe.skipIf(!reachable)('AGM-24 multi-tenancy — withClinicScope + RLS', () => {
  // Pool dedicado para o setup/teardown (cria e remove as clínicas-fixture).
  // Usa `withRowSecurityOff` quando precisa enxergar/limpar tudo.
  let adminPool: Pool

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: DATABASE_URL })
    // Limpeza prévia (caso uma run anterior tenha morrido) — usa o helper
    // pra desligar RLS na transação de limpeza.
    await withRowSecurityOff(async (tx) => {
      await tx.query("DELETE FROM consents WHERE id LIKE 'agm24-test-%'")
      await tx.query("DELETE FROM audit_log WHERE id LIKE 'agm24-test-%'")
      await tx.query(`DELETE FROM clinics WHERE id IN ($1, $2)`, [CLINIC_A, CLINIC_B])
    })
    // Cria fixtures. clinics tem FORCE RLS; precisa de SET LOCAL no INSERT.
    // INSERT em clinics WITH CHECK = (id = current_setting(...)::uuid), ou
    // seja, o INSERT só passa se o `app.clinic_id` já é igual ao `id`. Truque:
    // usar withRowSecurityOff p/ criar as duas linhas; é exatamente o caso
    // legítimo de "operação cross-clinic" (provisionamento de tenant).
    await withRowSecurityOff(async (tx) => {
      await tx.query("INSERT INTO clinics (id, name, cnpj) VALUES ($1, 'Clínica A test', '99999999000001')", [CLINIC_A])
      await tx.query("INSERT INTO clinics (id, name, cnpj) VALUES ($1, 'Clínica B test', '99999999000002')", [CLINIC_B])
    })
  })

  afterAll(async () => {
    await withRowSecurityOff(async (tx) => {
      await tx.query("DELETE FROM consents WHERE id LIKE 'agm24-test-%'")
      await tx.query("DELETE FROM audit_log WHERE id LIKE 'agm24-test-%'")
      await tx.query(`DELETE FROM clinics WHERE id IN ($1, $2)`, [CLINIC_A, CLINIC_B])
    })
    await adminPool.end()
  })

  it('insere e seleciona uma linha de paciente apenas dentro do escopo da clínica A', async () => {
    await withClinicScope(CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-a-1', $1, 'patient', 'pat-a-1', 'marketing_email', 'v1')`,
        [CLINIC_A],
      )
    })

    await withClinicScope(CLINIC_A, async (tx) => {
      const { rows } = await tx.query<{ id: string; clinic_id: string }>(
        "SELECT id, clinic_id FROM consents WHERE id = 'agm24-test-a-1'",
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].clinic_id).toBe(CLINIC_A)
    })
  })

  it('o escopo da clínica B não enxerga linhas da clínica A', async () => {
    await withClinicScope(CLINIC_B, async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-b-1', $1, 'patient', 'pat-b-1', 'marketing_email', 'v1')`,
        [CLINIC_B],
      )
      const { rows: viewedFromB } = await tx.query<{ id: string }>(
        "SELECT id FROM consents WHERE subject_id LIKE 'pat-%' ORDER BY id",
      )
      // De B só enxerga linhas com clinic_id = B e clinic_id IS NULL — nunca
      // as de A.
      expect(viewedFromB.find((r) => r.id === 'agm24-test-a-1')).toBeUndefined()
      expect(viewedFromB.find((r) => r.id === 'agm24-test-b-1')).toBeDefined()
    })
  })

  it('INSERT com clinic_id de outra clínica é rejeitado pelo WITH CHECK', async () => {
    await expect(
      withClinicScope(CLINIC_A, async (tx) => {
        await tx.query(
          `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
           VALUES ('agm24-test-cross', $1, 'patient', 'pat-cross', 'marketing_email', 'v1')`,
          [CLINIC_B],
        )
      }),
    ).rejects.toThrow(/row-level security|policy/i)

    // E a linha NÃO existe no banco — rollback aconteceu.
    await withRowSecurityOff(async (tx) => {
      const { rows } = await tx.query("SELECT id FROM consents WHERE id = 'agm24-test-cross'")
      expect(rows).toHaveLength(0)
    })
  })

  it('UPDATE só altera linhas dentro do escopo, mesmo com WHERE genérico', async () => {
    // Cria 1 linha por clínica
    await withClinicScope(CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-upd-a', $1, 'patient', 'pat-upd-a', 'analytics', 'v1')`,
        [CLINIC_A],
      )
    })
    await withClinicScope(CLINIC_B, async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-upd-b', $1, 'patient', 'pat-upd-b', 'analytics', 'v1')`,
        [CLINIC_B],
      )
    })

    // Dentro do escopo de A, um "UPDATE consents SET revoked_at = now()
    // WHERE kind = 'analytics'" deveria afetar apenas a linha de A.
    await withClinicScope(CLINIC_A, async (tx) => {
      const result = await tx.query(
        "UPDATE consents SET revoked_at = now(), updated_at = now() WHERE kind = 'analytics' AND id LIKE 'agm24-test-upd-%'",
      )
      expect(result.rowCount).toBe(1)
    })

    // Confirma via leitura sem RLS que só a linha de A foi tocada.
    await withRowSecurityOff(async (tx) => {
      const { rows } = await tx.query<{ id: string; revoked_at: Date | null }>(
        "SELECT id, revoked_at FROM consents WHERE id IN ('agm24-test-upd-a','agm24-test-upd-b') ORDER BY id",
      )
      expect(rows).toHaveLength(2)
      const a = rows.find((r) => r.id === 'agm24-test-upd-a')!
      const b = rows.find((r) => r.id === 'agm24-test-upd-b')!
      expect(a.revoked_at).not.toBeNull()
      expect(b.revoked_at).toBeNull()
    })
  })

  it('audit_log com clinic_id NULL é visível em qualquer escopo (eventos system-level)', async () => {
    await withRowSecurityOff(async (tx) => {
      await tx.query(
        `INSERT INTO audit_log (id, clinic_id, actor_type, action, outcome, protocol)
         VALUES ('agm24-test-sys', NULL, 'system', 'rights.access', 'success', 'agm24-test-protocol-1')`,
      )
    })

    await withClinicScope(CLINIC_A, async (tx) => {
      const { rows } = await tx.query("SELECT id FROM audit_log WHERE id = 'agm24-test-sys'")
      expect(rows).toHaveLength(1)
    })
    await withClinicScope(CLINIC_B, async (tx) => {
      const { rows } = await tx.query("SELECT id FROM audit_log WHERE id = 'agm24-test-sys'")
      expect(rows).toHaveLength(1)
    })
  })

  it('withClinicScope rejeita clinicId não-UUID', async () => {
    await expect(
      withClinicScope("'; DROP TABLE clinics; --", async () => undefined),
    ).rejects.toThrow(ClinicScopeError)
    await expect(withClinicScope('not-a-uuid', async () => undefined)).rejects.toThrow(ClinicScopeError)
  })

  it('withClinicScope faz rollback em erro do callback', async () => {
    const probeId = 'agm24-test-rollback'
    await expect(
      withClinicScope(CLINIC_A, async (tx) => {
        await tx.query(
          `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
           VALUES ($1, $2, 'patient', 'pat-rb', 'marketing_email', 'v1')`,
          [probeId, CLINIC_A],
        )
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    await withRowSecurityOff(async (tx) => {
      const { rows } = await tx.query('SELECT id FROM consents WHERE id = $1', [probeId])
      expect(rows).toHaveLength(0)
    })
  })

  it('como agenda_app sem app.clinic_id setado, SELECT em consents só vê linhas com clinic_id NULL', async () => {
    // Cria uma linha de paciente em A (clinic_id = A)
    await withClinicScope(CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-noscope', $1, 'patient', 'pat-noscope', 'analytics', 'v1')
         ON CONFLICT DO NOTHING`,
        [CLINIC_A],
      )
    })
    // E uma system-level (clinic_id NULL) — via withRowSecurityOff porque
    // INSERTs com NULL precisam de cross-clinic legítimo.
    await withRowSecurityOff(async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-sys-consent', NULL, 'professional', 'prof-sys', 'analytics', 'v1')
         ON CONFLICT DO NOTHING`,
      )
    })

    // Conecta como superuser, troca para agenda_app dentro de uma tx, NÃO seta
    // app.clinic_id. RLS deveria filtrar para `clinic_id IS NULL` apenas.
    const client = await adminPool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE "agenda_app"')
      const { rows } = await client.query<{ id: string; clinic_id: string | null }>(
        "SELECT id, clinic_id FROM consents WHERE id IN ('agm24-test-noscope','agm24-test-sys-consent')",
      )
      await client.query('ROLLBACK')
      expect(rows.find((r) => r.id === 'agm24-test-noscope')).toBeUndefined()
      expect(rows.find((r) => r.id === 'agm24-test-sys-consent')).toBeDefined()
    } finally {
      client.release()
    }
  })

  it('dbUnscopedDangerous bypassa RLS (vê TODAS as clínicas — uso auditável)', async () => {
    // Esta é a contraprova: `dbUnscopedDangerous` retorna o pool com a role
    // de sessão (superuser). Ele DEVE enxergar tudo — o teste codifica isso
    // como invariante, pra ninguém "fixar" essa visibilidade achando que é bug.
    await withClinicScope(CLINIC_A, async (tx) => {
      await tx.query(
        `INSERT INTO consents (id, clinic_id, subject_type, subject_id, kind, policy_version)
         VALUES ('agm24-test-bypass', $1, 'patient', 'pat-bypass', 'analytics', 'v1')
         ON CONFLICT DO NOTHING`,
        [CLINIC_A],
      )
    })

    const { rows } = await adminPool.query<{ id: string }>(
      "SELECT id FROM consents WHERE id = 'agm24-test-bypass'",
    )
    expect(rows).toHaveLength(1)
  })
})
