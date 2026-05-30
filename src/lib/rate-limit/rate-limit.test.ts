import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rateLimit } from './index'
import { InMemoryFixedWindowStore } from './store'

describe('rateLimit (in-memory fixed window)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-30T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests below the limit and reports remaining', () => {
    const store = new InMemoryFixedWindowStore()
    const first = rateLimit({ key: 'k', limit: 3, windowSec: 60, store })
    const second = rateLimit({ key: 'k', limit: 3, windowSec: 60, store })

    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(2)
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(1)
  })

  it('blocks once the limit is exceeded and returns Retry-After', () => {
    const store = new InMemoryFixedWindowStore()
    for (let i = 0; i < 3; i++) {
      rateLimit({ key: 'k', limit: 3, windowSec: 60, store })
    }
    const blocked = rateLimit({ key: 'k', limit: 3, windowSec: 60, store })

    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('isolates buckets per key', () => {
    const store = new InMemoryFixedWindowStore()
    for (let i = 0; i < 3; i++) {
      rateLimit({ key: 'a', limit: 3, windowSec: 60, store })
    }
    const otherKey = rateLimit({ key: 'b', limit: 3, windowSec: 60, store })

    expect(otherKey.allowed).toBe(true)
    expect(otherKey.remaining).toBe(2)
  })

  it('resets the window when it expires', () => {
    const store = new InMemoryFixedWindowStore()
    for (let i = 0; i < 3; i++) {
      rateLimit({ key: 'k', limit: 3, windowSec: 60, store })
    }
    expect(rateLimit({ key: 'k', limit: 3, windowSec: 60, store }).allowed).toBe(false)

    vi.advanceTimersByTime(61_000)

    const afterReset = rateLimit({ key: 'k', limit: 3, windowSec: 60, store })
    expect(afterReset.allowed).toBe(true)
    expect(afterReset.remaining).toBe(2)
  })
})
