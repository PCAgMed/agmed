// AGM-24 commit D — revalidação per-request.
//
// O middleware Edge chama um Node route (`/api/internal/tenant-check`) a cada
// request autenticada. Essa rota usa este módulo para checar dois invariantes:
//
//   1. A sessão (jti) está ativa: não revogada + não expirada.
//   2. Se há `activeClinicId` no JWT, a membership do user nessa clínica
//      ainda está ativa.
//
// Falha de qualquer um ⇒ deny. SecEng brief: "toda requisição re-valida que
// existe `clinic_memberships WHERE user_id=? AND clinic_id=? AND status='active'`".
//
// Cache:
//  - Sucesso ⇒ memoizado por TTL curto (60s) — limita o DB load a ~1
//    query/min por (user, clinic) ativo. Janela de revogação ≤ 60s, dentro
//    da SLA "near-immediate revocation".
//  - Falha (denial) ⇒ NUNCA memoizada — sempre re-checa, e cada denial vira
//    audit_log (caller registra). Memoizar denials abriria janela de uso
//    pós-revogação se a row voltasse "ativa".
//
// Sem dependência de runtime Edge: este arquivo é Node-only (usa pg). Edge
// chama via fetch interno.
import { getActiveMembership } from '@/lib/clinics/membership'
import { lookupActiveSession } from '@/lib/auth/sessions'

export type RevalidationOutcome =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'session_revoked_or_expired'
        | 'membership_revoked'
        | 'invalid_input'
    }

export type RevalidationInput = {
  userId: string
  jti: string
  activeClinicId: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// LRU-ish cache simples — não usamos lib externa porque o footprint é
// pequeno (~1 entrada por sessão ativa) e queremos zero dependência nova
// na camada de auth. Eviction por capacidade ou TTL, o que vier primeiro.
//
// Capacidade default: 5000 entradas. Em produção uma instância pequena
// (50 usuários simultâneos × 1 clínica ativa = 50 entradas) opera com
// folga; o ceiling protege contra leak em caso de tráfego anormal.
export const REVALIDATION_TTL_MS = 60_000
const DEFAULT_CAPACITY = 5000

type CacheEntry = { value: { ok: true }; expiresAt: number }

function makeKey(userId: string, jti: string, clinicId: string | null): string {
  return `${userId}|${jti}|${clinicId ?? ''}`
}

export class RevalidationCache {
  private store = new Map<string, CacheEntry>()

  constructor(
    private readonly capacity: number = DEFAULT_CAPACITY,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = REVALIDATION_TTL_MS,
  ) {}

  get(userId: string, jti: string, clinicId: string | null): { ok: true } | null {
    const key = makeKey(userId, jti, clinicId)
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key)
      return null
    }
    // LRU: re-insere pra mover ao fim da iteração order do Map.
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  set(userId: string, jti: string, clinicId: string | null): void {
    const key = makeKey(userId, jti, clinicId)
    if (this.store.size >= this.capacity && !this.store.has(key)) {
      // Evict o mais antigo (primeira chave do Map em insertion order).
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, { value: { ok: true }, expiresAt: this.now() + this.ttlMs })
  }

  invalidate(userId: string, jti: string, clinicId: string | null): void {
    this.store.delete(makeKey(userId, jti, clinicId))
  }

  clear(): void {
    this.store.clear()
  }

  size(): number {
    return this.store.size
  }
}

// Cache singleton do processo. Tests podem instanciar `RevalidationCache`
// próprios e injetar via `revalidateTenant(input, { cache })`.
const defaultCache = new RevalidationCache()

export type RevalidationDeps = {
  cache?: RevalidationCache
  lookupSession?: typeof lookupActiveSession
  lookupMembership?: typeof getActiveMembership
}

/**
 * Roda revalidação per-request. Retorna `{ ok: true }` no caminho feliz e
 * `{ ok: false, reason }` em qualquer denial.
 *
 * Caller (route `/api/internal/tenant-check`) traduz `ok=false` em HTTP
 * 401/403 e dispara audit `session.tenant.revalidate` com `outcome='denied'`.
 */
export async function revalidateTenant(
  input: RevalidationInput,
  deps: RevalidationDeps = {},
): Promise<RevalidationOutcome> {
  const { userId, jti, activeClinicId } = input

  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, reason: 'invalid_input' }
  }
  if (typeof jti !== 'string' || jti.length === 0) {
    return { ok: false, reason: 'invalid_input' }
  }
  if (activeClinicId !== null && (typeof activeClinicId !== 'string' || !UUID_RE.test(activeClinicId))) {
    return { ok: false, reason: 'invalid_input' }
  }

  const cache = deps.cache ?? defaultCache
  const cached = cache.get(userId, jti, activeClinicId)
  if (cached) return cached

  const lookupSession = deps.lookupSession ?? lookupActiveSession
  const lookupMembership = deps.lookupMembership ?? getActiveMembership

  const session = await lookupSession({ userId, jti })
  if (!session) {
    return { ok: false, reason: 'session_revoked_or_expired' }
  }

  if (activeClinicId !== null) {
    const membership = await lookupMembership(userId, activeClinicId)
    if (!membership) {
      return { ok: false, reason: 'membership_revoked' }
    }
  }

  const ok = { ok: true as const }
  cache.set(userId, jti, activeClinicId)
  return ok
}

// Exposto pra testes e pra eventual hook de invalidação (e.g. logout
// chama `revokeSessionByJti` + `invalidateRevalidationCache({ userId, jti })`).
export function getDefaultRevalidationCache(): RevalidationCache {
  return defaultCache
}
