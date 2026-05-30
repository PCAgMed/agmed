// AGM-24 commit D — LOW-1 do audit SE: cobertura direta do callback
// `jwt({ trigger: 'update' })` em `src/auth.ts`. O teste de endpoint
// (`active-clinic-endpoint.test.ts`) mocka `unstable_update` e não chega a
// executar o caminho de revalidação — sem cobertura direta, refatorações
// futuras silenciosamente erodem a defesa em profundidade.
//
// Casos cobertos:
//  - sign-in (com `user`): id copiado + activeClinicId = null.
//  - trigger 'update' com clinicId null: zera o claim sem chamar lookup.
//  - trigger 'update' com clinicId UUID válido + membership ativa: claim
//    gravado a partir do retorno do lookup (defesa: usa o clinicId do row,
//    não o do session — protege contra mismatch).
//  - trigger 'update' com clinicId UUID válido mas SEM membership ativa
//    (lookup retorna null): claim NÃO é alterado (silent drop).
//  - trigger 'update' sem token.id (sessão sem id): pula lookup, claim
//    intacto. Failure-closed.
//  - trigger != 'update' com session no payload: ignora, claim intacto.
//  - trigger 'update' com candidate não-string e não-null: ignora, claim
//    intacto (mass-assignment defense).
import { describe, expect, it, vi } from 'vitest'
import { jwtCallback } from '@/lib/auth/jwt-callback'

const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'
const CLINIC_B = '00000000-0000-0000-0000-00000000bbbb'

describe('jwtCallback (re-validation defense in depth)', () => {
  it('sign-in initializes token.id + activeClinicId=null', async () => {
    const lookup = vi.fn(async () => null)
    const token: Record<string, unknown> = {}
    const out = await jwtCallback(
      { token, user: { id: 'prof-1' }, trigger: 'signIn' },
      lookup,
    )
    expect(out.id).toBe('prof-1')
    expect(out.activeClinicId).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it("trigger='update' with activeClinicId=null clears the claim without lookup", async () => {
    const lookup = vi.fn(async () => null)
    const token = { id: 'prof-1', activeClinicId: CLINIC_A }
    const out = await jwtCallback(
      { token, trigger: 'update', session: { activeClinicId: null } },
      lookup,
    )
    expect(out.activeClinicId).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it("trigger='update' with valid UUID + active membership writes the claim from the lookup result", async () => {
    const lookup = vi.fn(async () => ({
      membershipId: 'm-1',
      userId: 'prof-1',
      clinicId: CLINIC_A,
      role: 'owner' as const,
    }))
    const token = { id: 'prof-1' }
    const out = await jwtCallback(
      { token, trigger: 'update', session: { activeClinicId: CLINIC_A } },
      lookup,
    )
    expect(lookup).toHaveBeenCalledWith('prof-1', CLINIC_A)
    expect(out.activeClinicId).toBe(CLINIC_A)
  })

  it('uses clinicId from the LOOKUP row, not from session (mismatch defense)', async () => {
    // Defense in depth: se o lookup retornasse uma row com clinicId diferente
    // do candidate (cenário improvável mas defensivo — DB poderia mudar entre
    // queries), o claim segue o que o DB diz, não o que o caller pediu.
    const lookup = vi.fn(async () => ({
      membershipId: 'm-1',
      userId: 'prof-1',
      clinicId: CLINIC_B,
      role: 'doctor' as const,
    }))
    const token = { id: 'prof-1' }
    const out = await jwtCallback(
      { token, trigger: 'update', session: { activeClinicId: CLINIC_A } },
      lookup,
    )
    expect(out.activeClinicId).toBe(CLINIC_B)
  })

  it("trigger='update' with valid UUID but NO active membership silently drops (claim intact)", async () => {
    const lookup = vi.fn(async () => null)
    const token = { id: 'prof-1', activeClinicId: CLINIC_B }
    const out = await jwtCallback(
      { token, trigger: 'update', session: { activeClinicId: CLINIC_A } },
      lookup,
    )
    expect(lookup).toHaveBeenCalledWith('prof-1', CLINIC_A)
    // Claim NÃO foi alterado — endpoint já respondeu 403; aqui só protege
    // contra abuso. `activeClinicId` mantém o valor anterior do JWT (B).
    expect(out.activeClinicId).toBe(CLINIC_B)
  })

  it("trigger='update' without token.id skips lookup (failure-closed)", async () => {
    const lookup = vi.fn(async () => null)
    const token: Record<string, unknown> = { activeClinicId: CLINIC_A }
    const out = await jwtCallback(
      { token, trigger: 'update', session: { activeClinicId: CLINIC_A } },
      lookup,
    )
    expect(lookup).not.toHaveBeenCalled()
    expect(out.activeClinicId).toBe(CLINIC_A)
  })

  it("trigger != 'update' (e.g., signIn refresh) does not re-validate", async () => {
    const lookup = vi.fn(async () => null)
    const token = { id: 'prof-1', activeClinicId: CLINIC_A }
    const out = await jwtCallback(
      { token, trigger: 'signIn', session: { activeClinicId: CLINIC_B } },
      lookup,
    )
    expect(lookup).not.toHaveBeenCalled()
    expect(out.activeClinicId).toBe(CLINIC_A)
  })

  it("trigger='update' with non-string non-null candidate is ignored (mass-assignment defense)", async () => {
    const lookup = vi.fn(async () => null)
    const token = { id: 'prof-1', activeClinicId: CLINIC_A }
    // Caller envia algo absurdo no payload — número, objeto, array. JWT claim
    // não deve mudar e o lookup não deve ser chamado.
    for (const bad of [123, true, ['x'], { x: 1 }]) {
      lookup.mockClear()
      const out = await jwtCallback(
        { token, trigger: 'update', session: { activeClinicId: bad } },
        lookup,
      )
      expect(lookup).not.toHaveBeenCalled()
      expect(out.activeClinicId).toBe(CLINIC_A)
    }
  })

  it("trigger='update' with session=null or non-object is ignored", async () => {
    const lookup = vi.fn(async () => null)
    const token = { id: 'prof-1', activeClinicId: CLINIC_A }
    for (const bad of [null, undefined, 'string', 42]) {
      lookup.mockClear()
      const out = await jwtCallback(
        { token, trigger: 'update', session: bad },
        lookup,
      )
      expect(lookup).not.toHaveBeenCalled()
      expect(out.activeClinicId).toBe(CLINIC_A)
    }
  })
})
