import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const { Pool } = pg

// The pool is shared between HTTP handlers and the workers: the ETA worker
// runs 5 and the notification worker 10 concurrent jobs, i.e. 15 consumers on
// their own. With a fixed 10, location ingest was queuing behind background jobs.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Do not let a runaway query hold a connection forever
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
})

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error')
})
