// AGM-24 commit C — testes de `requireActiveClinic`.
//
// Cobre a invariante #2 do plan (gate failure-closed): sem clínica ativa, o
// helper *lança* — handler nunca recebe undefined e consegue mapear para 401/403.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSession = {
  user: { id: string; email?: string }
  activeClinicId: string | null
} | null

const authMock = vi.fn<() => Promise<FakeSession>>(async () => null)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  authMock.mockReset()
  authMock.mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requireActiveClinic', () => {
  it('throws NotAuthenticatedError when no session', async () => {
    authMock.mockResolvedValueOnce(null)
    const { requireActiveClinic, NotAuthenticatedError } = await import(
      '@/lib/http/tenant-guard'
    )
    await expect(requireActiveClinic()).rejects.toBeInstanceOf(NotAuthenticatedError)
  })

  it('throws NoActiveClinicError when session has no activeClinicId', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'prof-1' },
      activeClinicId: null,
    })
    const { requireActiveClinic, NoActiveClinicError } = await import(
      '@/lib/http/tenant-guard'
    )
    await expect(requireActiveClinic()).rejects.toBeInstanceOf(NoActiveClinicError)
  })

  it('returns userId + clinicId when both present', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'prof-1' },
      activeClinicId: CLINIC_A,
    })
    const { requireActiveClinic } = await import('@/lib/http/tenant-guard')
    const got = await requireActiveClinic()
    expect(got).toEqual({ userId: 'prof-1', clinicId: CLINIC_A })
  })
})
