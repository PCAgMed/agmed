'use client'

import { useEffect } from 'react'

// Forwards browser-side errors and unhandled rejections to the server log
// pipeline so they end up in the same Loki stream as server errors.
// Mounted once from the root layout.
export function ClientErrorReporter(): null {
  useEffect(() => {
    function send(payload: Record<string, unknown>): void {
      // Best-effort. fetch failures here would just be lost — that's fine,
      // we never want client logging to break the user experience.
      void fetch('/api/log/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
        keepalive: true,
      }).catch(() => undefined)
    }

    function onError(event: ErrorEvent): void {
      send({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        name: event.error instanceof Error ? event.error.name : 'ErrorEvent',
      })
    }

    function onRejection(event: PromiseRejectionEvent): void {
      const reason = event.reason
      send({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        name: reason instanceof Error ? reason.name : 'UnhandledRejection',
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
