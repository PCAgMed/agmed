import pino, { type Logger, type LoggerOptions, type StreamEntry } from 'pino'
import { pinoLoki } from 'pino-loki'
import { getAppEnv, getReleaseTag, getServiceName } from './env'
import { REDACT_CENSOR, REDACT_PATHS } from './redaction'

// Resolved once per process. Pino is a singleton; child loggers add context.
let rootLogger: Logger | undefined

function buildOptions(): LoggerOptions {
  const env = getAppEnv()
  return {
    level: process.env.LOG_LEVEL ?? (env === 'development' ? 'debug' : 'info'),
    base: {
      service: getServiceName(),
      env,
      release: getReleaseTag(),
    },
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACT_CENSOR,
      remove: false,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label }
      },
    },
  }
}

function buildStreams(): StreamEntry[] {
  const env = getAppEnv()
  const level = (process.env.LOG_LEVEL as StreamEntry['level']) ?? 'debug'
  const streams: StreamEntry[] = [{ level, stream: process.stdout }]

  const lokiUrl = process.env.LOKI_URL?.trim()
  if (lokiUrl) {
    // pino-loki as a Transform stream (no worker_threads required, so it
    // survives Next.js / Turbopack bundling). Errors during push are
    // swallowed so a Loki outage cannot affect request handling.
    const lokiStream = pinoLoki({
      host: lokiUrl,
      // Batch pushes to Loki on a 2s interval (better-than-per-line throughput,
      // bounded loss on crash). interval is in seconds.
      batching: { interval: 2 },
      // pino-loki defaults to reading `log.time`. Our isoTime stamp is not
      // a nanosecond number, so let pino-loki replace it at push time.
      replaceTimestamp: true,
      silenceErrors: env === 'production',
      labels: {
        service: getServiceName(),
        env,
        release: getReleaseTag(),
      },
      basicAuth:
        process.env.LOKI_USERNAME && process.env.LOKI_PASSWORD
          ? {
              username: process.env.LOKI_USERNAME,
              password: process.env.LOKI_PASSWORD,
            }
          : undefined,
    })
    streams.push({ level, stream: lokiStream })
  }

  return streams
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = pino(buildOptions(), pino.multistream(buildStreams()))
  }
  return rootLogger
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings)
}
