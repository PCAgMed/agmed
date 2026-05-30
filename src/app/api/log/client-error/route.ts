import { NextResponse } from 'next/server'
import { childLogger } from '@/lib/observability/logger'

interface ClientErrorPayload {
  message?: string
  stack?: string
  name?: string
  url?: string
  userAgent?: string
  componentStack?: string
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: ClientErrorPayload
  try {
    body = (await req.json()) as ClientErrorPayload
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  childLogger({ component: 'client' }).error(
    {
      event: 'client.error',
      err: {
        message: body.message ?? 'unknown',
        stack: body.stack,
        name: body.name,
      },
      url: body.url,
      userAgent: body.userAgent,
      componentStack: body.componentStack,
    },
    'client-side error reported',
  )

  return NextResponse.json({ ok: true })
}
