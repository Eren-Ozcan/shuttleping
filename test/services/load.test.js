/**
 * M1 — concurrent multi-route load, scaled down from "3 routes x 20
 * passengers x 1 hour" to something that fits a test run: 3 routes, 1
 * passenger each, a burst of concurrent pings per route. Runs the real HTTP
 * ingest path + real ETA and notification BullMQ workers end to end (dry-run,
 * no real Telegram/SMS calls) and checks the two things the doc's threshold
 * cares about — ingest stays fast under concurrency, and the queue actually
 * drains (every enqueued notification is eventually produced, not stuck).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'
import { createQueueConnection } from '../../src/queues/connection.js'
import { createEtaWorker } from '../../src/workers/eta.worker.js'
import { createNotificationWorker } from '../../src/workers/notification.worker.js'
import { env } from '../../src/config/env.js'

let app
let connection
let etaWorker
let notificationWorker
const ids = { routes: [] }
let savedDryRun

beforeAll(async () => {
  app = await getTestApp()
  savedDryRun = env.NOTIFICATION_DRY_RUN
  env.NOTIFICATION_DRY_RUN = true // M1 measures the pipeline, not real Telegram/SMS delivery

  const company = await app.db.query(
    `INSERT INTO companies (name, slug) VALUES ('M1 Test AŞ', 'm1-test-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id

  for (let r = 0; r < 3; r++) {
    const driver = await app.db.query(
      `INSERT INTO users (company_id, email, password_hash, role, full_name)
       VALUES ($1, 'm1-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', $2)
       RETURNING id`,
      [ids.companyId, `M1 Sürücü ${r}`],
    )
    const driverId = driver.rows[0].id

    const route = await app.db.query(
      `INSERT INTO routes (company_id, name, driver_id) VALUES ($1, $2, $3) RETURNING id`,
      [ids.companyId, `M1 Hat ${r}`, driverId],
    )
    const routeId = route.rows[0].id

    const stop = await app.db.query(
      `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
       VALUES ($1, $2, 'M1 Durak', 41.0, 29.0, 1) RETURNING id`,
      [ids.companyId, routeId],
    )
    const stopId = stop.rows[0].id

    // A very high threshold — any haversine ETA from right next to the stop
    // crosses it, so the pipeline is guaranteed to produce a notification
    await app.db.query(
      `INSERT INTO passengers (company_id, stop_id, full_name, notification_channel, telegram_chat_id, notify_before_minutes)
       VALUES ($1, $2, $3, 'telegram', $4, 999)`,
      [ids.companyId, stopId, `M1 Yolcu ${r}`, `m1-chat-${r}`],
    )

    const driverAuth = {
      authorization: `Bearer ${app.jwt.sign({ sub: driverId, role: 'driver', companyId: ids.companyId })}`,
    }
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/start',
      headers: driverAuth,
      payload: {},
    })
    ids.routes.push({ routeId, driverId, driverAuth, tripId: start.json().id })
  }

  connection = createQueueConnection()
  etaWorker = createEtaWorker({ db: app.db, redis: app.redis, connection })
  notificationWorker = createNotificationWorker({ db: app.db, redis: app.redis, connection })
})

afterAll(async () => {
  await etaWorker?.close()
  await notificationWorker?.close()
  await connection?.quit()
  env.NOTIFICATION_DRY_RUN = savedDryRun

  if (app) {
    await app.db.query('DELETE FROM notification_logs WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM trip_notifications WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM trip_stops WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM location_history WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM trips WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM passengers WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM stops WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM routes WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM users WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

function percentile(sortedMs, p) {
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
  return sortedMs[idx]
}

async function waitUntil(check, { timeoutMs = 10_000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

describe('3 routes concurrent load (M1)', () => {
  it('ingest stays fast under concurrency and every route\'s notification is produced', async () => {
    for (const r of ids.routes) await clearRateLimits(r.driverId)

    const PINGS_PER_ROUTE = 8
    const latenciesMs = []

    for (let i = 0; i < PINGS_PER_ROUTE; i++) {
      const batch = ids.routes.map(async (r) => {
        const t0 = performance.now()
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/locations',
          headers: r.driverAuth,
          // Well outside ETA_PASSED_RADIUS_METERS (150m default) — otherwise
          // the stop is immediately marked "passed" and never notifies
          payload: { lat: 41.05 + i * 0.0001, lng: 29.05 },
        })
        latenciesMs.push(performance.now() - t0)
        expect(res.statusCode).toBe(200)
      })
      await Promise.all(batch)
    }

    latenciesMs.sort((a, b) => a - b)
    expect(percentile(latenciesMs, 95)).toBeLessThan(2000)

    // The queue actually drains: each of the 3 routes' passenger gets a
    // dry-run notification, not stuck waiting behind the others
    const drained = await waitUntil(async () => {
      const { rows } = await app.db.query(
        'SELECT count(*)::int AS n FROM notification_logs WHERE company_id = $1',
        [ids.companyId],
      )
      return rows[0].n >= 3
    })
    expect(drained).toBe(true)

    const { rows } = await app.db.query(
      `SELECT status FROM notification_logs WHERE company_id = $1`,
      [ids.companyId],
    )
    expect(rows.every((row) => row.status === 'dry_run')).toBe(true)
  })
})
