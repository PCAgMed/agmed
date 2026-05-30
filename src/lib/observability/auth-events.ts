import { childLogger } from './logger'

// Stable event names for the auth surface. Grafana/Loki queries pin against
// these literals, so do not rename without searching for callers.
export type AuthEventName =
  | 'auth.signup.attempt'
  | 'auth.signup.success'
  | 'auth.signup.error'
  | 'auth.signin.attempt'
  | 'auth.signin.success'
  | 'auth.signin.failure'
  | 'auth.signout'

interface AuthEventPayload {
  event: AuthEventName
  emailDomain?: string // never the full email — domain only is fine for triage
  userId?: string
  reason?: string
  requestId?: string
}

export function logAuthEvent(payload: AuthEventPayload): void {
  const { event, ...rest } = payload
  childLogger({ component: 'auth' }).info(rest, event)
}

export function emailDomain(email: string | undefined | null): string | undefined {
  if (!email) return undefined
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return undefined
  return email.slice(at + 1).toLowerCase()
}
