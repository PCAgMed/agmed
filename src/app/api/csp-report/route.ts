import { NextResponse } from 'next/server'
import { childLogger } from '@/lib/observability/logger'
import { logRateLimitBlock, rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit/client-ip'

// CSP violation sink (AGM-25). Receives reports from both the legacy
// `report-uri` directive (`application/csp-report`) and the modern
// Reporting API (`application/reports+json`). Always returns 204 — even on
// malformed payloads — so a noisy browser does not retry-storm us.

const PER_IP = { limit: 120, windowSec: 60 }
const MAX_BODY_BYTES = 16 * 1024
const MAX_FIELD_CHARS = 1024
const ENDPOINT = '/api/csp-report'

interface LegacyCspReport {
  'csp-report'?: Record<string, unknown>
}

interface ReportingApiEntry {
  type?: string
  age?: number
  url?: string
  user_agent?: string
  body?: Record<string, unknown>
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip = getClientIp(req)
  const ipResult = rateLimit({ key: `csp-report:ip:${ip}`, ...PER_IP })
  if (!ipResult.allowed) {
    logRateLimitBlock({
      endpoint: ENDPOINT,
      reason: 'ip',
      keyClass: 'ip',
      result: ipResult,
    })
    return rateLimitedResponse({ retryAfterSec: ipResult.retryAfterSec })
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204 })
  }

  const raw = await readBodyWithCap(req, MAX_BODY_BYTES)
  if (raw === null) {
    return new NextResponse(null, { status: 204 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  const log = childLogger({ component: 'csp-report' })
  const userAgent = truncate(req.headers.get('user-agent') ?? '', MAX_FIELD_CHARS)

  for (const report of normalize(parsed)) {
    log.warn(
      {
        event: 'csp.violation',
        violatedDirective: report.violatedDirective,
        effectiveDirective: report.effectiveDirective,
        blockedUri: report.blockedUri,
        documentUri: report.documentUri,
        disposition: report.disposition,
        sourceFile: report.sourceFile,
        lineNumber: report.lineNumber,
        columnNumber: report.columnNumber,
        userAgent,
      },
      'CSP violation reported',
    )
  }

  return new NextResponse(null, { status: 204 })
}

interface NormalizedReport {
  violatedDirective?: string
  effectiveDirective?: string
  blockedUri?: string
  documentUri?: string
  disposition?: string
  sourceFile?: string
  lineNumber?: number
  columnNumber?: number
}

function normalize(parsed: unknown): NormalizedReport[] {
  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry): entry is ReportingApiEntry => isObject(entry))
      .filter((entry) => entry.type === 'csp-violation' || entry.type === undefined)
      .map((entry) => fromReportingApi(entry.body))
  }
  if (isObject(parsed) && 'csp-report' in parsed) {
    return [fromLegacy((parsed as LegacyCspReport)['csp-report'])]
  }
  if (isObject(parsed)) {
    return [fromReportingApi(parsed)]
  }
  return []
}

function fromLegacy(body: Record<string, unknown> | undefined): NormalizedReport {
  if (!body) return {}
  return {
    violatedDirective: pickString(body, 'violated-directive'),
    effectiveDirective: pickString(body, 'effective-directive'),
    blockedUri: pickString(body, 'blocked-uri'),
    documentUri: pickString(body, 'document-uri'),
    disposition: pickString(body, 'disposition'),
    sourceFile: pickString(body, 'source-file'),
    lineNumber: pickNumber(body, 'line-number'),
    columnNumber: pickNumber(body, 'column-number'),
  }
}

function fromReportingApi(body: Record<string, unknown> | undefined): NormalizedReport {
  if (!body) return {}
  return {
    violatedDirective: pickString(body, 'effectiveDirective') ?? pickString(body, 'violatedDirective'),
    effectiveDirective: pickString(body, 'effectiveDirective'),
    blockedUri: pickString(body, 'blockedURL') ?? pickString(body, 'blockedUri'),
    documentUri: pickString(body, 'documentURL') ?? pickString(body, 'documentUri'),
    disposition: pickString(body, 'disposition'),
    sourceFile: pickString(body, 'sourceFile'),
    lineNumber: pickNumber(body, 'lineNumber'),
    columnNumber: pickNumber(body, 'columnNumber'),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' ? truncate(v, MAX_FIELD_CHARS) : undefined
}

function pickNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

async function readBodyWithCap(req: Request, maxBytes: number): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) {
    const text = await req.text()
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text
  }
  const decoder = new TextDecoder()
  let total = 0
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value?.byteLength ?? 0
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore — already rejecting
      }
      return null
    }
    if (value) buffer += decoder.decode(value, { stream: true })
  }
  buffer += decoder.decode()
  return buffer
}
