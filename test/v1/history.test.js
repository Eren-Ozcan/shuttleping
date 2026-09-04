import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/history/locations/:routeId', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for the driver role', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for an invalid date format', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001?from=dun',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns an empty list when there are no records', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
  })
})

describe('GET /api/v1/history/notifications', () => {
  it('returns 403 for the driver role', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for an invalid status filter', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications?status=belirsiz',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns an empty list with filters', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications?status=sent&limit=10',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
  })
})

/**
 * H7 — TIMESTAMPTZ comparisons must be exact-instant, not silently truncated
 * to a local calendar day. Rows are planted straddling a UTC midnight/day
 * boundary (the case a DST or "geceyi aşan sefer" bug would show up as) and
 * the from/to filter must return exactly the row inside the window, no more,
 * no less, regardless of what timezone the DB server happens to run in.
 */
describe('GET /api/v1/history/locations — day-boundary filtering (H7)', () => {
  it('a from/to window across UTC midnight returns exactly the row inside it', async () => {
    const app = await getTestApp()
    const company = await app.db.query(
      `INSERT INTO companies (name, slug) VALUES ('H7 Test AŞ', 'h7-test-' || uuid_generate_v4()) RETURNING id`,
    )
    const companyId = company.rows[0].id
    const route = await app.db.query(
      `INSERT INTO routes (company_id, name) VALUES ($1, 'H7 Hat') RETURNING id`,
      [companyId],
    )
    const routeId = route.rows[0].id
    const driver = await app.db.query(
      `INSERT INTO users (company_id, email, password_hash, role, full_name)
       VALUES ($1, 'h7-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'H7 Sürücü')
       RETURNING id`,
      [companyId],
    )
    const driverId = driver.rows[0].id

    const stamps = ['2026-01-01T23:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T01:00:00Z']
    for (const ts of stamps) {
      await app.db.query(
        `INSERT INTO location_history (company_id, route_id, driver_id, lat, lng, recorded_at)
         VALUES ($1, $2, $3, 41.0, 29.0, $4)`,
        [companyId, routeId, driverId, ts],
      )
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/history/locations/${routeId}?from=2026-01-01T23:30:00Z&to=2026-01-02T00:30:00Z`,
      headers: await authHeader('company_admin', companyId),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(1)
    expect(new Date(res.json().items[0].recorded_at).toISOString()).toBe('2026-01-02T00:00:00.000Z')

    await app.db.query('DELETE FROM location_history WHERE company_id = $1', [companyId])
    await app.db.query('DELETE FROM routes WHERE company_id = $1', [companyId])
    await app.db.query('DELETE FROM users WHERE company_id = $1', [companyId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [companyId])
  })
})

describe('GET /health/deep', () => {
  it('returns ok while DB and Redis are up', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/health/deep' })
    expect(res.statusCode).toBe(200)
    // the maps flag is only added when a Google key is configured
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' })
  })
})
