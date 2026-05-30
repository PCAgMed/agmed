// Fields that must NEVER reach the log pipeline.
// Pino redacts these to the string "[REDACTED]" wherever they appear in the
// log object (top-level or nested), using JSONPath-style selectors.
//
// Add new entries as we introduce features that touch PHI/PII. Removing an
// entry needs a code review explicitly calling out the change.
export const REDACT_PATHS: readonly string[] = [
  // Credentials
  'password',
  '*.password',
  'credentials.password',
  'body.password',
  'req.body.password',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',

  // Session / token material
  'token',
  '*.token',
  'sessionToken',
  '*.sessionToken',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',

  // Patient identifiers (LGPD — even before we collect them, the
  // redaction is in place so we cannot accidentally leak via debug logs).
  'cpf',
  '*.cpf',
  'rg',
  '*.rg',
  'cns', // Cartão Nacional de Saúde
  '*.cns',
  'birthDate',
  '*.birthDate',
  'phone',
  '*.phone',
  'patient.*',
]

export const REDACT_CENSOR = '[REDACTED]'
