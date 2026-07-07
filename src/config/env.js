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

  // ETA motoru (Faz 3) — anahtar yoksa haversine fallback kullanılır
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? null,
  ETA_FALLBACK_SPEED_KMH: Number(process.env.ETA_FALLBACK_SPEED_KMH ?? 25),
  ETA_DEDUP_TTL_SECONDS: Number(process.env.ETA_DEDUP_TTL_SECONDS ?? 2700),

  isProd: process.env.NODE_ENV === 'production',
  isDev: process.env.NODE_ENV !== 'production',
}
