import { NextResponse } from 'next/server'
import { childLogger } from '@/lib/observability/logger'
import { getDefaultStore, type RateLimitStore } from './store'

export interface RateLimitOptions {
  key: string
  limit: number
  windowSec: number
  store?: RateLimitStore
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
  retryAfterSec: number
}

export function rateLimit({
  key,
  limit,
  windowSec,
  store = getDefaultStore(),
}: RateLimitOptions): RateLimitResult {
  const { count, resetAt } = store.hit(key, windowSec * 1000)
  const allowed = count <= limit
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    limit,
    resetAt,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  }
}

interface BlockContext {
  endpoint: string
  reason: string
  keyClass: 'ip' | 'email' | 'ip+email' | 'other'
}

// Loki query target: `count by (endpoint, reason) (rate({event="rate_limit.block"}[1m]))`.
// We emit it as a structured log line instead of a Prometheus counter since
// we don't have a metrics endpoint yet — see ADR-0001.
export function logRateLimitBlock(ctx: BlockContext & { result: RateLimitResult }): void {
  childLogger({ component: 'rate-limit' }).warn(
    {
      event: 'rate_limit.block',
      endpoint: ctx.endpoint,
      reason: ctx.reason,
      keyClass: ctx.keyClass,
      retryAfterSec: ctx.result.retryAfterSec,
      resetAt: new Date(ctx.result.resetAt).toISOString(),
    },
    'request blocked by rate limit',
  )
}

export interface BlockedResponseOptions {
  retryAfterSec: number
  message?: string
}

export function rateLimitedResponse({
  retryAfterSec,
  message = 'Muitas requisições. Tente novamente mais tarde.',
}: BlockedResponseOptions): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSec) },
    },
  )
}
