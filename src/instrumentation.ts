// Next.js instrumentation entry point.
// Runs once per server boot in each runtime. We use it to:
//   1. Capture unhandled rejections / uncaught exceptions on the Node process.
//   2. Initialize the root logger so the first request doesn't pay the cost.
//   3. Route runtime errors (`onRequestError`) through the structured logger.
//
// All pino/pino-loki imports live in `./instrumentation-node.ts`, gated
// behind `NEXT_RUNTIME === 'nodejs'`. Next.js replaces that constant per
// bundle, so the Edge build dead-code-eliminates the import entirely
// (AGM-42 — without this, webpack tries to resolve `node:stream` and
// `worker_threads` for the edge bundle and the app fails to build).
import type { Instrumentation } from 'next'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node')
    registerNode()
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { onRequestErrorNode } = await import('./instrumentation-node')
    return onRequestErrorNode(err, request, context)
  }

  // Edge fallback — pino cannot run here, so emit a plain JSON line that
  // Docker/Loki picks up the same way it picks up pino lines.
  console.error(
    JSON.stringify({
      level: 'error',
      time: new Date().toISOString(),
      event: 'request.error',
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
      request: {
        path: request.path,
        method: request.method,
      },
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      revalidateReason: context.revalidateReason,
    }),
  )
}
