/**
 * Phase E — data integrity and resilience.
 *   E1  composite FK: a mismatched company_id is rejected at the database level
 *   E7  retention cleanup
 *   E10 buildUpdate returns 400, not 500, on an empty body
 *   E11 updated_at is managed by a trigger
 *   E12 super_admin read-only support access
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'
import { sweepRetention } from '../../src/workers/maintenance.js'
import { buildUpdate, EmptyUpdateError } from '../../src/utils/sql.js'

let app
const ids = {}
const other = {}

beforeAll(async () => {
  app = await getTestApp()

  const mkCompany = async (label) => {
    const { rows } = await app.db.query(
      `INSERT INTO companies (name, slug)
       VALUES ($1, 'integ-' || uuid_generate_v4()) RETURNING id`,
      [`Integrity ${label}`],
    )
    return rows[0].id
  }
  ids.companyId = await mkCompany('A')
  other.companyId = await mkCompany('B')

  const driver = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES ($1, 'integ-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'S')
     RETURNING id`,
    [ids.companyId],
  )
  ids.driverId = driver.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name, driver_id) VALUES ($1, 'IHat', $2) RETURNING id`,
    [ids.companyId, ids.driverId],
  )
  ids.routeId = route.rows[0].id

  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'IDurak', 41.0, 29.0, 1) RETURNING id`,
    [ids.companyId, ids.routeId],
  )
  ids.stopId = stop.rows[0].id
})

afterAll(async () => {
  if (app) {
    const del = (sql, id) => app.db.query(sql, [id])
    await del('DELETE FROM location_history WHERE company_id = $1', ids.companyId)
    await del('DELETE FROM passengers WHERE company_id = $1', ids.companyId)
    await del('DELETE FROM stops WHERE company_id = $1', ids.companyId)
    await del('DELETE FROM routes WHERE company_id = $1', ids.companyId)
    await del('DELETE FROM users WHERE company_id = $1', ids.companyId)
    await del('DELETE FROM companies WHERE id = $1', ids.companyId)
    await del('DELETE FROM companies WHERE id = $1', other.companyId)
  }
  await closeTestApp()
})

describe('E1 — composite FK enforces tenant consistency', () => {
  it('a stop cannot be written with a company_id different from its route\'s', async () => {
    await expect(
      app.db.query(
        `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
         VALUES ($1, $2, 'Leak', 41.0, 29.0, 99)`,
        [other.companyId, ids.routeId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('a passenger cannot be written with a company_id different from its stop\'s', async () => {
    await expect(
      app.db.query(
        `INSERT INTO passengers (company_id, stop_id, full_name, telegram_chat_id)
         VALUES ($1, $2, 'Leaked Passenger', '1')`,
        [other.companyId, ids.stopId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('a location record cannot be written with a company_id different from its route\'s', async () => {
    await expect(
      app.db.query(
        `INSERT INTO location_history (company_id, route_id, lat, lng)
         VALUES ($1, $2, 41.0, 29.0)`,
        [other.companyId, ids.routeId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })
})

describe('E11 — updated_at is managed by a trigger', () => {
  it('updated_at advances by itself on a route update', async () => {
    const before = await app.db.query('SELECT updated_at FROM routes WHERE id = $1', [
      ids.routeId,
    ])
    // The query no longer touches updated_at at all — it stays put unless the trigger acts
    await app.db.query('UPDATE routes SET name = $2 WHERE id = $1', [
      ids.routeId,
      'IHat updated',
    ])
    const after = await app.db.query('SELECT updated_at FROM routes WHERE id = $1', [
      ids.routeId,
    ])
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
      before.rows[0].updated_at.getTime(),
    )
  })
})

describe('E10 — buildUpdate is safe on an empty update', () => {
  it('throws instead of producing invalid SQL when there is no field', () => {
    expect(() => buildUpdate({ a: undefined, b: undefined })).toThrow(EmptyUpdateError)
  })

  it('works normally when there is a field', () => {
    expect(buildUpdate({ name: 'x', other: undefined })).toEqual({
      sets: ['name = $1'],
      params: ['x'],
    })
  })
})

describe('E7 — retention cleanup', () => {
  it('deletes expired location records, keeps recent ones', async () => {
    await app.db.query(
      `INSERT INTO location_history (company_id, route_id, driver_id, lat, lng, recorded_at)
       VALUES ($1, $2, $3, 41.0, 29.0, now() - interval '200 days'),
              ($1, $2, $3, 41.0, 29.0, now())`,
      [ids.companyId, ids.routeId, ids.driverId],
    )

    await sweepRetention({ db: app.db })

    const { rows } = await app.db.query(
      'SELECT count(*)::int AS n FROM location_history WHERE route_id = $1',
      [ids.routeId],
    )
    expect(rows[0].n).toBe(1) // only the recent record remains
  })
})

describe('E12 — super_admin read-only support access', () => {
  it('returns 400 when companyId is not given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/routes',
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('can read that tenant\'s routes with companyId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/routes?companyId=${ids.companyId}`,
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((r) => r.id)).toContain(ids.routeId)
  })

  it('write endpoints stay closed to super_admin', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/routes/${ids.routeId}?companyId=${ids.companyId}`,
      headers: await authHeader('super_admin'),
      payload: { name: 'Support Changed It' },
    })
    expect(res.statusCode).toBe(403)
  })
})
