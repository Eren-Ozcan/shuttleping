/**
 * ETA core integration test — uses real PostgreSQL + Redis, with getEta and
 * enqueueNotification passed as fakes. Test data is created with a unique slug
 * and physically deleted at the end (this is the test DB).
 *
 * Phase A: dedup is now via the trip_notifications table; every trip is a trips
 * row, stop state is trip_stops.state.
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
     VALUES ('ETA Test AŞ', 'eta-test-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name) VALUES ($1, 'Test Hattı') RETURNING id`,
    [ids.companyId],
  )
  ids.routeId = route.rows[0].id

  const driver = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES ($1, 'eta-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'Sürücü')
     RETURNING id`,
    [ids.companyId],
  )
  ids.driverId = driver.rows[0].id

  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'Meydan', 40.99, 29.02, 1) RETURNING id`,
    [ids.companyId, ids.routeId],
  )
  ids.stopId = stop.rows[0].id

  const passenger = await app.db.query(
    `INSERT INTO passengers (company_id, stop_id, full_name, notification_channel, telegram_chat_id, notify_before_minutes)
     VALUES ($1, $2, 'Ayşe Yılmaz', 'telegram', '12345', 10) RETURNING id`,
    [ids.companyId, ids.stopId],
  )
  ids.passengerId = passenger.rows[0].id

  const trip = await app.db.query(
    `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
    [ids.companyId, ids.routeId, ids.driverId],
  )
  ids.tripId = trip.rows[0].id
  await app.db.query(
    `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence)
     VALUES ($1, $2, $3, 1)`,
    [ids.companyId, ids.tripId, ids.stopId],
  )

  // C7 — a route with no stops at all (e.g. just created, not configured yet)
  const emptyRoute = await app.db.query(
    `INSERT INTO routes (company_id, name) VALUES ($1, 'Boş Hat') RETURNING id`,
    [ids.companyId],
  )
  ids.emptyRouteId = emptyRoute.rows[0].id
  const emptyTrip = await app.db.query(
    `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
    [ids.companyId, ids.emptyRouteId, ids.driverId],
  )
  ids.emptyTripId = emptyTrip.rows[0].id
})

afterAll(async () => {
  if (app) {
    await app.redis.del(
      locationKey(ids.companyId, ids.routeId),
      etaKey(ids.companyId, ids.routeId),
    )
    await app.db.query('DELETE FROM trip_notifications WHERE trip_id = $1', [ids.tripId])
    await app.db.query('DELETE FROM trip_stops WHERE trip_id = $1', [ids.tripId])
    await app.db.query('DELETE FROM trips WHERE id = ANY($1)', [[ids.tripId, ids.emptyTripId]])
    await app.db.query('DELETE FROM passengers WHERE id = $1', [ids.passengerId])
    await app.db.query('DELETE FROM stops WHERE id = $1', [ids.stopId])
    await app.db.query('DELETE FROM routes WHERE id = ANY($1)', [[ids.routeId, ids.emptyRouteId]])
    await app.db.query('DELETE FROM users WHERE id = $1', [ids.driverId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

/** Mimics the provider response: a fixed number of seconds per stop. */
const provider = (seconds) => async (origin, destinations) => ({
  seconds: destinations.map(() => seconds),
  source: 'google',
  elements: destinations.length,
})

function deps(overrides = {}) {
  return {
    db: app.db,
    redis: app.redis,
    getEta: provider(300), // 5 min — under the 10 min threshold
    enqueueNotification: async () => {},
    ...overrides,
  }
}

// Keep the throttle key from leaking between tests — every test can query fresh
beforeEach(async () => {
  await app.redis.del(etaCalcKey(ids.routeId), etaKey(ids.companyId, ids.routeId))
})

const target = () => ({
  companyId: ids.companyId,
  routeId: ids.routeId,
  tripId: ids.tripId,
})

describe('computeEtaForRoute', () => {
  it('skips the job when there is no location in Redis', async () => {
    const result = await computeEtaForRoute(deps(), target())
    expect(result).toEqual({ skipped: 'no_location' })
  })

  // C7 — a route with no stops configured must not crash or query the provider
  it('skips with no_stops for a route that has no stops (C7)', async () => {
    await app.redis.set(
      locationKey(ids.companyId, ids.emptyRouteId),
      JSON.stringify({ lat: 40.99, lng: 29.02, ts: Date.now() }),
      'EX',
      60,
    )
    const result = await computeEtaForRoute(deps(), {
      companyId: ids.companyId,
      routeId: ids.emptyRouteId,
      tripId: ids.emptyTripId,
    })
    expect(result).toEqual({ skipped: 'no_stops' })
    await app.redis.del(locationKey(ids.companyId, ids.emptyRouteId))
  })

  it('enqueues a notification for an ETA under the threshold and writes the ETA to Redis', async () => {
    // Keep the location far from the stop so the stop is not counted as "passed"
    await app.redis.set(
      locationKey(ids.companyId, ids.routeId),
      JSON.stringify({ lat: 41.2, lng: 29.2, ts: Date.now() }),
      'EX',
      60,
    )

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      target(),
    )

    expect(result).toMatchObject({ ok: true, stopCount: 1, notified: 1 })
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({
      passengerId: ids.passengerId,
      stopId: ids.stopId,
      stopName: 'Meydan',
      etaMinutes: 5,
      tripId: ids.tripId,
    })

    const eta = JSON.parse(await app.redis.get(etaKey(ids.companyId, ids.routeId)))
    expect(eta.stops).toHaveLength(1)
    expect(eta.stops[0]).toMatchObject({ stopId: ids.stopId, etaSeconds: 300 })

    const ts = await app.db.query(
      'SELECT state FROM trip_stops WHERE trip_id = $1 AND stop_id = $2',
      [ids.tripId, ids.stopId],
    )
    expect(ts.rows[0].state).toBe('notified')
  })

  it('does not send a second notification for the same trip + passenger (dedup)', async () => {
    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      target(),
    )

    expect(result).toMatchObject({ ok: true, notified: 0 })
    expect(enqueued).toHaveLength(0)
  })

  it('notifies the same passenger again when a new trip opens', async () => {
    // One active trip per route — close the previous test's trip
    await app.db.query(
      `UPDATE trips SET status = 'completed' WHERE route_id = $1 AND status = 'active'`,
      [ids.routeId],
    )
    const trip2 = await app.db.query(
      `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
      [ids.companyId, ids.routeId, ids.driverId],
    )
    const trip2Id = trip2.rows[0].id
    await app.db.query(
      `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence) VALUES ($1, $2, $3, 1)`,
      [ids.companyId, trip2Id, ids.stopId],
    )

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      { companyId: ids.companyId, routeId: ids.routeId, tripId: trip2Id },
    )
    expect(result).toMatchObject({ ok: true, notified: 1 })
    expect(enqueued).toHaveLength(1)

    await app.db.query('DELETE FROM trip_notifications WHERE trip_id = $1', [trip2Id])
    await app.db.query('DELETE FROM trip_stops WHERE trip_id = $1', [trip2Id])
    await app.db.query('DELETE FROM trips WHERE id = $1', [trip2Id])
  })

  it('does not notify when the ETA is above the threshold', async () => {
    await app.db.query(
      `UPDATE trips SET status = 'completed' WHERE route_id = $1 AND status = 'active'`,
      [ids.routeId],
    )
    const trip3 = await app.db.query(
      `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
      [ids.companyId, ids.routeId, ids.driverId],
    )
    const trip3Id = trip3.rows[0].id
    await app.db.query(
      `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence) VALUES ($1, $2, $3, 1)`,
      [ids.companyId, trip3Id, ids.stopId],
    )

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({
        getEta: provider(1800), // 30 min > 10 min threshold
        enqueueNotification: async (job) => enqueued.push(job),
      }),
      { companyId: ids.companyId, routeId: ids.routeId, tripId: trip3Id },
    )

    expect(result).toMatchObject({ ok: true, notified: 0 })
    expect(enqueued).toHaveLength(0)

    await app.db.query('DELETE FROM trip_stops WHERE trip_id = $1', [trip3Id])
    await app.db.query('DELETE FROM trips WHERE id = $1', [trip3Id])
  })
})

/** Phase B — cost control on the provider call. */
describe('computeEtaForRoute cost control', () => {
  async function freshTrip() {
    await app.db.query(
      `UPDATE trips SET status = 'completed' WHERE route_id = $1 AND status = 'active'`,
      [ids.routeId],
    )
    const trip = await app.db.query(
      `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
      [ids.companyId, ids.routeId, ids.driverId],
    )
    const tripId = trip.rows[0].id
    await app.db.query(
      `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence) VALUES ($1, $2, $3, 1)`,
      [ids.companyId, tripId, ids.stopId],
    )
    return tripId
  }

  it('does not query the provider twice within the throttle window, reuses the previous ETA', async () => {
    const tripId = await freshTrip()
    await app.redis.set(
      locationKey(ids.companyId, ids.routeId),
      JSON.stringify({ lat: 41.2, lng: 29.2, ts: Date.now() }),
      'EX',
      60,
    )

    let calls = 0
    const counting = async (origin, destinations) => {
      calls++
      return {
        seconds: destinations.map(() => 1800),
        source: 'google',
        elements: destinations.length,
      }
    }

    const first = await computeEtaForRoute(deps({ getEta: counting }), {
      companyId: ids.companyId,
      routeId: ids.routeId,
      tripId,
    })
    expect(first.source).toBe('google')
    expect(calls).toBe(1)

    // Move the vehicle so the throttle kicks in, not the "did not move" rule
    await app.redis.set(
      locationKey(ids.companyId, ids.routeId),
      JSON.stringify({ lat: 41.25, lng: 29.25, ts: Date.now() }),
      'EX',
      60,
    )
    const second = await computeEtaForRoute(deps({ getEta: counting }), {
      companyId: ids.companyId,
      routeId: ids.routeId,
      tripId,
    })

    expect(calls).toBe(1) // blocked by the throttle
    expect(second.source).toBe('cached')

    const eta = JSON.parse(await app.redis.get(etaKey(ids.companyId, ids.routeId)))
    expect(eta.stops[0].etaSeconds).toBe(1800) // previous provider result kept

    await app.db.query('DELETE FROM trip_stops WHERE trip_id = $1', [tripId])
    await app.db.query('DELETE FROM trips WHERE id = $1', [tripId])
  })

  it('does not query the provider for a passed stop', async () => {
    const tripId = await freshTrip()
    await app.db.query(
      `UPDATE trip_stops SET state = 'passed', passed_at = now() WHERE trip_id = $1`,
      [tripId],
    )
    await app.redis.set(
      locationKey(ids.companyId, ids.routeId),
      JSON.stringify({ lat: 41.2, lng: 29.2, ts: Date.now() }),
      'EX',
      60,
    )

    let asked = null
    const result = await computeEtaForRoute(
      deps({
        getEta: async (origin, destinations) => {
          asked = destinations
          return { seconds: [], source: 'google', elements: 0 }
        },
      }),
      { companyId: ids.companyId, routeId: ids.routeId, tripId },
    )

    expect(asked).toBeNull() // never queried
    expect(result).toMatchObject({ ok: true, notified: 0 })

    await app.db.query('DELETE FROM trip_stops WHERE trip_id = $1', [tripId])
    await app.db.query('DELETE FROM trips WHERE id = $1', [tripId])
  })
})
