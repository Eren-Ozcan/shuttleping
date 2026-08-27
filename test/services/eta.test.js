/**
 * ETA çekirdeği entegrasyon testi — gerçek PostgreSQL + Redis kullanır,
 * getEta ve enqueueNotification sahte geçilir. Test verisi benzersiz slug
 * ile oluşturulur ve sonunda fiziksel silinir (test DB'si olduğu için).
 *
 * Faz A: dedup artık trip_notifications tablosuyla; her sefer bir trips satırı,
 * durak durumu trip_stops.state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'
import { computeEtaForRoute, locationKey, etaKey } from '../../src/services/eta/index.js'

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
})

afterAll(async () => {
  if (app) {
    await app.redis.del(
      locationKey(ids.companyId, ids.routeId),
      etaKey(ids.companyId, ids.routeId),
    )
    await app.db.query('DELETE FROM trip_notifications WHERE trip_id = $1', [ids.tripId])
    await app.db.query('DELETE FROM trip_stops WHERE trip_id = $1', [ids.tripId])
    await app.db.query('DELETE FROM trips WHERE id = $1', [ids.tripId])
    await app.db.query('DELETE FROM passengers WHERE id = $1', [ids.passengerId])
    await app.db.query('DELETE FROM stops WHERE id = $1', [ids.stopId])
    await app.db.query('DELETE FROM routes WHERE id = $1', [ids.routeId])
    await app.db.query('DELETE FROM users WHERE id = $1', [ids.driverId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

function deps(overrides = {}) {
  return {
    db: app.db,
    redis: app.redis,
    getEta: async () => [300], // 5 dk — 10 dk eşiğin altında
    enqueueNotification: async () => {},
    ...overrides,
  }
}

const target = () => ({
  companyId: ids.companyId,
  routeId: ids.routeId,
  tripId: ids.tripId,
})

describe('computeEtaForRoute', () => {
  it('Redis\'te konum yoksa işi atlar', async () => {
    const result = await computeEtaForRoute(deps(), target())
    expect(result).toEqual({ skipped: 'no_location' })
  })

  it('eşiğin altındaki ETA için bildirim kuyruğa atılır ve ETA Redis\'e yazılır', async () => {
    // Durağın "geçilmiş" sayılmaması için konum durağa uzak olsun
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

  it('aynı sefer + yolcu için ikinci kez bildirim göndermez (dedup)', async () => {
    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      target(),
    )

    expect(result).toMatchObject({ ok: true, notified: 0 })
    expect(enqueued).toHaveLength(0)
  })

  it('yeni sefer açılınca aynı yolcuya tekrar bildirim gider', async () => {
    // Route başına tek aktif sefer — önceki testin seferini kapat
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

  it('ETA eşiğin üstündeyse bildirim gitmez', async () => {
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
        getEta: async () => [1800], // 30 dk > 10 dk eşik
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
