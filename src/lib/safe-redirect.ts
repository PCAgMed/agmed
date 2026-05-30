// Allowlist of internal paths that are safe to redirect to after auth flows.
// Anything outside the allowlist falls back to DEFAULT_REDIRECT so a crafted
// `?callbackUrl=...` parameter cannot send users to an attacker-controlled host.
const ALLOWED_PATHS: RegExp[] = [
  /^\/dashboard(\/.*)?$/,
  /^\/agenda(\/.*)?$/,
  /^\/patients(\/.*)?$/,
]

export const DEFAULT_REDIRECT = '/dashboard'

export function safeCallback(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT
  if (!raw.startsWith('/')) return DEFAULT_REDIRECT
  // Protocol-relative URLs (//evil.com) resolve to a foreign origin.
  if (raw.startsWith('//')) return DEFAULT_REDIRECT
  // Backslashes can be normalised to '/' by some clients, re-enabling //evil.com.
  if (raw.includes('\\')) return DEFAULT_REDIRECT
  const pathname = raw.split('?', 1)[0].split('#', 1)[0]
  if (!ALLOWED_PATHS.some((re) => re.test(pathname))) return DEFAULT_REDIRECT
  return raw
}
