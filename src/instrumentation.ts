// Next.js instrumentation entry point.
// Runs once per server boot in the Node runtime. We use it to:
//   1. Capture unhandled rejections / uncaught exceptions on the Node process.
//   2. Initialize the root logger so the first request doesn't pay the cost.
//
// Client-side and edge errors flow through other hooks (see onRequestError
// below for the Next.js-managed path).
import type { Instrumentation } from 'next'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { getLogger } = await import('./lib/observability/logger')
  const log = getLogger()

  log.info(
    {
      event: 'server.boot',
      pid: process.pid,
      node: process.version,
    },
    'server boot',
  )

  process.on('unhandledRejection', (reason) => {
    log.error(
      {
        event: 'process.unhandledRejection',
        err: reason instanceof Error ? reason : new Error(String(reason)),
      },
      'unhandled promise rejection',
    )
  })

  process.on('uncaughtException', (err) => {
    log.fatal(
      {
        event: 'process.uncaughtException',
        err,
      },
      'uncaught exception',
    )
    // Let Node's default behaviour take over after we log — do NOT swallow.
  })
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { getLogger } = await import('./lib/observability/logger')
  getLogger().error(
    {
      event: 'request.error',
      err,
      request: {
        path: request.path,
        method: request.method,
      },
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      revalidateReason: context.revalidateReason,
    },
    'request error',
  )
}
