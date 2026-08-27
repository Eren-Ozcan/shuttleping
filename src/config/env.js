import { config } from 'dotenv'

config()

const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
]

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Eksik zorunlu ortam değişkeni: ${key}`)
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',

  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES ?? '7d',

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
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? null,
  NETGSM_USERCODE: process.env.NETGSM_USERCODE ?? null,
  NETGSM_PASSWORD: process.env.NETGSM_PASSWORD ?? null,
  NETGSM_MSGHEADER: process.env.NETGSM_MSGHEADER ?? null,

  isProd: process.env.NODE_ENV === 'production',
  isDev: process.env.NODE_ENV !== 'production',
}
