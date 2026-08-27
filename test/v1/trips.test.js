/**
 * Sefer (trip) yaşam döngüsü — gerçek PostgreSQL + Redis.
 * Sürücü seferi başlatır → konum gönderir → admin seferi görür → sürücü bitirir.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'
import { locationKey } from '../../src/services/eta/index.js'

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

describe('sefer yaşam döngüsü', () => {
  it('sefer açılmadan konum göndermek 409 verir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: driverAuth,
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(409)
  })

  it('sürücü seferi başlatır, trip_stops snapshot\'lanır', async () => {
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

  it('start idempotent — ikinci çağrı aynı seferi döner (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/start',
      headers: driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(ids.tripId)
  })

  it('aktif seferle konum gönderilir, geçmişe trip_id ile düşer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: driverAuth,
      payload: { lat: 41.0, lng: 29.0 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ tripId: ids.tripId, routeId: ids.routeId })

    const lh = await app.db.query(
      'SELECT trip_id FROM location_history WHERE trip_id = $1',
      [ids.tripId],
    )
    expect(lh.rows.length).toBeGreaterThan(0)
  })

  it('admin sefer listesinde ve detayında görür', async () => {
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

  it('başka şirketin admini seferi göremez (404)', async () => {
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

  it('sürücü seferi bitirir, canlı konum anahtarı silinir', async () => {
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

  it('bitmiş seferden sonra end tekrar 404 verir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/trips/end',
      headers: driverAuth,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})
