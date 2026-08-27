import { config } from 'dotenv'

config()

/**
 * Ortam değişkeni doğrulaması (F8).
 *
 * JWT_REFRESH_SECRET burada zorunlu tutuluyordu ama hiçbir yerde
 * kullanılmıyor: refresh token'lar opak rastgele + SHA-256. Zorunlu ama
 * etkisiz bir sır, kurulum dokümanını yanıltıyordu — kaldırıldı.
 *
 * Üretimde ek kontroller var: CORS_ORIGIN sessizce localhost'a düşerse
 * panel çalışmaz ve kimlikli bir CORS politikası localhost'u işaret eder.
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
    // credentials: true ile birlikte '*' geçersiz ve tehlikeli
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

/** '7d' / '15m' / '30s' → milisaniye. */
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
  // HTTP + ETA worker (5) + bildirim worker (10) aynı havuzu paylaşır
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX ?? 20),
  DB_STATEMENT_TIMEOUT_MS: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000),

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  // JWT_REFRESH_SECRET yok: refresh token'lar JWT değil, opak rastgele
  // değerlerdir ve DB'de SHA-256 hash'i saklanır (bkz. auth.service.js)
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  // Refresh token ömrü. Eskiden auth route'unda sabit kodluydu ve bu değişken
  // hiç okunmuyordu — değiştirmek hiçbir işe yaramıyordu (D7).
  JWT_REFRESH_EXPIRES_MS: parseDuration(process.env.JWT_REFRESH_EXPIRES ?? '7d'),

  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  // Rate limit (Faz D) — dakika başına istek. Global tavan cömert; asıl
  // sıkı limitler route seviyesinde (login, konum ingest).
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 300),
  RATE_LIMIT_LOGIN_MAX: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 5),
  RATE_LIMIT_LOCATION_MAX: Number(process.env.RATE_LIMIT_LOCATION_MAX ?? 12),

  // ETA motoru (Faz 3) — anahtar yoksa haversine fallback kullanılır
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? null,
  ETA_FALLBACK_SPEED_KMH: Number(process.env.ETA_FALLBACK_SPEED_KMH ?? 25),
  // Araç bu yarıçapa girince durak "geçilmiş" sayılır (Faz A)
  ETA_PASSED_RADIUS_METERS: Number(process.env.ETA_PASSED_RADIUS_METERS ?? 150),
  // Bu süredir ping gelmeyen aktif sefer "abandoned" işaretlenir (Faz A)
  TRIP_ABANDON_AFTER_MINUTES: Number(process.env.TRIP_ABANDON_AFTER_MINUTES ?? 20),

  // Saklama süreleri (Faz E7) — 0 = sınırsız (temizlik yapılmaz).
  // Konum ve bildirim kayıtları kişisel veri; süresiz saklama KVKK açısından
  // savunulabilir değil.
  LOCATION_HISTORY_RETENTION_DAYS: Number(
    process.env.LOCATION_HISTORY_RETENTION_DAYS ?? 90,
  ),
  NOTIFICATION_LOG_RETENTION_DAYS: Number(
    process.env.NOTIFICATION_LOG_RETENTION_DAYS ?? 365,
  ),

  // Maliyet kontrolü (Faz B) — Google Routes API computeRouteMatrix
  // Bu dakikanın altındaki duraklar TRAFFIC_AWARE (Pro SKU, ~$10/1K) sorulur
  ETA_TRAFFIC_AWARE_MINUTES: Number(process.env.ETA_TRAFFIC_AWARE_MINUTES ?? 15),
  // Bunun üstündeki duraklar Google'a hiç sorulmaz (haversine yeterli)
  ETA_GOOGLE_MAX_MINUTES: Number(process.env.ETA_GOOGLE_MAX_MINUTES ?? 30),
  ETA_GOOGLE_MAX_DISTANCE_KM: Number(process.env.ETA_GOOGLE_MAX_DISTANCE_KM ?? 10),
  // Günlük element tavanı — aşılırsa haversine'e düşülür + logger.error
  GOOGLE_DAILY_ELEMENT_BUDGET: Number(process.env.GOOGLE_DAILY_ELEMENT_BUDGET ?? 5000),
  // Google'a tekrar sorma aralığı: yakın durak varken sık, yokken seyrek
  ETA_THROTTLE_NEAR_SECONDS: Number(process.env.ETA_THROTTLE_NEAR_SECONDS ?? 45),
  ETA_THROTTLE_FAR_SECONDS: Number(process.env.ETA_THROTTLE_FAR_SECONDS ?? 300),
  // Araç bu kadar hareket etmediyse önceki Google sonucu yeniden kullanılır
  ETA_MIN_MOVE_METERS: Number(process.env.ETA_MIN_MOVE_METERS ?? 100),

  // Bildirim kanalları (Faz 4) — boş bırakılan kanal devre dışı kalır,
  // gönderim denemesi notification_logs'a 'failed' olarak düşer
  // Prova modu (Faz F3): açıkken hiçbir gerçek mesaj gitmez, log'a 'dry_run'
  // olarak düşer. TEST_CHAT_ID verilirse mesaj bastırılmak yerine o tek
  // Telegram hesabına yönlendirilir — akış uçtan uca sınanır.
  NOTIFICATION_DRY_RUN: process.env.NOTIFICATION_DRY_RUN === 'true',
  NOTIFICATION_TEST_CHAT_ID: process.env.NOTIFICATION_TEST_CHAT_ID ?? null,

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? null,
  NETGSM_USERCODE: process.env.NETGSM_USERCODE ?? null,
  NETGSM_PASSWORD: process.env.NETGSM_PASSWORD ?? null,
  NETGSM_MSGHEADER: process.env.NETGSM_MSGHEADER ?? null,

  isProd: process.env.NODE_ENV === 'production',
  isDev: process.env.NODE_ENV !== 'production',
}
