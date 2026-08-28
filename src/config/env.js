import { config } from 'dotenv'

config()

/**
 * Environment variable validation (F8).
 *
 * JWT_REFRESH_SECRET used to be required here but is not used anywhere:
 * refresh tokens are opaque random values + SHA-256. A required but
 * ineffective secret was misleading the setup docs — removed.
 *
 * Extra checks in production: if CORS_ORIGIN silently falls back to
 * localhost the panel breaks, and an authenticated CORS policy pointing at localhost is wrong.
 */
const REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'JWT_ACCESS_SECRET']
const REQUIRED_IN_PROD = ['CORS_ORIGIN']
const MIN_SECRET_LENGTH = 32

const problems = []
const isProd = process.env.NODE_ENV === 'production'

for (const key of [...REQUIRED, ...(isProd ? REQUIRED_IN_PROD : [])]) {
  if (!process.env[key]) problems.push(`Eksik zorunlu ortam değişkeni: ${key}`)
}

if (
  process.env.JWT_ACCESS_SECRET &&
  process.env.JWT_ACCESS_SECRET.length < MIN_SECRET_LENGTH
) {
  problems.push(`JWT_ACCESS_SECRET en az ${MIN_SECRET_LENGTH} karakter olmalı`)
}

if (isProd) {
  if (process.env.CORS_ORIGIN === '*') {
    // '*' together with credentials: true is invalid and dangerous
    problems.push("CORS_ORIGIN '*' olamaz — kimlikli istekler için tam origin gerekir")
  }
  if (process.env.CORS_ORIGIN?.includes('localhost')) {
    problems.push('CORS_ORIGIN üretimde localhost olamaz')
  }
  if (/change_me|test_|example/i.test(process.env.JWT_ACCESS_SECRET ?? '')) {
    problems.push('JWT_ACCESS_SECRET örnek/varsayılan değer içeriyor')
  }
}

if (problems.length) {
  throw new Error(`Ortam yapılandırması geçersiz:\n  - ${problems.join('\n  - ')}`)
}

/** '7d' / '15m' / '30s' -> milliseconds. */
function parseDuration(value) {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(String(value).trim())
  if (!match) {
    throw new Error(`Geçersiz süre biçimi: ${value} (örn. 7d, 15m, 30s)`)
  }
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Number(match[1]) * units[match[2]]
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',

  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  // HTTP + ETA worker (5) + notification worker (10) share the same pool
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX ?? 20),
  DB_STATEMENT_TIMEOUT_MS: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000),

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  // No JWT_REFRESH_SECRET: refresh tokens are not JWTs, they are opaque
  // random values and only their SHA-256 hash is stored in the DB (see auth.service.js)
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  // Refresh token lifetime. Used to be hard-coded in the auth route and this
  // variable was never read — changing it did nothing (D7).
  JWT_REFRESH_EXPIRES_MS: parseDuration(process.env.JWT_REFRESH_EXPIRES ?? '7d'),

  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  // Rate limit (Phase D) — requests per minute. The global ceiling is generous;
  // the strict limits are at route level (login, location ingest).
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 300),
  RATE_LIMIT_LOGIN_MAX: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 5),
  RATE_LIMIT_LOCATION_MAX: Number(process.env.RATE_LIMIT_LOCATION_MAX ?? 12),

  // ETA engine (Phase 3) — without a key, the haversine fallback is used
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? null,
  ETA_FALLBACK_SPEED_KMH: Number(process.env.ETA_FALLBACK_SPEED_KMH ?? 25),
  // A stop counts as "passed" once the vehicle enters this radius (Phase A)
  ETA_PASSED_RADIUS_METERS: Number(process.env.ETA_PASSED_RADIUS_METERS ?? 150),
  // An active trip with no ping for this long is marked "abandoned" (Phase A)
  TRIP_ABANDON_AFTER_MINUTES: Number(process.env.TRIP_ABANDON_AFTER_MINUTES ?? 20),

  // Retention windows (Phase E7) — 0 = unlimited (no cleanup).
  // Location and notification records are personal data; indefinite retention
  // is not defensible under KVKK.
  LOCATION_HISTORY_RETENTION_DAYS: Number(
    process.env.LOCATION_HISTORY_RETENTION_DAYS ?? 90,
  ),
  NOTIFICATION_LOG_RETENTION_DAYS: Number(
    process.env.NOTIFICATION_LOG_RETENTION_DAYS ?? 365,
  ),

  // Cost control (Phase B) — Google Routes API computeRouteMatrix
  // Stops under this many minutes are queried TRAFFIC_AWARE (Pro SKU, ~$10/1K)
  ETA_TRAFFIC_AWARE_MINUTES: Number(process.env.ETA_TRAFFIC_AWARE_MINUTES ?? 15),
  // Stops above this are never queried against Google (haversine is enough)
  ETA_GOOGLE_MAX_MINUTES: Number(process.env.ETA_GOOGLE_MAX_MINUTES ?? 30),
  ETA_GOOGLE_MAX_DISTANCE_KM: Number(process.env.ETA_GOOGLE_MAX_DISTANCE_KM ?? 10),
  // Daily element ceiling — once exceeded, fall back to haversine + logger.error
  GOOGLE_DAILY_ELEMENT_BUDGET: Number(process.env.GOOGLE_DAILY_ELEMENT_BUDGET ?? 5000),
  // Re-query interval for Google: frequent while a stop is near, sparse otherwise
  ETA_THROTTLE_NEAR_SECONDS: Number(process.env.ETA_THROTTLE_NEAR_SECONDS ?? 45),
  ETA_THROTTLE_FAR_SECONDS: Number(process.env.ETA_THROTTLE_FAR_SECONDS ?? 300),
  // If the vehicle has not moved at least this far, the previous Google result is reused
  ETA_MIN_MOVE_METERS: Number(process.env.ETA_MIN_MOVE_METERS ?? 100),

  // Notification channels (Phase 4) — a channel left empty is disabled,
  // and a send attempt lands in notification_logs as 'failed'
  // Dry-run mode (Phase F3): while on, no real message is sent, the record
  // lands in the log as 'dry_run'. If TEST_CHAT_ID is set, the message is
  // routed to that single Telegram account instead of being suppressed —
  // the flow is exercised end to end.
  NOTIFICATION_DRY_RUN: process.env.NOTIFICATION_DRY_RUN === 'true',
  NOTIFICATION_TEST_CHAT_ID: process.env.NOTIFICATION_TEST_CHAT_ID ?? null,

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? null,
  NETGSM_USERCODE: process.env.NETGSM_USERCODE ?? null,
  NETGSM_PASSWORD: process.env.NETGSM_PASSWORD ?? null,
  NETGSM_MSGHEADER: process.env.NETGSM_MSGHEADER ?? null,

  isProd: process.env.NODE_ENV === 'production',
  isDev: process.env.NODE_ENV !== 'production',
}
