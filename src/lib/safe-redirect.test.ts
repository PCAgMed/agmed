import { describe, expect, it } from 'vitest'
import { DEFAULT_REDIRECT, safeCallback } from './safe-redirect'

describe('safeCallback', () => {
  it('falls back when the value is missing or empty', () => {
    expect(safeCallback(null)).toBe(DEFAULT_REDIRECT)
    expect(safeCallback(undefined)).toBe(DEFAULT_REDIRECT)
    expect(safeCallback('')).toBe(DEFAULT_REDIRECT)
  })

  it('rejects protocol-relative URLs (//evil.com)', () => {
    expect(safeCallback('//evil.com')).toBe(DEFAULT_REDIRECT)
    expect(safeCallback('//evil.com/dashboard')).toBe(DEFAULT_REDIRECT)
  })

  it('rejects backslash bypasses (/\\evil.com)', () => {
    expect(safeCallback('/\\evil.com')).toBe(DEFAULT_REDIRECT)
    expect(safeCallback('/dashboard\\foo')).toBe(DEFAULT_REDIRECT)
  })

  it('rejects absolute URLs even when scheme is http(s)', () => {
    expect(safeCallback('https://evil.com')).toBe(DEFAULT_REDIRECT)
    expect(safeCallback('http://evil.com/dashboard')).toBe(DEFAULT_REDIRECT)
  })

  it('rejects javascript: and data: schemes', () => {
    expect(safeCallback('javascript:alert(1)')).toBe(DEFAULT_REDIRECT)
    expect(safeCallback('data:text/html,<script>')).toBe(DEFAULT_REDIRECT)
  })

  it('rejects paths outside the allowlist', () => {
    expect(safeCallback('/foo')).toBe(DEFAULT_REDIRECT)
    expect(safeCallback('/api/auth/signout')).toBe(DEFAULT_REDIRECT)
    // Prefix collision: /dashboardish must not match /dashboard.
    expect(safeCallback('/dashboardish')).toBe(DEFAULT_REDIRECT)
  })

  it('allows /dashboard, /agenda, /patients and their subpaths', () => {
    expect(safeCallback('/dashboard')).toBe('/dashboard')
    expect(safeCallback('/dashboard/')).toBe('/dashboard/')
    expect(safeCallback('/dashboard/settings')).toBe('/dashboard/settings')
    expect(safeCallback('/agenda')).toBe('/agenda')
    expect(safeCallback('/agenda/2026-05-30')).toBe('/agenda/2026-05-30')
    expect(safeCallback('/patients')).toBe('/patients')
    expect(safeCallback('/patients/abc-123')).toBe('/patients/abc-123')
  })

  it('preserves query strings and hashes on allowed paths', () => {
    expect(safeCallback('/dashboard?from=signup')).toBe('/dashboard?from=signup')
    expect(safeCallback('/agenda#today')).toBe('/agenda#today')
    expect(safeCallback('/patients?q=maria&page=2')).toBe('/patients?q=maria&page=2')
  })

  it('does not let a query-string trick bypass the allowlist', () => {
    // Path is /foo; ?next=/dashboard does not move us back onto the allowlist.
    expect(safeCallback('/foo?next=/dashboard')).toBe(DEFAULT_REDIRECT)
  })
})
