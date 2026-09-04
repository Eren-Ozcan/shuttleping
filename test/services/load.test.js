/**
 * M1 — concurrent multi-route load, scaled down from "3 routes x 20
 * passengers x 1 hour" to something that fits a test run: 3 routes, 1
 * passenger each, a burst of concurrent pings per route through the real
 * HTTP ingest path (this is what measures p95 under concurrency).
 *
 * The pipeline completion check (does every route's notification actually
 * get produced) calls computeEtaForRoute + handleNotificationJob directly,
 * the same real functions the eta/notification BullMQ workers run — not
 * through the shared 'eta'/'notifications' queue names. An earlier version
 * used real Worker instances on those queues; under the full suite (20+
 * files hammering the same Redis-backed queues concurrently) that worker
 * only got a fair share of consumption time and flaked on the drain-wait
 * (observed 2026-09-04). Calling the handlers in-process keeps this
 * deterministic and isolated while still exercising the real logic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'
import { computeEtaForRoute } from '../../src/services/eta/index.js'
import { handleNotificationJob } from '../../src/workers/notification.worker.js'
import { env } from '../../src/config/env.js'

let app
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
})

afterAll(async () => {
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

    // Pipeline completion, computed directly (not through the shared BullMQ
    // queue — see file header): each of the 3 routes' passenger gets a
    // dry-run notification from its own ETA computation, none stuck behind
    // the others
    for (const r of ids.routes) {
      const etaResult = await computeEtaForRoute(
        { db: app.db, redis: app.redis, enqueueNotification: (data) => handleNotificationJob({ db: app.db, redis: app.redis }, data) },
        { companyId: ids.companyId, routeId: r.routeId, tripId: r.tripId },
      )
      expect(etaResult.notified).toBe(1)
    }

    const { rows } = await app.db.query(
      `SELECT status FROM notification_logs WHERE company_id = $1`,
      [ids.companyId],
    )
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.status === 'dry_run')).toBe(true)
  })
})
