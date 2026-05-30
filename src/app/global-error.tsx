'use client'

import { useEffect } from 'react'

// Catches errors thrown in the React tree above the route segment level.
// Reports to the server log pipeline before rendering a fallback UI.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    void fetch('/api/log/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        name: error.name,
        componentStack: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => undefined)
  }, [error])

  return (
    <html lang="pt-BR">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Algo deu errado</h1>
          <p className="text-sm text-gray-500">
            A equipe foi notificada. Tente novamente em instantes.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  )
}
