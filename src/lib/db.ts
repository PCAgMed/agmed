// AGM-24 commit B — multi-tenancy DB primitives.
//
// Three exports, escolha *deliberada* em cada callsite:
//
// - `withClinicScope(clinicId, fn)` — DEFAULT para qualquer código de domínio.
//   Abre transação, faz `SET LOCAL ROLE agenda_app` + `SET LOCAL app.clinic_id`,
//   executa o callback. A role `agenda_app` (NOBYPASSRLS, migration 0005) é
//   submetida à policy `tenant_isolation`: SELECTs só enxergam linhas da
//   clínica ativa e INSERTs/UPDATEs com `clinic_id` de outra clínica falham.
//   **Escolha-a sempre que houver contexto de clínica.**
//
// - `dbUnscopedDangerous()` — escape hatch *nominalmente assustador* para
//   operações legitimamente cross-clinic: lookup por e-mail no signup/login,
//   escrita de `audit_log` system-level (clinic_id NULL), leitura de `users`
//   na home do profissional. O nome é grep-detectável por design — o lint
//   `no-direct-db-import` (commit E) vai bloquear novas adições fora de uma
//   allowlist. Roda como a role de sessão (owner/superuser) — BYPASSA RLS.
//
// - `withRowSecurityOff(fn)` — varreduras administrativas que precisam
//   atravessar a fronteira de tenant em LEITURA OU ESCRITA (retention sweep).
//   Roda como a role de sessão também, mas em uma transação dedicada para
//   compor múltiplos statements com rollback. Nome mantido por intenção:
//   "RLS desligado nesta transação" expressa o blast radius melhor que
//   "transação como superuser".
//
// Removido: `getPool()`. Era o vetor #1 de cross-tenant leak; agora cada
// callsite tem que escolher *qual* das três primitivas usar, e a revisão
// pré-merge consegue auditar por grep.
import { Pool, type PoolClient } from 'pg'

let pool: Pool | undefined

function internalPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return pool
}

// UUID v4-ish — não valida versão exata; basta rejeitar entrada não-UUID antes
// de mandar pro `set_config` para evitar SQL injection via parâmetro (mesmo
// que `set_config` já use parametrização).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ClinicScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClinicScopeError'
  }
}

/**
 * Executa `fn` em uma transação com `app.clinic_id` setado para `clinicId`.
 * Toda query dentro de `fn` está sujeita à policy RLS `tenant_isolation`
 * (migration 0005) — linhas de outras clínicas ficam invisíveis e INSERTs
 * com `clinic_id` de outra clínica são rejeitados pelo banco.
 *
 * `clinicId` precisa vir validado (membership ativa) — esta camada NÃO checa
 * autorização, só escopa. O middleware do commit C valida membership antes
 * de chamar esta função.
 */
export async function withClinicScope<T>(
  clinicId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  if (typeof clinicId !== 'string' || !UUID_RE.test(clinicId)) {
    throw new ClinicScopeError('withClinicScope: clinicId must be a UUID')
  }
  const client = await internalPool().connect()
  try {
    await client.query('BEGIN')
    // 1) Troca para `agenda_app` (NOBYPASSRLS). Sem isso, a role de sessão
    //    (owner/superuser) bypassa a policy `tenant_isolation` e RLS vira
    //    teatro. `SET LOCAL ROLE` reverte no COMMIT/ROLLBACK.
    await client.query('SET LOCAL ROLE "agenda_app"')
    // 2) Seta o contexto de tenant. `set_config(name, value, is_local=true)`
    //    = `SET LOCAL`, mas parametrizável (postgres rejeita placeholder em
    //    SET puro). Local = só vale dentro da transação corrente.
    await client.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    // Best-effort rollback; se a conexão já caiu, ignora.
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Pool sem escopo de tenant — use APENAS para operações cross-clinic
 * legítimas. Toda chamada é auditada manualmente pré-merge e (commit E) por
 * lint custom.
 *
 * Lista atual de usos válidos:
 *   - signup/login: lookup de e-mail em `users` (sem clínica ainda)
 *   - recordAudit system-level: `clinic_id IS NULL`
 *   - getProfessionalProfile/update/delete: `users` não tem clinic_id
 *
 * Lista de usos INVÁLIDOS (mover para `withClinicScope` ou criar feature
 * própria):
 *   - qualquer SELECT de patients/appointments/medical_records
 *   - qualquer leitura de audit_log/consents COM filtro por subject de paciente
 *   - varredura cross-clinic: usar `withRowSecurityOff`
 */
export function dbUnscopedDangerous(): Pool {
  return internalPool()
}

/**
 * Transação cross-clinic para varreduras administrativas (retention sweep,
 * exports agregados futuros). Roda como a role de sessão (owner/superuser),
 * que BYPASSA RLS por default — o `SET LOCAL row_security = off` é defensivo
 * caso o callsite tenha trocado de role antes.
 *
 * O nome é grep-detectável por design — toda chamada é uma cross-clinic
 * exception revisada na pre-merge.
 */
export async function withRowSecurityOff<T>(
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await internalPool().connect()
  try {
    await client.query('BEGIN')
    // Defensivo: se a sessão pertencer a uma role NOBYPASSRLS no futuro,
    // este SET LOCAL ainda desliga RLS (a role precisa ser owner da tabela).
    await client.query('SET LOCAL row_security = off')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Apenas para testes integrados que precisam descer no pool diretamente
// (criar/limpar schema). NUNCA importar de código de produção.
export function __resetPoolForTests(): void {
  if (pool) {
    void pool.end()
    pool = undefined
  }
}
