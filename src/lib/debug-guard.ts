import { NextResponse } from 'next/server'

// Hard-disable for any /api/debug/* endpoint. Even if an operator leaves
// DEBUG_THROW_ENABLED=true in a prod env file, this short-circuits with a
// 404 whenever NODE_ENV or APP_ENV is "production".
export function assertDebugAllowed(): NextResponse | null {
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production'
  if (isProd || process.env.DEBUG_THROW_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 })
  }
  return null
}
