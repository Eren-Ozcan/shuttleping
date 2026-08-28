/**
 * Multi-tenancy isolation matrix (PILOT-READINESS F).
 *
 * This is the product's most basic security promise: `company_id` is read only
 * from the JWT and is required on every query. Despite that, there was not a
 * single isolation test until now — the existing tests work with one company
 * and never attempt a cross-read.
 *
 * Setup: two separate companies (A and B), each with its own route, stop,
 * passenger, vehicle and users. A's admin must not be able to see or modify any
 * of B's records, nor link B's resources to its own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'

let app
const A = { label: 'A' }
const B = { label: 'B' }

const authFor = (tenant, role = 'company_admin') => ({
  authorization: `Bearer ${app.jwt.sign({
    sub: role === 'driver' ? tenant.driverId : tenant.adminId,
    role,
    companyId: tenant.companyId,
  })}`,
})

async function seedTenant(tenant) {
  const suffix = `${tenant.label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const company = await app.db.query(
    `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
    [`Tenant ${tenant.label}`, `tenant-${suffix}`.toLowerCase()],
  )
  tenant.companyId = company.rows[0].id

  const mkUser = async (role) => {
    const { rows } = await app.db.query(
      `INSERT INTO users (company_id, email, password_hash, role, full_name)
       VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [tenant.companyId, `${role}-${suffix}@t.local`, role, `${role} ${tenant.label}`],
    )
    return rows[0].id
  }
  tenant.adminId = await mkUser('company_admin')
  tenant.driverId = await mkUser('driver')

  const vehicle = await app.db.query(
    `INSERT INTO vehicles (company_id, plate) VALUES ($1, $2) RETURNING id`,
    [tenant.companyId, `34 ${tenant.label}${Date.now() % 10000}`],
  )
  tenant.vehicleId = vehicle.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name, driver_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.companyId, `Hat ${tenant.label}`, tenant.driverId],
  )
  tenant.routeId = route.rows[0].id

  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, $3, 41.0, 29.0, 1) RETURNING id`,
    [tenant.companyId, tenant.routeId, `Durak ${tenant.label}`],
  )
  tenant.stopId = stop.rows[0].id

  const passenger = await app.db.query(
    `INSERT INTO passengers (company_id, stop_id, full_name, telegram_chat_id)
     VALUES ($1, $2, $3, '1') RETURNING id`,
    [tenant.companyId, tenant.stopId, `Yolcu ${tenant.label}`],
  )
  tenant.passengerId = passenger.rows[0].id

  const trip = await app.db.query(
    `INSERT INTO trips (company_id, route_id, driver_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.companyId, tenant.routeId, tenant.driverId],
  )
  tenant.tripId = trip.rows[0].id

  await app.db.query(
    `INSERT INTO notification_logs (company_id, passenger_id, route_id, stop_id,
       channel, message, status)
     VALUES ($1, $2, $3, $4, 'telegram', $5, 'sent')`,
    [tenant.companyId, tenant.passengerId, tenant.routeId, tenant.stopId, `mesaj ${tenant.label}`],
  )

  await app.db.query(
    `INSERT INTO location_history (company_id, route_id, trip_id, driver_id, lat, lng)
     VALUES ($1, $2, $3, $4, 41.0, 29.0)`,
    [tenant.companyId, tenant.routeId, tenant.tripId, tenant.driverId],
  )
}

async function purgeTenant(tenant) {
  if (!tenant.companyId) return
  const del = (sql) => app.db.query(sql, [tenant.companyId])
  await del('DELETE FROM trip_notifications WHERE company_id = $1')
  await del('DELETE FROM location_history WHERE company_id = $1')
  await del('DELETE FROM trip_stops WHERE company_id = $1')
  await del('DELETE FROM trips WHERE company_id = $1')
  await del('DELETE FROM notification_logs WHERE company_id = $1')
  await del('DELETE FROM passengers WHERE company_id = $1')
  await del('DELETE FROM stops WHERE company_id = $1')
  await del('DELETE FROM routes WHERE company_id = $1')
  await del('DELETE FROM vehicles WHERE company_id = $1')
  await app.db.query(
    'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)',
    [tenant.companyId],
  )
  await del('DELETE FROM users WHERE company_id = $1')
  await app.db.query('DELETE FROM companies WHERE id = $1', [tenant.companyId])
}

beforeAll(async () => {
  app = await getTestApp()
  await seedTenant(A)
  await seedTenant(B)
})

afterAll(async () => {
  if (app) {
    await purgeTenant(A)
    await purgeTenant(B)
  }
  await closeTestApp()
})

/** Makes a request as A's admin. */
const asA = (method, url, payload) =>
  app.inject({ method, url, headers: authFor(A), ...(payload ? { payload } : {}) })

describe('list endpoints return only the caller\'s own tenant', () => {
  const cases = [
    ['/api/v1/routes', (t) => t.routeId],
    ['/api/v1/vehicles', (t) => t.vehicleId],
    ['/api/v1/users', (t) => t.adminId],
    ['/api/v1/passengers', (t) => t.passengerId],
  ]

  it.each(cases)('GET %s', async (url, pick) => {
    const res = await asA('GET', url)
    expect(res.statusCode).toBe(200)
    const ids = res.json().map((row) => row.id)
    expect(ids).toContain(pick(A))
    expect(ids).not.toContain(pick(B))
  })

  it('GET /api/v1/trips', async () => {
    const res = await asA('GET', '/api/v1/trips')
    expect(res.statusCode).toBe(200)
    const ids = res.json().items.map((row) => row.id)
    expect(ids).toContain(A.tripId)
    expect(ids).not.toContain(B.tripId)
  })

  it('GET /api/v1/history/notifications', async () => {
    const res = await asA('GET', '/api/v1/history/notifications')
    expect(res.statusCode).toBe(200)
    const messages = res.json().items.map((row) => row.message)
    expect(messages).toContain('mesaj A')
    expect(messages).not.toContain('mesaj B')
  })
})

describe('a single read does not return another tenant\'s record', () => {
  it('GET /trips/:id → 404', async () => {
    expect((await asA('GET', `/api/v1/trips/${B.tripId}`)).statusCode).toBe(404)
  })

  it('GET /routes/:id/stops → 404', async () => {
    expect((await asA('GET', `/api/v1/routes/${B.routeId}/stops`)).statusCode).toBe(404)
  })

  it('GET /history/locations/:routeId -> empty list, B\'s trace does not leak', async () => {
    const res = await asA('GET', `/api/v1/history/locations/${B.routeId}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([])
  })

  it('POST /locations/:routeId/stream-ticket → 404', async () => {
    const res = await asA('POST', `/api/v1/locations/${B.routeId}/stream-ticket`)
    expect(res.statusCode).toBe(404)
  })
})

describe('write endpoints cannot touch another tenant\'s record', () => {
  it('PATCH /routes/:id -> 404, B\'s name does not change', async () => {
    const res = await asA('PATCH', `/api/v1/routes/${B.routeId}`, { name: 'HIJACKED' })
    expect(res.statusCode).toBe(404)

    const { rows } = await app.db.query('SELECT name FROM routes WHERE id = $1', [B.routeId])
    expect(rows[0].name).toBe('Hat B')
  })

  it('PATCH /users/:id -> 404, B\'s user is not deactivated', async () => {
    const res = await asA('PATCH', `/api/v1/users/${B.adminId}`, { isActive: false })
    expect(res.statusCode).toBe(404)

    const { rows } = await app.db.query('SELECT is_active FROM users WHERE id = $1', [B.adminId])
    expect(rows[0].is_active).toBe(true)
  })

  it('PATCH /vehicles/:id → 404', async () => {
    expect(
      (await asA('PATCH', `/api/v1/vehicles/${B.vehicleId}`, { isActive: false })).statusCode,
    ).toBe(404)
  })

  it('PATCH /passengers/:id → 404', async () => {
    expect(
      (await asA('PATCH', `/api/v1/passengers/${B.passengerId}`, { fullName: 'Ele Geçirildi' }))
        .statusCode,
    ).toBe(404)
  })

  it('POST /routes/:id/stops cannot add a stop to another tenant\'s route', async () => {
    const res = await asA('POST', `/api/v1/routes/${B.routeId}/stops`, {
      name: 'Leaked Stop',
      lat: 41.1,
      lng: 29.1,
      sequence: 9,
    })
    expect(res.statusCode).toBe(404)

    const { rows } = await app.db.query('SELECT count(*)::int AS n FROM stops WHERE route_id = $1', [
      B.routeId,
    ])
    expect(rows[0].n).toBe(1)
  })
})

describe('a cross-tenant reference cannot be created', () => {
  it('B\'s driver cannot be assigned to A\'s route', async () => {
    const res = await asA('PATCH', `/api/v1/routes/${A.routeId}`, { driverId: B.driverId })
    expect(res.statusCode).toBe(400)

    const { rows } = await app.db.query('SELECT driver_id FROM routes WHERE id = $1', [A.routeId])
    expect(rows[0].driver_id).toBe(A.driverId)
  })

  it('B\'s vehicle cannot be assigned to A\'s route', async () => {
    const res = await asA('PATCH', `/api/v1/routes/${A.routeId}`, { vehicleId: B.vehicleId })
    expect(res.statusCode).toBe(400)
  })

  it('A\'s passenger cannot be linked to B\'s stop', async () => {
    const res = await asA('POST', '/api/v1/passengers', {
      stopId: B.stopId,
      fullName: 'Cross Passenger',
      telegramChatId: '1',
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('a company_id in the body cannot override the JWT', () => {
  it('the companyId in the POST /passengers body is ignored', async () => {
    const res = await asA('POST', '/api/v1/passengers', {
      stopId: A.stopId,
      fullName: 'Tenant Test',
      telegramChatId: '1',
      // The schema drops this via additionalProperties:false + removeAdditional;
      // even if it did not, the insert takes company_id from the JWT
      companyId: B.companyId,
    })
    expect(res.statusCode).toBe(201)

    const { rows } = await app.db.query('SELECT company_id FROM passengers WHERE id = $1', [
      res.json().id,
    ])
    expect(rows[0].company_id).toBe(A.companyId)

    await app.db.query('DELETE FROM passengers WHERE id = $1', [res.json().id])
  })
})
