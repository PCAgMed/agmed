// AGM-24 commit C — Finding 3 do audit SE: garantir que erros em
// `withClinicScope` / `withRowSecurityOff` chamam `client.release(err)`
// para o pool descartar a conexão em vez de devolvê-la em estado incerto.
//
// `pg` doc: passar valor truthy para `release()` instrui o pool a destruir
// o client. Em caminhos normais (release sem arg) a conexão volta pro pool;
// se ela voltou em estado corrompido — middle-of-query, transação aberta,
// timeout — pode envenenar a próxima checkout.
//
// Por que unit + mock: o teste de RLS em `clinic-scope.test.ts` exercita o
// caminho de erro contra Postgres real, mas não tem como observar diretamente
// se o cliente foi devolvido com `err`. Aqui mockamos `pg` end-to-end e
// asseguramos o contrato.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ReleaseFn = ((err?: unknown) => void) & { calls: unknown[] }

function makeFakeClient(): {
  query: ReturnType<typeof vi.fn>
  release: ReleaseFn
} {
  const releaseCalls: unknown[] = []
  const release = ((err?: unknown) => {
    releaseCalls.push(err)
  }) as ReleaseFn
  release.calls = releaseCalls
  return {
    query: vi.fn(async () => ({ rows: [] })),
    release,
  }
}

const fakeClient = makeFakeClient()

vi.mock('pg', () => {
  // `new Pool(...)` precisa de constructor real — `vi.fn().mockImplementation`
  // não é construtível. Classe vazia que delega `connect` ao fakeClient.
  class FakePool {
    async connect() {
      return fakeClient
    }
    async end() {
      return undefined
    }
  }
  return { Pool: FakePool }
})

const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  fakeClient.release.calls.length = 0
  fakeClient.query.mockReset()
  fakeClient.query.mockImplementation(async () => ({ rows: [] }))
})

afterEach(() => {
  vi.resetModules()
})

describe('client.release(err) on failure path', () => {
  it('withClinicScope: release() with no arg on success', async () => {
    const { withClinicScope, __resetPoolForTests } = await import('@/lib/db')
    __resetPoolForTests()
    await withClinicScope(CLINIC_A, async () => undefined)
    expect(fakeClient.release.calls).toHaveLength(1)
    expect(fakeClient.release.calls[0]).toBeUndefined()
  })

  it('withClinicScope: release(err) when the callback throws', async () => {
    const { withClinicScope, __resetPoolForTests } = await import('@/lib/db')
    __resetPoolForTests()
    const boom = new Error('boom-fn')
    await expect(
      withClinicScope(CLINIC_A, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(fakeClient.release.calls).toHaveLength(1)
    expect(fakeClient.release.calls[0]).toBe(boom)
  })

  it('withClinicScope: release(err) when a query throws', async () => {
    const { withClinicScope, __resetPoolForTests } = await import('@/lib/db')
    __resetPoolForTests()
    const boom = new Error('boom-query')
    fakeClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) throw boom
      return { rows: [] }
    })
    await expect(withClinicScope(CLINIC_A, async () => undefined)).rejects.toBe(boom)
    expect(fakeClient.release.calls).toHaveLength(1)
    expect(fakeClient.release.calls[0]).toBe(boom)
  })

  it('withRowSecurityOff: release(err) when the callback throws', async () => {
    const { withRowSecurityOff, __resetPoolForTests } = await import('@/lib/db')
    __resetPoolForTests()
    const boom = new Error('boom-rsoff')
    await expect(
      withRowSecurityOff(async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(fakeClient.release.calls).toHaveLength(1)
    expect(fakeClient.release.calls[0]).toBe(boom)
  })

  it('withRowSecurityOff: release() with no arg on success', async () => {
    const { withRowSecurityOff, __resetPoolForTests } = await import('@/lib/db')
    __resetPoolForTests()
    await withRowSecurityOff(async () => undefined)
    expect(fakeClient.release.calls).toHaveLength(1)
    expect(fakeClient.release.calls[0]).toBeUndefined()
  })

  it('non-Error throws still result in release(err) being called', async () => {
    const { withClinicScope, __resetPoolForTests } = await import('@/lib/db')
    __resetPoolForTests()
    await expect(
      withClinicScope(CLINIC_A, async () => {
        throw 'string-not-error'
      }),
    ).rejects.toBe('string-not-error')
    expect(fakeClient.release.calls).toHaveLength(1)
    const arg = fakeClient.release.calls[0]
    expect(arg).toBeInstanceOf(Error)
    expect((arg as Error).message).toBe('string-not-error')
  })
})
