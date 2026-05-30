// AGM-24 commit D — testes do helper `revalidateTenant`.
//
// Cobre os caminhos críticos:
//  - sessão revogada/expirada ⇒ ok=false, reason=session_revoked_or_expired
//  - membership ausente ⇒ ok=false, reason=membership_revoked
//  - cache: hit dentro da janela TTL não chama lookup
//  - cache: NÃO memoiza denial (cada denial re-checa o DB)
//  - input inválido (não-string/UUID) ⇒ invalid_input sem hit no DB
//  - activeClinicId=null pula a checagem de membership
import { describe, expect, it, vi } from 'vitest'
import {
  revalidateTenant,
  RevalidationCache,
  REVALIDATION_TTL_MS,
} from '@/lib/http/tenant-revalidation'

const USER = 'prof-1'
const JTI = '11111111-1111-4111-8111-111111111111'
const CLINIC_A = '00000000-0000-0000-0000-00000000aaaa'

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    userId: USER,
    jti: JTI,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    revokedReason: null,
    lastSeenAt: null,
    ip: null,
    userAgentHash: null,
    ...overrides,
  }
}

function fakeMembership() {
  return {
    membershipId: 'm-1',
    userId: USER,
    clinicId: CLINIC_A,
    role: 'owner' as const,
  }
}

describe('revalidateTenant', () => {
  it('returns ok=true for active session + active membership', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => fakeMembership())
    const cache = new RevalidationCache()

    const out = await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    expect(out).toEqual({ ok: true })
    expect(lookupSession).toHaveBeenCalledWith({ userId: USER, jti: JTI })
    expect(lookupMembership).toHaveBeenCalledWith(USER, CLINIC_A)
  })

  it('returns ok=true with no activeClinicId (no membership check)', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => null)
    const cache = new RevalidationCache()

    const out = await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: null },
      { cache, lookupSession, lookupMembership },
    )
    expect(out).toEqual({ ok: true })
    expect(lookupMembership).not.toHaveBeenCalled()
  })

  it('denies when session lookup returns null (revoked or expired)', async () => {
    const lookupSession = vi.fn(async () => null)
    const lookupMembership = vi.fn(async () => fakeMembership())
    const cache = new RevalidationCache()

    const out = await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    expect(out).toEqual({ ok: false, reason: 'session_revoked_or_expired' })
    expect(lookupMembership).not.toHaveBeenCalled()
  })

  it('denies when membership lookup returns null (revoked)', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => null)
    const cache = new RevalidationCache()

    const out = await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    expect(out).toEqual({ ok: false, reason: 'membership_revoked' })
  })

  it('caches success — second call within TTL skips DB lookups', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => fakeMembership())
    const cache = new RevalidationCache()

    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    expect(lookupSession).toHaveBeenCalledTimes(1)
    expect(lookupMembership).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache denial — second call hits DB again', async () => {
    const lookupSession = vi.fn(async () => null)
    const lookupMembership = vi.fn(async () => null)
    const cache = new RevalidationCache()

    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    expect(lookupSession).toHaveBeenCalledTimes(2)
  })

  it('expires cache entries after TTL', async () => {
    let now = 1_000_000
    const cache = new RevalidationCache(1000, () => now, REVALIDATION_TTL_MS)
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => fakeMembership())

    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    now += REVALIDATION_TTL_MS + 1
    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    expect(lookupSession).toHaveBeenCalledTimes(2)
  })

  it('different (userId, jti, clinicId) tuples cache independently', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => fakeMembership())
    const cache = new RevalidationCache()

    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: CLINIC_A },
      { cache, lookupSession, lookupMembership },
    )
    await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: null },
      { cache, lookupSession, lookupMembership },
    )
    // 2 cache misses para 2 chaves distintas
    expect(lookupSession).toHaveBeenCalledTimes(2)
  })

  it('rejects non-UUID activeClinicId (defense vs mass-assignment)', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => fakeMembership())
    const out = await revalidateTenant(
      { userId: USER, jti: JTI, activeClinicId: 'not-a-uuid' },
      { lookupSession, lookupMembership },
    )
    expect(out).toEqual({ ok: false, reason: 'invalid_input' })
    expect(lookupSession).not.toHaveBeenCalled()
  })

  it('rejects empty userId and empty jti', async () => {
    const lookupSession = vi.fn(async () => fakeSession())
    const lookupMembership = vi.fn(async () => fakeMembership())
    const a = await revalidateTenant(
      { userId: '', jti: JTI, activeClinicId: CLINIC_A },
      { lookupSession, lookupMembership },
    )
    const b = await revalidateTenant(
      { userId: USER, jti: '', activeClinicId: CLINIC_A },
      { lookupSession, lookupMembership },
    )
    expect(a).toEqual({ ok: false, reason: 'invalid_input' })
    expect(b).toEqual({ ok: false, reason: 'invalid_input' })
    expect(lookupSession).not.toHaveBeenCalled()
  })
})

describe('RevalidationCache', () => {
  it('evicts oldest entry when capacity is reached', () => {
    let now = 0
    const cache = new RevalidationCache(2, () => now)
    cache.set('u1', 'j1', null)
    now += 1
    cache.set('u2', 'j2', null)
    now += 1
    cache.set('u3', 'j3', null) // evicts u1

    expect(cache.get('u1', 'j1', null)).toBeNull()
    expect(cache.get('u2', 'j2', null)).not.toBeNull()
    expect(cache.get('u3', 'j3', null)).not.toBeNull()
  })

  it('invalidate removes an entry', () => {
    const cache = new RevalidationCache()
    cache.set('u1', 'j1', 'c1')
    expect(cache.get('u1', 'j1', 'c1')).not.toBeNull()
    cache.invalidate('u1', 'j1', 'c1')
    expect(cache.get('u1', 'j1', 'c1')).toBeNull()
  })
})
