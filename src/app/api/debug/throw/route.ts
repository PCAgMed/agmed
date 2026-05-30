import { NextResponse } from 'next/server'

// Intentional throw endpoint used to validate the error pipeline.
// Gated by env var so it never ships to production by accident.
// Hit it with: curl http://localhost:3000/api/debug/throw
export async function GET(): Promise<NextResponse> {
  if (process.env.DEBUG_THROW_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 })
  }
  throw new Error('intentional debug throw — AGM-8 verification')
}
