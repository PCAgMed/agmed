export type AppEnv = 'development' | 'staging' | 'production' | 'test'

export function getAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').toLowerCase()
  if (raw === 'production') return 'production'
  if (raw === 'staging') return 'staging'
  if (raw === 'test') return 'test'
  return 'development'
}

export function getServiceName(): string {
  return process.env.OTEL_SERVICE_NAME ?? 'clinica-agenda-web'
}

export function getReleaseTag(): string {
  // Set at build/deploy time. Falls back to package version + short commit
  // when those env vars are present, else "dev".
  return (
    process.env.APP_RELEASE ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    'dev'
  )
}
