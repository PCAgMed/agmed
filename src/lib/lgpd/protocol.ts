import { customAlphabet } from 'nanoid'

// Human-readable, copy-pasteable protocol id returned to the titular in every
// receipt. Format: LGPD-YYYYMMDD-XXXXXXXX where XXXXXXXX is base32 [0-9A-Z]
// without lookalikes. Used as a foreign reference into audit_log for
// support/regulator follow-ups.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const randomSuffix = customAlphabet(ALPHABET, 8)

export function generateProtocol(now: Date = new Date()): string {
  const yyyymmdd =
    now.getUTCFullYear().toString().padStart(4, '0') +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0')
  return `LGPD-${yyyymmdd}-${randomSuffix()}`
}
