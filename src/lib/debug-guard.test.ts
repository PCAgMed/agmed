import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDebugAllowed } from './debug-guard'
import { GET as throwRoute } from '@/app/api/debug/throw/route'

function clearDebugEnv() {
  vi.stubEnv('NODE_ENV', '')
  vi.stubEnv('APP_ENV', '')
  vi.stubEnv('DEBUG_THROW_ENABLED', '')
}

describe('assertDebugAllowed', () => {
  beforeEach(() => {
    clearDebugEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 404 when NODE_ENV=production even if DEBUG_THROW_ENABLED=true', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'true')

    const res = assertDebugAllowed()

    expect(res).not.toBeNull()
    expect(res?.status).toBe(404)
    await expect(res?.json()).resolves.toEqual({ error: 'disabled' })
  })

  it('returns 404 when APP_ENV=production even if DEBUG_THROW_ENABLED=true', async () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'true')

    const res = assertDebugAllowed()

    expect(res?.status).toBe(404)
    await expect(res?.json()).resolves.toEqual({ error: 'disabled' })
  })

  it('returns null (allowed) when NODE_ENV=development and DEBUG_THROW_ENABLED=true', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'true')

    expect(assertDebugAllowed()).toBeNull()
  })

  it('returns 404 when DEBUG_THROW_ENABLED is unset', () => {
    vi.stubEnv('NODE_ENV', 'development')

    const res = assertDebugAllowed()
    expect(res?.status).toBe(404)
  })

  it('returns 404 when DEBUG_THROW_ENABLED=false', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'false')

    const res = assertDebugAllowed()
    expect(res?.status).toBe(404)
  })
})

describe('/api/debug/throw route', () => {
  beforeEach(() => {
    clearDebugEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 404 in production even if the flag is true', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'true')

    const res = await throwRoute()
    expect(res.status).toBe(404)
  })

  it('throws (→ 500 in Next.js) in development when the flag is true', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'true')

    await expect(throwRoute()).rejects.toThrow(/intentional debug throw/)
  })

  it('returns 404 when the flag is false', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEBUG_THROW_ENABLED', 'false')

    const res = await throwRoute()
    expect(res.status).toBe(404)
  })
})
