/**
 * ETA çekirdeği entegrasyon testi — gerçek PostgreSQL + Redis kullanır,
 * getEta ve enqueueNotification sahte geçilir. Test verisi benzersiz slug
 * ile oluşturulur ve sonunda fiziksel silinir (test DB'si olduğu için).
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
})

afterAll(async () => {
  if (app) {
    await app.redis.del(
      locationKey(ids.companyId, ids.routeId),
      etaKey(ids.companyId, ids.routeId),
      `notified:${ids.routeId}:${ids.stopId}:${ids.passengerId}`,
    )
    await app.db.query('DELETE FROM passengers WHERE id = $1', [ids.passengerId])
    await app.db.query('DELETE FROM stops WHERE id = $1', [ids.stopId])
    await app.db.query('DELETE FROM routes WHERE id = $1', [ids.routeId])
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

describe('computeEtaForRoute', () => {
  it('Redis\'te konum yoksa işi atlar', async () => {
    const result = await computeEtaForRoute(deps(), {
      companyId: ids.companyId,
      routeId: ids.routeId,
    })
    expect(result).toEqual({ skipped: 'no_location' })
  })

  it('eşiğin altındaki ETA için bildirim kuyruğa atılır ve ETA Redis\'e yazılır', async () => {
    await app.redis.set(
      locationKey(ids.companyId, ids.routeId),
      JSON.stringify({ lat: 41.0, lng: 29.0, ts: Date.now() }),
      'EX',
      60,
    )

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      { companyId: ids.companyId, routeId: ids.routeId },
    )

    expect(result).toMatchObject({ ok: true, stopCount: 1, notified: 1 })
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({
      passengerId: ids.passengerId,
      stopId: ids.stopId,
      stopName: 'Meydan',
      etaMinutes: 5,
    })

    const etaRaw = await app.redis.get(etaKey(ids.companyId, ids.routeId))
    const eta = JSON.parse(etaRaw)
    expect(eta.stops).toHaveLength(1)
    expect(eta.stops[0]).toMatchObject({ stopId: ids.stopId, etaSeconds: 300 })
  })

  it('aynı yaklaşma için ikinci kez bildirim göndermez (dedup)', async () => {
    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      { companyId: ids.companyId, routeId: ids.routeId },
    )

    expect(result).toMatchObject({ ok: true, notified: 0 })
    expect(enqueued).toHaveLength(0)
  })

  it('ETA eşiğin üstündeyse bildirim gitmez', async () => {
    // dedup anahtarını temizle ki eşik kontrolü test edilsin
    await app.redis.del(`notified:${ids.routeId}:${ids.stopId}:${ids.passengerId}`)

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({
        getEta: async () => [1800], // 30 dk > 10 dk eşik
        enqueueNotification: async (job) => enqueued.push(job),
      }),
      { companyId: ids.companyId, routeId: ids.routeId },
    )

    expect(result).toMatchObject({ ok: true, notified: 0 })
    expect(enqueued).toHaveLength(0)
  })
})
