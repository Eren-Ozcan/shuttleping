import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const { Pool } = pg

// Havuz HTTP handler'larıyla worker'lar arasında paylaşılır: ETA worker'ı 5,
// bildirim worker'ı 10 eşzamanlı iş yürütür, yani tek başlarına 15 tüketici.
// Sabit 10 ile konum ingest arka plan işlerinin arkasında kuyruğa giriyordu.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Kaçak bir sorgu havuzu süresiz tutmasın
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
})

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error')
})
