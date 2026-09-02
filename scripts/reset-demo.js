/**
 * Resets the demo tenant's operational state so the same scenario can be run
 * again: closes open trips, clears the notification dedup rows and drops the
 * Redis keys (last location, cached ETA, ETA lock, billing access cache).
 *
 * The dedup is per trip — trip_notifications is unique on (trip_id,
 * passenger_id) — so a trip left open by --stop-at or a crash would silently
 * swallow the next notification. That is what this script exists for.
 *
 * Usage:
 *   npm run demo:reset
 *   node scripts/reset-demo.js --hard      # also wipes history and logs
 *
 * Refuses to run against NODE_ENV=production unless --force is given.
 */
import Redis from 'ioredis'
import pg from 'pg'
import { config } from 'dotenv'

config()

const args = process.argv.slice(2)
const hard = args.includes('--hard')
const force = args.includes('--force')
const SLUG = 'demo'

if (process.env.NODE_ENV === 'production' && !force) {
  console.error('NODE_ENV=production — bu script üretimde --force olmadan çalışmaz')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL tanımlı değil — .env dosyanı kontrol et')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl })
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
})

try {
  const { rows: companies } = await pool.query('SELECT id FROM companies WHERE slug = $1', [SLUG])

  if (!companies[0]) {
    console.error(`'${SLUG}' şirketi yok — önce npm run seed:demo çalıştır`)
    process.exit(1)
  }

  const companyId = companies[0].id

  const { rows: routes } = await pool.query('SELECT id FROM routes WHERE company_id = $1', [
    companyId,
  ])

  const closed = await pool.query(
    `UPDATE trips SET status = 'completed', ended_at = now()
     WHERE company_id = $1 AND status = 'active'`,
    [companyId],
  )

  const dedup = await pool.query('DELETE FROM trip_notifications WHERE company_id = $1', [
    companyId,
  ])

  console.log(`Kapatılan aktif sefer: ${closed.rowCount}`)
  console.log(`Silinen dedup kaydı  : ${dedup.rowCount}`)

  if (hard) {
    const logs = await pool.query('DELETE FROM notification_logs WHERE company_id = $1', [
      companyId,
    ])
    const history = await pool.query('DELETE FROM location_history WHERE company_id = $1', [
      companyId,
    ])
    const tripStops = await pool.query('DELETE FROM trip_stops WHERE company_id = $1', [companyId])
    const trips = await pool.query('DELETE FROM trips WHERE company_id = $1', [companyId])

    console.log(`Silinen bildirim kaydı: ${logs.rowCount}`)
    console.log(`Silinen konum kaydı   : ${history.rowCount}`)
    console.log(`Silinen sefer durağı  : ${tripStops.rowCount}`)
    console.log(`Silinen sefer         : ${trips.rowCount}`)
  }

  await redis.connect()

  const keys = [`company:access:${companyId}`]
  for (const route of routes) {
    keys.push(`loc:${companyId}:${route.id}`, `eta:${companyId}:${route.id}`, `etacalc:${route.id}`)
  }

  const removed = keys.length ? await redis.del(...keys) : 0
  console.log(`Silinen Redis anahtarı: ${removed}`)
  console.log('\nHazır — npm run demo:drive ile yeniden deneyebilirsin.')
} catch (err) {
  console.error('Sıfırlama başarısız:', err.message)
  process.exit(1)
} finally {
  redis.disconnect()
  await pool.end()
}
