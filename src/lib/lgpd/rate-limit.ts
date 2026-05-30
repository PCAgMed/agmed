import { logRateLimitBlock, rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// Limites por endpoint LGPD. Numbers conservadores para mitigar R4 (exfiltração)
// do RIPD §6.2 sem prejudicar o uso legítimo (titular raramente exerce mais de
// um direito por minuto). Window por usuário, com fallback por IP para o
// caso anônimo (nunca deveria atingir, mas defesa em profundidade).
export const LGPD_LIMITS = {
  // Leituras leves (acesso, subprocessadores)
  read: { limit: 30, windowSec: 60 },
  // Mutaçoes baratas (patch perfil, revoke consent)
  mutate: { limit: 10, windowSec: 60 },
  // Operações pesadas / sensíveis (export, delete)
  heavy: { limit: 3, windowSec: 60 * 60 },
}

export type LgpdLimit = keyof typeof LGPD_LIMITS

// Combina limite por usuário e por IP. Retorna a Response 429 já formatada se
// algum estourar, ou null para deixar o handler seguir.
export function enforceLgpdRateLimit(
  req: Request,
  userId: string,
  endpoint: string,
  bucket: LgpdLimit,
): Response | null {
  const cfg = LGPD_LIMITS[bucket]
  const ip = getClientIp(req)

  const userResult = rateLimit({ key: `lgpd:user:${userId}:${endpoint}`, ...cfg })
  if (!userResult.allowed) {
    logRateLimitBlock({
      endpoint,
      reason: `user:${bucket}`,
      keyClass: 'other',
      result: userResult,
    })
    return rateLimitedResponse({ retryAfterSec: userResult.retryAfterSec })
  }

  const ipResult = rateLimit({ key: `lgpd:ip:${ip}:${endpoint}`, ...cfg })
  if (!ipResult.allowed) {
    logRateLimitBlock({
      endpoint,
      reason: `ip:${bucket}`,
      keyClass: 'ip',
      result: ipResult,
    })
    return rateLimitedResponse({ retryAfterSec: ipResult.retryAfterSec })
  }

  return null
}
