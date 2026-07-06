import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error')
})
