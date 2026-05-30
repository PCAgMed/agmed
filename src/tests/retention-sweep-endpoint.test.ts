import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/observability/logger', () => ({
  childLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const runRetentionSweepMock = vi.fn()
vi.mock('@/lib/lgpd/retention-sweep', () => ({
  runRetentionSweep: (...args: unknown[]) => runRetentionSweepMock(...args),
}))

describe('POST /api/internal/retention/sweep', () => {
  const ORIGINAL = process.env.INTERNAL_RETENTION_TOKEN

  beforeEach(() => {
    runRetentionSweepMock.mockReset()
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INTERNAL_RETENTION_TOKEN
    else process.env.INTERNAL_RETENTION_TOKEN = ORIGINAL
  })

  it('returns 503 when token is not configured (fail-closed)', async () => {
    delete process.env.INTERNAL_RETENTION_TOKEN
    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(new Request('http://localhost/api/internal/retention/sweep', { method: 'POST' }))
    expect(res.status).toBe(503)
    expect(runRetentionSweepMock).not.toHaveBeenCalled()
  })

  it('returns 401 with wrong bearer', async () => {
    process.env.INTERNAL_RETENTION_TOKEN = 'right-token'
    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(
      new Request('http://localhost/api/internal/retention/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token' },
      }),
    )
    expect(res.status).toBe(401)
    expect(runRetentionSweepMock).not.toHaveBeenCalled()
  })

  it('returns 401 when authorization header missing', async () => {
    process.env.INTERNAL_RETENTION_TOKEN = 'right-token'
    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(
      new Request('http://localhost/api/internal/retention/sweep', { method: 'POST' }),
    )
    expect(res.status).toBe(401)
  })

  it('runs sweep with dryRun=true when body says so', async () => {
    process.env.INTERNAL_RETENTION_TOKEN = 'right-token'
    runRetentionSweepMock.mockResolvedValue({
      runId: 'r-1',
      startedAt: new Date('2026-06-01T00:00:00Z'),
      endedAt: new Date('2026-06-01T00:00:01Z'),
      dryRun: true,
      actor: 'cron:retention_sweep',
      phases: [],
      totals: { discovered: 0, softDeleted: 0, hardDeleted: 0, errors: 0 },
    })

    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(
      new Request('http://localhost/api/internal/retention/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer right-token', 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; dryRun: boolean }
    expect(body.runId).toBe('r-1')
    expect(body.dryRun).toBe(true)
    expect(runRetentionSweepMock).toHaveBeenCalledWith({ dryRun: true, actor: { kind: 'cron:retention_sweep' } })
  })

  it('runs full sweep when body omitted', async () => {
    process.env.INTERNAL_RETENTION_TOKEN = 'right-token'
    runRetentionSweepMock.mockResolvedValue({
      runId: 'r-2',
      startedAt: new Date(),
      endedAt: new Date(),
      dryRun: false,
      actor: 'cron:retention_sweep',
      phases: [],
      totals: { discovered: 0, softDeleted: 0, hardDeleted: 0, errors: 0 },
    })
    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(
      new Request('http://localhost/api/internal/retention/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer right-token' },
      }),
    )
    expect(res.status).toBe(200)
    expect(runRetentionSweepMock).toHaveBeenCalledWith({ dryRun: false, actor: { kind: 'cron:retention_sweep' } })
  })

  it('returns 400 on invalid JSON body', async () => {
    process.env.INTERNAL_RETENTION_TOKEN = 'right-token'
    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(
      new Request('http://localhost/api/internal/retention/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer right-token', 'content-type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(res.status).toBe(400)
    expect(runRetentionSweepMock).not.toHaveBeenCalled()
  })

  it('returns 500 when sweep throws catastrophically', async () => {
    process.env.INTERNAL_RETENTION_TOKEN = 'right-token'
    runRetentionSweepMock.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/internal/retention/sweep/route')
    const res = await POST(
      new Request('http://localhost/api/internal/retention/sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer right-token' },
      }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('sweep_failed')
    expect(body.message).toContain('db down')
  })
})
