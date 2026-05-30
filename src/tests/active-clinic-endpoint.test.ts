// AGM-24 commit C — testes do endpoint `POST /api/session/active-clinic`.
//
// Tested behaviors:
//  - 401 quando não autenticado
//  - 400 com JSON inválido ou clinicId não-UUID
//  - 403 quando membership ativa não existe (DB retorna 0 linhas)
//  - 200 + `unstable_update` chamado quando membership ativa existe
//  - 200 + null quando o caller envia `clinicId: null` (sair de tenant)
//  - Audit registrado em sucesso e em denied
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSession = {
  user: { id: string; email?: string }
  activeClinicId: string | null
} | null

const authMock = vi.fn<() => Promise<FakeSession>>(async () => ({
  user: { id: 'prof-1', email: 'prof@example.com' },
  activeClinicId: null,
}))
const unstableUpdateMock = vi.fn<(data: unknown) => Promise<null>>(async () => null)
vi.mock('@/auth', () => ({
  auth: () => authMock(),
  unstable_update: (data: unknown) => unstableUpdateMock(data),
}))

vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
const queryMock = vi.fn<QueryFn>(async () => ({ rows: [] }))
vi.mock('@/lib/db', () => ({ dbUnscopedDangerous: () => ({ query: queryMock }) }))

const auditMock = vi.fn<(input: unknown) => Promise<void>>(async () => {})
vi.mock('@/lib/lgpd/audit', () => ({ recordAudit: (input: unknown) => auditMock(input) }))

function buildRequest(body: unknown, init?: { headers?: Record<string, string> }): Request {
  return new Request('http://localhost/api/session/active-clinic', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.42',
      ...(init?.headers ?? {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  authMock.mockReset()
  authMock.mockResolvedValue({
    user: { id: 'prof-1', email: 'prof@example.com' },
    activeClinicId: null,
  })
  unstableUpdateMock.mockReset()
  unstableUpdateMock.mockResolvedValue(null)
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rows: [] })
  auditMock.mockReset()
  auditMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/session/active-clinic', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/session/active-clinic/route')
    const res = await POST(buildRequest({ clinicId: CLINIC_A }))
    expect(res.status).toBe(401)
    expect(unstableUpdateMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON body', async () => {
    const { POST } = await import('@/app/api/session/active-clinic/route')
    const res = await POST(buildRequest('not-json'))
    expect(res.status).toBe(400)
    expect(unstableUpdateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when clinicId is neither UUID nor null', async () => {
    const { POST } = await import('@/app/api/session/active-clinic/route')
    const res = await POST(buildRequest({ clinicId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(queryMock).not.toHaveBeenCalled()
    expect(unstableUpdateMock).not.toHaveBeenCalled()
  })

  it('returns 403 + denied audit when no active membership exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    const { POST } = await import('@/app/api/session/active-clinic/route')
    const res = await POST(buildRequest({ clinicId: CLINIC_A }))
    expect(res.status).toBe(403)
    expect(unstableUpdateMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    const audit = auditMock.mock.calls[0][0] as { action: string; outcome: string; reason?: string }
    expect(audit.action).toBe('session.clinic.switch')
    expect(audit.outcome).toBe('denied')
    expect(audit.reason).toBe('no_active_membership')
  })

  it('returns 200 + updates JWT when active membership exists', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'membership-1',
          user_id: 'prof-1',
          clinic_id: CLINIC_A,
          role: 'owner',
        },
      ],
    })
    const { POST } = await import('@/app/api/session/active-clinic/route')
    const res = await POST(buildRequest({ clinicId: CLINIC_A }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { activeClinicId: string; role: string }
    expect(json.activeClinicId).toBe(CLINIC_A)
    expect(json.role).toBe('owner')
    expect(unstableUpdateMock).toHaveBeenCalledTimes(1)
    expect(unstableUpdateMock).toHaveBeenCalledWith({ activeClinicId: CLINIC_A })
    const audit = auditMock.mock.calls[0][0] as { action: string; outcome: string }
    expect(audit.action).toBe('session.clinic.switch')
    expect(audit.outcome).toBe('success')
  })

  it('accepts clinicId=null to clear active tenant (logout-from-clinic)', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'prof-1', email: 'prof@example.com' },
      activeClinicId: CLINIC_A,
    })
    const { POST } = await import('@/app/api/session/active-clinic/route')
    const res = await POST(buildRequest({ clinicId: null }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { activeClinicId: string | null }
    expect(json.activeClinicId).toBeNull()
    expect(unstableUpdateMock).toHaveBeenCalledWith({ activeClinicId: null })
    // Não consulta o DB no caminho de logout-from-clinic.
    expect(queryMock).not.toHaveBeenCalled()
    const audit = auditMock.mock.calls[0][0] as {
      action: string
      outcome: string
      metadata: { from: string | null; to: string | null }
    }
    expect(audit.outcome).toBe('success')
    expect(audit.metadata.from).toBe(CLINIC_A)
    expect(audit.metadata.to).toBeNull()
  })

  it('membership query filters by status=active AND revoked_at IS NULL', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    const { POST } = await import('@/app/api/session/active-clinic/route')
    await POST(buildRequest({ clinicId: CLINIC_A }))
    expect(queryMock).toHaveBeenCalledTimes(1)
    const sql = queryMock.mock.calls[0][0]
    expect(sql).toMatch(/status\s*=\s*'active'/i)
    expect(sql).toMatch(/revoked_at\s+IS\s+NULL/i)
  })
})
