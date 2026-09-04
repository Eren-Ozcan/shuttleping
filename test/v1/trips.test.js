/**
 * Trip lifecycle — real PostgreSQL + Redis.
 * The driver starts a trip -> sends a location -> the admin sees the trip -> the driver ends it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'
import { locationKey } from '../../src/services/eta/index.js'
import { generateToken, hashToken, createRefreshToken } from '../../src/services/auth.service.js'

let app
const ids = {}
let driverAuth
let adminAuth

function sign(role, sub) {
  return {
    authorization: `Bearer ${app.jwt.sign({ sub, role, companyId: ids.companyId })}`,
  }
}

beforeAll(async () => {
  app = await getTestApp()

  const company = await app.db.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Trip Test AŞ', 'trip-test-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id

  const driver = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES ($1, 'trip-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'Test Sürücü')
     RETURNING id`,
    [ids.companyId],
  )
  ids.driverId = driver.rows[0].id

  const admin = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES ($1, 'trip-admin-' || uuid_generate_v4() || '@t.local', 'x', 'company_admin', 'Test Admin')
     RETURNING id`,
    [ids.companyId],
  )
  ids.adminId = admin.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name, driver_id) VALUES ($1, 'T1', $2) RETURNING id`,
    [ids.companyId, ids.driverId],
  )
  ids.routeId = route.rows[0].id

  await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'D1', 41.0, 29.0, 1), ($1, $2, 'D2', 41.05, 29.05, 2)`,
    [ids.companyId, ids.routeId],
  )

  driverAuth = sign('driver', ids.driverId)
  adminAuth = sign('company_admin', ids.adminId)
})

afterAll(async () => {
  if (app) {
    await app.redis.del(locationKey(ids.companyId, ids.routeId))
    await app.db.query('DELETE FROM trip_notifications WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM location_history WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM trip_stops WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM trips WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM stops WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM routes WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM users WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

describe('trip lifecycle', () => {
  it('sending a location without an open trip returns 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: driverAuth,
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(409)
  })

  it('the driver starts a trip, trip_stops is snapshotted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/start',
      headers: driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(201)
    ids.tripId = res.json().id
    expect(res.json()).toMatchObject({ status: 'active', routeId: ids.routeId })

    const ts = await app.db.query(
      'SELECT count(*)::int AS n FROM trip_stops WHERE trip_id = $1',
      [ids.tripId],
    )
    expect(ts.rows[0].n).toBe(2)
  })

  it('start is idempotent — a second call returns the same trip (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/start',
      headers: driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(ids.tripId)
  })

  it('a location is sent with an active trip and lands in history with trip_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: driverAuth,
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ tripId: ids.tripId, routeId: ids.routeId })

    const lh = await app.db.query(
      'SELECT trip_id, heading, speed FROM location_history WHERE trip_id = $1',
      [ids.tripId],
    )
    expect(lh.rows.length).toBeGreaterThan(0)
    // B5 — heading/speed are optional; omitted is accepted and stored as null,
    // not defaulted to 0 (which would misreport a stationary vehicle)
    expect(lh.rows[0].heading).toBeNull()
    expect(lh.rows[0].speed).toBeNull()
  })

  // B9 — every ingest call writes exactly one history row (no batching, no
  // silent drop). At the real 10s cadence this ratio gives ≈360 rows/hour;
  // here it's checked at a scale the rate limit (12/min) actually allows.
  it('N pings write N more rows to location_history (B9)', async () => {
    await clearRateLimits(ids.driverId)
    const before = await app.db.query(
      'SELECT count(*)::int AS n FROM location_history WHERE trip_id = $1',
      [ids.tripId],
    )

    const PINGS = 10
    for (let i = 0; i < PINGS; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: driverAuth,
        payload: { lat: 41.0 + i * 0.0001, lng: 29.0 },
      })
      expect(res.statusCode).toBe(200)
    }

    const after = await app.db.query(
      'SELECT count(*)::int AS n FROM location_history WHERE trip_id = $1',
      [ids.tripId],
    )
    expect(after.rows[0].n - before.rows[0].n).toBe(PINGS)
  })

  // H6 — a live ping (no recordedAt) always lands with the server's own now(),
  // never anything the client claims. A skewed phone clock only ever matters
  // for a backfill flush, where recordedAt is the point's real capture time —
  // not tested here, that's the intended behavior, not a bug.
  it('a live ping is timestamped by the server, not the client (H6)', async () => {
    await clearRateLimits(ids.driverId)
    const before = Date.now()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: driverAuth,
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(200)

    const { rows } = await app.db.query(
      `SELECT recorded_at FROM location_history WHERE trip_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [ids.tripId],
    )
    const recordedAtMs = new Date(rows[0].recorded_at).getTime()
    expect(recordedAtMs).toBeGreaterThanOrEqual(before - 1000)
    expect(recordedAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('the admin sees the trip in the list and in the detail', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/trips?status=active',
      headers: adminAuth,
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().items.some((t) => t.id === ids.tripId)).toBe(true)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${ids.tripId}`,
      headers: adminAuth,
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().stops).toHaveLength(2)
    expect(detail.json().notifications).toEqual({ sent: 0, failed: 0 })
  })

  it('another company\'s admin cannot see the trip (404)', async () => {
    const otherAuth = {
      authorization: `Bearer ${app.jwt.sign({
        sub: ids.adminId,
        role: 'company_admin',
        companyId: '00000000-0000-4000-8000-0000000000ff',
      })}`,
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${ids.tripId}`,
      headers: otherAuth,
    })
    expect(res.statusCode).toBe(404)
  })

  it('the driver ends the trip, the live location key is deleted', async () => {
    await app.redis.set(locationKey(ids.companyId, ids.routeId), '{}', 'EX', 60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/end',
      headers: driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(await app.redis.get(locationKey(ids.companyId, ids.routeId))).toBeNull()

    const t = await app.db.query('SELECT status FROM trips WHERE id = $1', [ids.tripId])
    expect(t.rows[0].status).toBe('completed')
  })

  it('end returns 404 again after the trip is finished', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/end',
      headers: driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

// B3 — a driver assigned to two active routes must get a deterministic pick,
// not whichever row Postgres happens to return first
describe('trips/start route selection is deterministic (B3)', () => {
  const b3 = {}

  beforeAll(async () => {
    const company = await app.db.query(
      `INSERT INTO companies (name, slug) VALUES ('B3 Test AŞ', 'b3-test-' || uuid_generate_v4()) RETURNING id`,
    )
    b3.companyId = company.rows[0].id

    const driver = await app.db.query(
      `INSERT INTO users (company_id, email, password_hash, role, full_name)
       VALUES ($1, 'b3-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'B3 Sürücü')
       RETURNING id`,
      [b3.companyId],
    )
    b3.driverId = driver.rows[0].id

    // Second route is inserted first on purpose — proves the pick is by
    // created_at, not insertion/scan order
    const routeNewer = await app.db.query(
      `INSERT INTO routes (company_id, name, driver_id, created_at)
       VALUES ($1, 'Yeni Hat', $2, now()) RETURNING id`,
      [b3.companyId, b3.driverId],
    )
    b3.newerRouteId = routeNewer.rows[0].id

    const routeOlder = await app.db.query(
      `INSERT INTO routes (company_id, name, driver_id, created_at)
       VALUES ($1, 'Eski Hat', $2, now() - interval '1 day') RETURNING id`,
      [b3.companyId, b3.driverId],
    )
    b3.olderRouteId = routeOlder.rows[0].id

    b3.driverAuth = {
      authorization: `Bearer ${app.jwt.sign({
        sub: b3.driverId,
        role: 'driver',
        companyId: b3.companyId,
      })}`,
    }
  })

  afterAll(async () => {
    await app.db.query('DELETE FROM trip_stops WHERE company_id = $1', [b3.companyId])
    await app.db.query('DELETE FROM trips WHERE company_id = $1', [b3.companyId])
    await app.db.query('DELETE FROM routes WHERE company_id = $1', [b3.companyId])
    await app.db.query('DELETE FROM users WHERE company_id = $1', [b3.companyId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [b3.companyId])
  })

  it('picks the oldest-created active route, not the most recently inserted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/start',
      headers: b3.driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().routeId).toBe(b3.olderRouteId)
  })
})

/**
 * A2 — the driver's session must survive a very short access token lifetime
 * as long as it refreshes in time (this is what driver.js's 12-minute silent
 * refresh, T1.2, relies on). Instead of a real 15-minute token and a real
 * 10-minute wait, each access token here is signed with a 1s expiry so the
 * whole expire -> 401 -> refresh -> 200 cycle can be proven a few times over
 * in real seconds — the mechanism is what's tested, not wall-clock endurance.
 */
describe('a short-lived access token survives via refresh (A2)', () => {
  const a2 = {}

  beforeAll(async () => {
    const company = await app.db.query(
      `INSERT INTO companies (name, slug) VALUES ('A2 Test AŞ', 'a2-test-' || uuid_generate_v4()) RETURNING id`,
    )
    a2.companyId = company.rows[0].id

    const driver = await app.db.query(
      `INSERT INTO users (company_id, email, password_hash, role, full_name)
       VALUES ($1, 'a2-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'A2 Sürücü')
       RETURNING id`,
      [a2.companyId],
    )
    a2.driverId = driver.rows[0].id

    const route = await app.db.query(
      `INSERT INTO routes (company_id, name, driver_id) VALUES ($1, 'A2 Hat', $2) RETURNING id`,
      [a2.companyId, a2.driverId],
    )
    a2.routeId = route.rows[0].id

    const trip = await app.db.query(
      `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
      [a2.companyId, a2.routeId, a2.driverId],
    )
    a2.tripId = trip.rows[0].id

    // A refresh cookie without going through /auth/login — this driver has no
    // usable password hash, and only the cookie mechanics are under test here
    a2.refreshToken = generateToken()
    await createRefreshToken(a2.driverId, hashToken(a2.refreshToken), new Date(Date.now() + 3_600_000))
  })

  afterAll(async () => {
    await app.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [a2.driverId])
    await app.db.query('DELETE FROM location_history WHERE company_id = $1', [a2.companyId])
    await app.db.query('DELETE FROM trips WHERE company_id = $1', [a2.companyId])
    await app.db.query('DELETE FROM routes WHERE company_id = $1', [a2.companyId])
    await app.db.query('DELETE FROM users WHERE company_id = $1', [a2.companyId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [a2.companyId])
  })

  it('expire -> 401 -> refresh -> 200 repeats without ever losing the session', async () => {
    let refreshCookie = a2.refreshToken

    for (let cycle = 0; cycle < 3; cycle++) {
      // A fresh 1s-lived probe token per cycle — the real access token always
      // gets the plugin's full lifetime; expiresIn is only overridden here to
      // compress "shortly before it would expire" into real test seconds
      const shortToken = app.jwt.sign(
        { sub: a2.driverId, role: 'driver', companyId: a2.companyId },
        { expiresIn: '1s' },
      )

      const ping = await app.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: { authorization: `Bearer ${shortToken}` },
        payload: { lat: 41.0, lng: 29.0 },
      })
      expect(ping.statusCode).toBe(200)

      await new Promise((resolve) => setTimeout(resolve, 1100))

      const expiredPing = await app.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: { authorization: `Bearer ${shortToken}` },
        payload: { lat: 41.0, lng: 29.0 },
      })
      expect(expiredPing.statusCode).toBe(401)

      // The refresh cookie is unaffected by the access token's short life —
      // this is the driver.js contract (T1.2): refresh in time, keep pinging
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        cookies: { refreshToken: refreshCookie },
      })
      expect(refreshRes.statusCode).toBe(200)
      refreshCookie = refreshRes.cookies.find((c) => c.name === 'refreshToken').value

      const resumed = await app.inject({
        method: 'POST',
        url: '/api/v1/locations',
        headers: { authorization: `Bearer ${refreshRes.json().accessToken}` },
        payload: { lat: 41.0, lng: 29.0 },
      })
      expect(resumed.statusCode).toBe(200)
    }
  })
})
