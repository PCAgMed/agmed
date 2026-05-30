// Node-only instrumentation. Imported lazily from `instrumentation.ts`
// behind a `NEXT_RUNTIME === 'nodejs'` guard so the bundler never traces
// pino/pino-loki (and their `node:stream` / `worker_threads` deps) into
// the Edge runtime build. See AGM-42.
import type { Instrumentation } from 'next'
import { getLogger } from './lib/observability/logger'

export function registerNode(): void {
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

export const onRequestErrorNode: Instrumentation.onRequestError = (err, request, context) => {
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
