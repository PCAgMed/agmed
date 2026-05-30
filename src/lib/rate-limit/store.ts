export interface RateLimitHit {
  count: number
  resetAt: number
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): RateLimitHit
  reset(key: string): void
  size(): number
}

interface Bucket {
  count: number
  resetAt: number
}

// Fixed-window counter. Sufficient for per-instance baseline; replace with
// a sliding window or Redis-backed store once we go multi-instance.
export class InMemoryFixedWindowStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>()
  private lastSweep = 0
  private readonly sweepIntervalMs: number

  constructor(opts: { sweepIntervalMs?: number } = {}) {
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 60_000
  }

  hit(key: string, windowMs: number): RateLimitHit {
    const now = Date.now()
    this.maybeSweep(now)

    const existing = this.buckets.get(key)
    if (!existing || existing.resetAt <= now) {
      const bucket: Bucket = { count: 1, resetAt: now + windowMs }
      this.buckets.set(key, bucket)
      return { count: bucket.count, resetAt: bucket.resetAt }
    }
    existing.count += 1
    return { count: existing.count, resetAt: existing.resetAt }
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  size(): number {
    return this.buckets.size
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep < this.sweepIntervalMs) return
    this.lastSweep = now
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k)
    }
  }
}

let defaultStore: RateLimitStore | undefined

export function getDefaultStore(): RateLimitStore {
  if (!defaultStore) defaultStore = new InMemoryFixedWindowStore()
  return defaultStore
}

// Test seam: lets tests inject a clean store and avoid cross-test bleed.
export function setDefaultStore(store: RateLimitStore | undefined): void {
  defaultStore = store
}
