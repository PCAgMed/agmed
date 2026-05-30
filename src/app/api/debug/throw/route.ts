import { NextResponse } from 'next/server'
import { assertDebugAllowed } from '@/lib/debug-guard'

// Intentional throw endpoint used to validate the error pipeline.
// Gated by code + env var so it never ships to production by accident.
// Hit it with: curl http://localhost:3000/api/debug/throw
export async function GET(): Promise<NextResponse> {
  const denied = assertDebugAllowed()
  if (denied) return denied
  throw new Error('intentional debug throw — AGM-8 verification')
}
