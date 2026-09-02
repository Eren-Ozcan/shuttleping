/**
 * Coverage gap: sweepAbandonedTrips (the abandoned-trip collector, Phase A)
 * and markOverdueCompanies (the graduated-suspension trigger, Phase C) had no
 * test anywhere — sweepRetention was covered in integrity.test.js but these
 * two were only ever exercised by hand.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'
import { sweepAbandonedTrips } from '../../src/workers/maintenance.js'
import { markOverdueCompanies } from '../../src/services/billing.service.js'
import { locationKey, etaKey, etaCalcKey } from '../../src/services/eta/index.js'

let app
const ids = {}

beforeAll(async () => {
  app = await getTestApp()

  const company = await app.db.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Bakım Testi AŞ', 'bakim-testi-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name) VALUES ($1, 'Bakım Hattı') RETURNING id`,
    [ids.companyId],
  )
  ids.routeId = route.rows[0].id

  const driver = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES ($1, 'bakim-driver-' || uuid_generate_v4() || '@t.local', 'x', 'driver', 'Sürücü')
     RETURNING id`,
    [ids.companyId],
  )
  ids.driverId = driver.rows[0].id
})

afterAll(async () => {
  if (app) {
    await app.redis.del(
      locationKey(ids.companyId, ids.routeId),
      etaKey(ids.companyId, ids.routeId),
      etaCalcKey(ids.routeId),
    )
    await app.db.query('DELETE FROM trips WHERE route_id = $1', [ids.routeId])
    await app.db.query('DELETE FROM routes WHERE id = $1', [ids.routeId])
    await app.db.query('DELETE FROM users WHERE id = $1', [ids.driverId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

/** Opens a trip with a chosen last_ping_at so the abandon window can be forced. */
async function tripWithLastPing(minutesAgo) {
  await app.db.query(
    `UPDATE trips SET status = 'completed' WHERE route_id = $1 AND status = 'active'`,
    [ids.routeId],
  )
  const { rows } = await app.db.query(
    `INSERT INTO trips (company_id, route_id, driver_id, last_ping_at)
     VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval) RETURNING id`,
    [ids.companyId, ids.routeId, ids.driverId, String(minutesAgo)],
  )
  return rows[0].id
}

describe('sweepAbandonedTrips', () => {
  it('closes a trip whose last ping is past the abandon window and clears its live keys', async () => {
    const tripId = await tripWithLastPing(21) // TRIP_ABANDON_AFTER_MINUTES default is 20
    await app.redis.set(locationKey(ids.companyId, ids.routeId), JSON.stringify({ lat: 1, lng: 1 }))
    await app.redis.set(etaKey(ids.companyId, ids.routeId), JSON.stringify({ stops: [] }))
    await app.redis.set(etaCalcKey(ids.routeId), '1')

    const count = await sweepAbandonedTrips({ db: app.db, redis: app.redis })
    expect(count).toBeGreaterThanOrEqual(1)

    const { rows } = await app.db.query('SELECT status FROM trips WHERE id = $1', [tripId])
    expect(rows[0].status).toBe('abandoned')

    expect(await app.redis.get(locationKey(ids.companyId, ids.routeId))).toBeNull()
    expect(await app.redis.get(etaKey(ids.companyId, ids.routeId))).toBeNull()
    expect(await app.redis.get(etaCalcKey(ids.routeId))).toBeNull()
  })

  it('leaves a trip with a recent ping untouched', async () => {
    const tripId = await tripWithLastPing(1)

    await sweepAbandonedTrips({ db: app.db, redis: app.redis })

    const { rows } = await app.db.query('SELECT status FROM trips WHERE id = $1', [tripId])
    expect(rows[0].status).toBe('active')
  })
})

describe('markOverdueCompanies', () => {
  it('marks an active company past its due date as overdue and invalidates its access cache', async () => {
    await app.db.query(
      `UPDATE companies SET payment_status = 'active', next_due_date = now() - interval '1 day' WHERE id = $1`,
      [ids.companyId],
    )
    // Prime the access cache so we can prove the sweep busts it
    await app.redis.set(`company:access:${ids.companyId}`, JSON.stringify({ allowed: true }), 'EX', 60)

    const changed = await markOverdueCompanies(app.redis)
    expect(changed.map((c) => c.id)).toContain(ids.companyId)

    const { rows } = await app.db.query('SELECT payment_status FROM companies WHERE id = $1', [
      ids.companyId,
    ])
    expect(rows[0].payment_status).toBe('overdue')
    expect(await app.redis.get(`company:access:${ids.companyId}`)).toBeNull()
  })

  it('leaves a company with a future due date active', async () => {
    await app.db.query(
      `UPDATE companies SET payment_status = 'active', next_due_date = now() + interval '1 day' WHERE id = $1`,
      [ids.companyId],
    )

    const changed = await markOverdueCompanies(app.redis)
    expect(changed.map((c) => c.id)).not.toContain(ids.companyId)

    const { rows } = await app.db.query('SELECT payment_status FROM companies WHERE id = $1', [
      ids.companyId,
    ])
    expect(rows[0].payment_status).toBe('active')
  })
})
