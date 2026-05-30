// AGM-24 commit D — testes do endpoint `POST /api/internal/tenant-check`.
//
// Cobre:
//  - 400 sem header `x-internal-call: 1` (anti hit casual)
//  - 400 com body inválido (JSON malformado, campos faltando, UUID errado)
//  - 200 quando revalidateTenant retorna ok=true
//  - 401 quando session_revoked_or_expired + audit denied gravado
//  - 403 quando membership_revoked + audit denied gravado
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

type RevalidationOutcome =
  | { ok: true }
  | { ok: false; reason: 'session_revoked_or_expired' | 'membership_revoked' | 'invalid_input' }

const revalidateMock = vi.fn<() => Promise<RevalidationOutcome>>(async () => ({ ok: true }))
vi.mock('@/lib/http/tenant-revalidation', () => ({
  revalidateTenant: () => revalidateMock(),
}))

const auditMock = vi.fn<(input: unknown) => Promise<void>>(async () => {})
vi.mock('@/lib/lgpd/audit', () => ({ recordAudit: (input: unknown) => auditMock(input) }))

const USER = 'prof-1'
const JTI = '11111111-1111-4111-8111-111111111111'
const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'

function buildRequest(
  body: unknown,
  init?: { headers?: Record<string, string> },
): Request {
  return new Request('http://localhost/api/internal/tenant-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-call': '1',
      'x-forwarded-for': '203.0.113.42',
      ...(init?.headers ?? {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  revalidateMock.mockReset()
  revalidateMock.mockResolvedValue({ ok: true })
  auditMock.mockReset()
  auditMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/internal/tenant-check', () => {
  it('returns 400 without x-internal-call header', async () => {
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const req = buildRequest(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { headers: { 'x-internal-call': '' } },
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when body is malformed JSON', async () => {
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const res = await POST(buildRequest('not-json'))
    expect(res.status).toBe(400)
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when activeClinicId is non-UUID and non-null', async () => {
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const res = await POST(buildRequest({ userId: USER, jti: JTI, activeClinicId: 'x' }))
    expect(res.status).toBe(400)
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when userId or jti missing', async () => {
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const a = await POST(buildRequest({ jti: JTI, activeClinicId: null }))
    const b = await POST(buildRequest({ userId: USER, activeClinicId: null }))
    expect(a.status).toBe(400)
    expect(b.status).toBe(400)
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('returns 200 when revalidation succeeds', async () => {
    revalidateMock.mockResolvedValueOnce({ ok: true })
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const res = await POST(buildRequest({ userId: USER, jti: JTI, activeClinicId: CLINIC_A }))
    expect(res.status).toBe(200)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('returns 200 with activeClinicId=null and skips audit', async () => {
    revalidateMock.mockResolvedValueOnce({ ok: true })
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const res = await POST(buildRequest({ userId: USER, jti: JTI, activeClinicId: null }))
    expect(res.status).toBe(200)
  })

  it('returns 401 + audit denied for session_revoked_or_expired', async () => {
    revalidateMock.mockResolvedValueOnce({
      ok: false,
      reason: 'session_revoked_or_expired',
    })
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const res = await POST(buildRequest({ userId: USER, jti: JTI, activeClinicId: CLINIC_A }))
    expect(res.status).toBe(401)
    expect(auditMock).toHaveBeenCalledTimes(1)
    const audit = auditMock.mock.calls[0][0] as {
      action: string
      outcome: string
      reason: string
      metadata: { jti: string; attemptedClinicId: string | null }
    }
    expect(audit.action).toBe('session.tenant.revalidate')
    expect(audit.outcome).toBe('denied')
    expect(audit.reason).toBe('session_revoked_or_expired')
    expect(audit.metadata.jti).toBe(JTI)
    expect(audit.metadata.attemptedClinicId).toBe(CLINIC_A)
  })

  it('returns 403 + audit denied for membership_revoked', async () => {
    revalidateMock.mockResolvedValueOnce({
      ok: false,
      reason: 'membership_revoked',
    })
    const { POST } = await import('@/app/api/internal/tenant-check/route')
    const res = await POST(buildRequest({ userId: USER, jti: JTI, activeClinicId: CLINIC_A }))
    expect(res.status).toBe(403)
    expect(auditMock).toHaveBeenCalledTimes(1)
    const audit = auditMock.mock.calls[0][0] as { reason: string }
    expect(audit.reason).toBe('membership_revoked')
  })
})
