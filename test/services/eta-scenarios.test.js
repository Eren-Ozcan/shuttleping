/**
 * ETA scenarios that the unit tests did not cover: a vehicle that stops moving
 * (B10) and several passengers waiting at the same stop with different
 * thresholds (D4). Real PostgreSQL + Redis, provider and queue faked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'
import {
  computeEtaForRoute,
  locationKey,
  etaKey,
  etaCalcKey,
} from '../../src/services/eta/index.js'

let app
const ids = {}

beforeAll(async () => {
  app = await getTestApp()

  const company = await app.db.query(
    `INSERT INTO companies (name, slug)
     VALUES ('ETA Senaryo AŞ', 'eta-senaryo-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name) VALUES ($1, 'Senaryo Hattı') RETURNING id`,
    [ids.companyId],
  )
  ids.routeId = route.rows[0].id

  const driver = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES ($1, 'senaryo-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'Sürücü')
     RETURNING id`,
    [ids.companyId],
  )
  ids.driverId = driver.rows[0].id

  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'Ortak Durak', 40.99, 29.02, 1) RETURNING id`,
    [ids.companyId, ids.routeId],
  )
  ids.stopId = stop.rows[0].id

  // D4 — three passengers at the same stop, each with its own threshold
  ids.passengers = {}
  for (const minutes of [5, 10, 15]) {
    const { rows } = await app.db.query(
      `INSERT INTO passengers
         (company_id, stop_id, full_name, notification_channel, telegram_chat_id, notify_before_minutes)
       VALUES ($1, $2, $3, 'telegram', $4, $5) RETURNING id`,
      [ids.companyId, ids.stopId, `Yolcu ${minutes}dk`, `chat-${minutes}`, minutes],
    )
    ids.passengers[minutes] = rows[0].id
  }
})

afterAll(async () => {
  if (app) {
    await app.redis.del(
      locationKey(ids.companyId, ids.routeId),
      etaKey(ids.companyId, ids.routeId),
      etaCalcKey(ids.routeId),
    )
    await app.db.query(
      `DELETE FROM trip_notifications WHERE trip_id IN
         (SELECT id FROM trips WHERE route_id = $1)`,
      [ids.routeId],
    )
    await app.db.query(
      `DELETE FROM trip_stops WHERE trip_id IN (SELECT id FROM trips WHERE route_id = $1)`,
      [ids.routeId],
    )
    await app.db.query('DELETE FROM trips WHERE route_id = $1', [ids.routeId])
    await app.db.query('DELETE FROM passengers WHERE stop_id = $1', [ids.stopId])
    await app.db.query('DELETE FROM stops WHERE id = $1', [ids.stopId])
    await app.db.query('DELETE FROM routes WHERE id = $1', [ids.routeId])
    await app.db.query('DELETE FROM users WHERE id = $1', [ids.driverId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

/** Opens a fresh trip; only one trip per route may be active. */
async function freshTrip() {
  await app.db.query(
    `UPDATE trips SET status = 'completed' WHERE route_id = $1 AND status = 'active'`,
    [ids.routeId],
  )
  const { rows } = await app.db.query(
    `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
    [ids.companyId, ids.routeId, ids.driverId],
  )
  await app.db.query(
    `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence) VALUES ($1, $2, $3, 1)`,
    [ids.companyId, rows[0].id, ids.stopId],
  )
  return rows[0].id
}

/** Far enough from the stop that it is never counted as passed. */
const setLocation = (lat, lng) =>
  app.redis.set(
    locationKey(ids.companyId, ids.routeId),
    JSON.stringify({ lat, lng, ts: Date.now() }),
    'EX',
    60,
  )

beforeEach(async () => {
  await app.redis.del(etaCalcKey(ids.routeId), etaKey(ids.companyId, ids.routeId))
})

/**
 * B10 — the vehicle stops (traffic light, layover). Ten cycles with the same
 * coordinate must not produce a second provider call, must not move the ETA,
 * and must not enqueue a second notification.
 */
describe('a stationary vehicle (B10)', () => {
  it('queries the provider once over 10 cycles and notifies once', async () => {
    const tripId = await freshTrip()
    await setLocation(41.2, 29.2)

    let calls = 0
    const enqueued = []
    const deps = {
      db: app.db,
      redis: app.redis,
      getEta: async (_origin, destinations) => {
        calls++
        return {
          seconds: destinations.map(() => 300), // 5 min — under every threshold
          source: 'google',
          elements: destinations.length,
        }
      },
      enqueueNotification: async (job) => enqueued.push(job),
    }
    const target = { companyId: ids.companyId, routeId: ids.routeId, tripId }

    const sources = []
    for (let i = 0; i < 10; i++) {
      const result = await computeEtaForRoute(deps, target)
      sources.push(result.source)
    }

    expect(calls).toBe(1) // the movement threshold blocks every later cycle
    expect(sources[0]).toBe('google')
    expect(sources.slice(1)).toEqual(new Array(9).fill('cached'))

    // The ETA does not drift while standing still
    const eta = JSON.parse(await app.redis.get(etaKey(ids.companyId, ids.routeId)))
    expect(eta.stops[0].etaSeconds).toBe(300)

    // Each of the three passengers is notified exactly once, not once per cycle
    expect(enqueued).toHaveLength(3)
    const { rows } = await app.db.query(
      'SELECT count(*)::int AS n FROM trip_notifications WHERE trip_id = $1',
      [tripId],
    )
    expect(rows[0].n).toBe(3)
  })
})

/**
 * D4 — three passengers at one stop with 5/10/15 minute thresholds. Each must
 * be notified as the ETA crosses their own threshold, and no earlier.
 */
describe('different thresholds at the same stop (D4)', () => {
  it('notifies each passenger at their own threshold', async () => {
    const tripId = await freshTrip()
    const target = { companyId: ids.companyId, routeId: ids.routeId, tripId }
    const enqueued = []

    // A fresh provider answer every step: the ETA falls 20 -> 15 -> 10 -> 5 min
    const step = async (seconds, lat, lng) => {
      await app.redis.del(etaCalcKey(ids.routeId)) // let the provider be asked again
      await setLocation(lat, lng)
      const before = enqueued.length
      await computeEtaForRoute(
        {
          db: app.db,
          redis: app.redis,
          getEta: async (_o, destinations) => ({
            seconds: destinations.map(() => seconds),
            source: 'google',
            elements: destinations.length,
          }),
          enqueueNotification: async (job) => enqueued.push(job),
        },
        target,
      )
      return enqueued.slice(before)
    }

    const at20 = await step(1200, 41.4, 29.4)
    expect(at20).toHaveLength(0) // nobody yet

    const at15 = await step(900, 41.35, 29.35)
    expect(at15.map((j) => j.passengerId)).toEqual([ids.passengers[15]])
    expect(at15[0].etaMinutes).toBe(15)

    const at10 = await step(600, 41.3, 29.3)
    expect(at10.map((j) => j.passengerId)).toEqual([ids.passengers[10]])

    const at5 = await step(300, 41.25, 29.25)
    expect(at5.map((j) => j.passengerId)).toEqual([ids.passengers[5]])

    // Three passengers, three notifications, no repeats
    expect(enqueued).toHaveLength(3)
    const { rows } = await app.db.query(
      'SELECT passenger_id, eta_minutes FROM trip_notifications WHERE trip_id = $1 ORDER BY eta_minutes',
      [tripId],
    )
    expect(rows.map((r) => r.eta_minutes)).toEqual([5, 10, 15])
  })
})
