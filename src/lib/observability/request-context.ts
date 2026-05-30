import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  startedAt: number
  method?: string
  path?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore()
}
