/**
 * Phase C — revenue protection. Graduated suspension behavior:
 *   overdue   -> company_admin login closed, driver works, no Google queries
 *   suspended -> all logins closed, location ingest rejected, no notifications
 * Also the passenger quota and the payment ledger.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'
import { computeEtaForRoute, locationKey } from '../../src/services/eta/index.js'
import { invalidateCompanyAccess } from '../../src/services/billing.service.js'
import { hashPassword } from '../../src/services/auth.service.js'

let app
const ids = {}
const PASSWORD = 'gecerliSifre123'
// A rate-limit bucket specific to this file — so parallel test files do not
// consume each other's login quota
const IP = '10.0.0.2'

const auth = (role, sub) => ({
  authorization: `Bearer ${app.jwt.sign({ sub, role, companyId: ids.companyId })}`,
})

async function setStatus(status) {
  await app.db.query('UPDATE companies SET payment_status = $2 WHERE id = $1', [
    ids.companyId,
    status,
  ])
  await invalidateCompanyAccess(ids.companyId, app.redis)
}

beforeAll(async () => {
  app = await getTestApp()

  const company = await app.db.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Billing Test AŞ', 'billing-test-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id
  ids.slug = `billing-${Date.now()}`

  const hash = await hashPassword(PASSWORD)
  const mkUser = async (role) => {
    const { rows } = await app.db.query(
      `INSERT INTO users (company_id, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email`,
      [ids.companyId, `${role}-${ids.slug}@t.local`, hash, role, `Test ${role}`],
    )
    return rows[0]
  }
  const admin = await mkUser('company_admin')
  const driver = await mkUser('driver')
  ids.adminId = admin.id
  ids.adminEmail = admin.email
  ids.driverId = driver.id
  ids.driverEmail = driver.email

  // company_payments.recorded_by must point at a real user
  const superAdmin = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES (NULL, $1, $2, 'super_admin', 'Test Super') RETURNING id`,
    [`super-${ids.slug}@t.local`, hash],
  )
  ids.superAdminId = superAdmin.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name, driver_id) VALUES ($1, 'B1', $2) RETURNING id`,
    [ids.companyId, ids.driverId],
  )
  ids.routeId = route.rows[0].id

  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'BD1', 41.0, 29.0, 1) RETURNING id`,
    [ids.companyId, ids.routeId],
  )
  ids.stopId = stop.rows[0].id

  const passenger = await app.db.query(
    `INSERT INTO passengers (company_id, stop_id, full_name, notification_channel,
       telegram_chat_id, notify_before_minutes)
     VALUES ($1, $2, 'Yolcu', 'telegram', '999', 10) RETURNING id`,
    [ids.companyId, ids.stopId],
  )
  ids.passengerId = passenger.rows[0].id

  const trip = await app.db.query(
    `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
    [ids.companyId, ids.routeId, ids.driverId],
  )
  ids.tripId = trip.rows[0].id
  await app.db.query(
    `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence) VALUES ($1, $2, $3, 1)`,
    [ids.companyId, ids.tripId, ids.stopId],
  )
})

beforeEach(async () => {
  await clearRateLimits(IP)
  await setStatus('active')
})

afterAll(async () => {
  if (app) {
    await app.redis.del(locationKey(ids.companyId, ids.routeId))
    await invalidateCompanyAccess(ids.companyId, app.redis)
    const del = (sql) => app.db.query(sql, [ids.companyId])
    await del('DELETE FROM trip_notifications WHERE company_id = $1')
    await del('DELETE FROM location_history WHERE company_id = $1')
    await del('DELETE FROM trip_stops WHERE company_id = $1')
    await del('DELETE FROM trips WHERE company_id = $1')
    await del('DELETE FROM notification_logs WHERE company_id = $1')
    await del('DELETE FROM passengers WHERE company_id = $1')
    await del('DELETE FROM stops WHERE company_id = $1')
    await del('DELETE FROM routes WHERE company_id = $1')
    await del('DELETE FROM company_payments WHERE company_id = $1')
    await app.db.query(
      'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)',
      [ids.companyId],
    )
    await del('DELETE FROM users WHERE company_id = $1')
    await app.db.query('DELETE FROM users WHERE id = $1', [ids.superAdminId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

const login = (email) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: IP,
    payload: { email, password: PASSWORD },
  })

describe('graduated suspension — login gate', () => {
  it('active: both admin and driver can log in', async () => {
    expect((await login(ids.adminEmail)).statusCode).toBe(200)
    expect((await login(ids.driverEmail)).statusCode).toBe(200)
  })

  it('overdue: admin gets 402, driver can still log in', async () => {
    await setStatus('overdue')
    expect((await login(ids.adminEmail)).statusCode).toBe(402)
    // The service must keep running for passengers — the pressure is on the account owner
    expect((await login(ids.driverEmail)).statusCode).toBe(200)
  })

  it('suspended: both roles get 402', async () => {
    await setStatus('suspended')
    expect((await login(ids.adminEmail)).statusCode).toBe(402)
    expect((await login(ids.driverEmail)).statusCode).toBe(402)
  })

  it('403 regardless of role when the company is inactive', async () => {
    await app.db.query('UPDATE companies SET is_active = false WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)
    expect((await login(ids.driverEmail)).statusCode).toBe(403)
    await app.db.query('UPDATE companies SET is_active = true WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)
  })
})

describe('graduated suspension — spending stops', () => {
  const deps = (overrides = {}) => ({
    db: app.db,
    redis: app.redis,
    getEta: async (origin, destinations) => ({
      seconds: destinations.map(() => 300),
      source: 'google',
      elements: destinations.length,
    }),
    enqueueNotification: async () => {},
    ...overrides,
  })

  beforeEach(async () => {
    // The stop is at 41.0/29.0. The vehicle is ~2 km north: haversine ETA ~5 min
    // (25 km/h), i.e. under the notification threshold (10 min) but outside the
    // "passed" radius. So a notification can be produced in the overdue scenario
    // without Google.
    await app.redis.set(
      locationKey(ids.companyId, ids.routeId),
      JSON.stringify({ lat: 41.018, lng: 29.0, ts: Date.now() }),
      'EX',
      60,
    )
    await app.redis.del(`etacalc:${ids.routeId}`)
    await app.db.query('DELETE FROM trip_notifications WHERE trip_id = $1', [ids.tripId])
    await app.db.query(
      `UPDATE trip_stops SET state = 'pending', notified_at = NULL WHERE trip_id = $1`,
      [ids.tripId],
    )
  })

  it('overdue: no Google query, but notifications still go out', async () => {
    await setStatus('overdue')

    let providerCalls = 0
    const enqueued = []
    const result = await computeEtaForRoute(
      deps({
        getEta: async (origin, destinations) => {
          providerCalls++
          return { seconds: destinations.map(() => 300), source: 'google', elements: 1 }
        },
        enqueueNotification: async (job) => enqueued.push(job),
      }),
      { companyId: ids.companyId, routeId: ids.routeId, tripId: ids.tripId },
    )

    expect(providerCalls).toBe(0) // no billed call
    expect(result.source).toBe('haversine')
    expect(enqueued).toHaveLength(1) // the passenger is still informed
  })

  it('suspended: no notification is produced either', async () => {
    await setStatus('suspended')

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      { companyId: ids.companyId, routeId: ids.routeId, tripId: ids.tripId },
    )

    expect(result).toMatchObject({ ok: true, notified: 0, billingBlocked: true })
    expect(enqueued).toHaveLength(0)
  })

  it('suspended: the driver location is rejected', async () => {
    await setStatus('suspended')
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: auth('driver', ids.driverId),
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(402)
  })
})

describe('passenger quota (C6)', () => {
  afterAll(async () => {
    await app.db.query('UPDATE companies SET max_passengers = NULL WHERE id = $1', [
      ids.companyId,
    ])
    await invalidateCompanyAccess(ids.companyId, app.redis)
  })

  it('a new passenger is rejected with 402 when the quota is full', async () => {
    // There is already 1 active passenger
    await app.db.query('UPDATE companies SET max_passengers = 1 WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passengers',
      headers: auth('company_admin', ids.adminId),
      payload: {
        stopId: ids.stopId,
        fullName: 'Kotayı Aşan',
        telegramChatId: '1',
        consentGiven: true,
      },
    })
    expect(res.statusCode).toBe(402)
    expect(res.json().message).toContain('1/1')
  })

  it('a passenger can be added once the quota is raised', async () => {
    await app.db.query('UPDATE companies SET max_passengers = 5 WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passengers',
      headers: auth('company_admin', ids.adminId),
      payload: {
        stopId: ids.stopId,
        fullName: 'Kota İçi',
        telegramChatId: '2',
        consentGiven: true,
      },
    })
    expect(res.statusCode).toBe(201)
    await app.db.query('DELETE FROM passengers WHERE id = $1', [res.json().id])
  })
})

describe('refresh token family (D9)', () => {
  /** Login -> extracts the refresh cookie. */
  async function loginCookie(email) {
    const res = await login(email)
    expect(res.statusCode).toBe(200)
    return res.cookies.find((c) => c.name === 'refreshToken').value
  }

  const refresh = (cookie) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      remoteAddress: IP,
      cookies: { refreshToken: cookie },
    })

  it('rotation works: the new token is valid, the old one is no longer accepted', async () => {
    const first = await loginCookie(ids.driverEmail)

    const rotated = await refresh(first)
    expect(rotated.statusCode).toBe(200)
    const second = rotated.cookies.find((c) => c.name === 'refreshToken').value
    expect(second).not.toBe(first)

    expect((await refresh(second)).statusCode).toBe(200)
  })

  it('reusing a revoked token drops the whole family', async () => {
    const first = await loginCookie(ids.driverEmail)

    const rotated = await refresh(first)
    expect(rotated.statusCode).toBe(200)
    const second = rotated.cookies.find((c) => c.name === 'refreshToken').value

    // Stolen copy: the old token, already revoked by rotation, is presented again
    const replay = await refresh(first)
    expect(replay.statusCode).toBe(401)

    // Theft detected — the legitimate session must end too, otherwise the
    // attacker keeps refreshing while the user notices nothing
    expect((await refresh(second)).statusCode).toBe(401)
  })

  // A4 — logout revokes the refresh cookie server-side; a refresh attempt
  // after logout must fail even though the client still holds the old cookie
  it('a refresh attempt after logout returns 401 (A4)', async () => {
    const cookie = await loginCookie(ids.driverEmail)

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      remoteAddress: IP,
      cookies: { refreshToken: cookie },
    })
    expect(logoutRes.statusCode).toBe(200)

    expect((await refresh(cookie)).statusCode).toBe(401)
  })
})

// A8 — a signature-tampered access token must be rejected outright, and the
// error response must not leak the token's decoded payload
describe('tampered access token (A8)', () => {
  it('returns 401 for a token with a flipped signature, no payload leak', async () => {
    const valid = app.jwt.sign({ sub: ids.driverId, role: 'driver', companyId: ids.companyId })
    const [header, payload, signature] = valid.split('.')
    const tamperedSig = signature.slice(0, -1) + (signature.at(-1) === 'A' ? 'B' : 'A')
    const tampered = `${header}.${payload}.${tamperedSig}`

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: { authorization: `Bearer ${tampered}` },
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(401)
    expect(res.body).not.toContain(ids.driverId)
  })

  it('returns 401 for a structurally invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: { authorization: 'Bearer not-a-jwt-at-all' },
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('payment ledger (C4)', () => {
  it('marking payment received writes a history row', async () => {
    const superAuth = {
      authorization: `Bearer ${app.jwt.sign({
        sub: ids.superAdminId,
        role: 'super_admin',
        companyId: null,
      })}`,
    }

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${ids.companyId}/payment-status`,
      headers: superAuth,
      payload: { paymentStatus: 'active', amount: 1500, note: 'IBAN havale' },
    })
    expect(patch.statusCode).toBe(200)

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${ids.companyId}/payments`,
      headers: superAuth,
    })
    expect(list.statusCode).toBe(200)
    const [payment] = list.json().items
    expect(payment).toMatchObject({ note: 'IBAN havale' })
    expect(Number(payment.amount)).toBe(1500)
  })
})
