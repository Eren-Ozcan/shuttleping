/**
 * Faz C — gelir koruması. Kademeli askıya alma davranışı:
 *   overdue   → company_admin girişi kapalı, sürücü çalışır, Google sorgusu yok
 *   suspended → tüm girişler kapalı, konum ingest reddedilir, bildirim yok
 * Ayrıca yolcu kotası ve ödeme defteri.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'
import { computeEtaForRoute, locationKey } from '../../src/services/eta/index.js'
import { invalidateCompanyAccess } from '../../src/services/billing.service.js'
import { hashPassword } from '../../src/services/auth.service.js'

let app
const ids = {}
const PASSWORD = 'gecerliSifre123'
// Bu dosyaya özel rate limit kovası — paralel test dosyaları birbirinin
// login kotasını tüketmesin
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

  // company_payments.recorded_by gerçek bir kullanıcıya işaret etmeli
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

describe('kademeli askıya alma — giriş kapısı', () => {
  it('active: hem admin hem sürücü giriş yapabilir', async () => {
    expect((await login(ids.adminEmail)).statusCode).toBe(200)
    expect((await login(ids.driverEmail)).statusCode).toBe(200)
  })

  it('overdue: admin 402 alır, sürücü giriş yapmaya devam eder', async () => {
    await setStatus('overdue')
    expect((await login(ids.adminEmail)).statusCode).toBe(402)
    // Servis yolcular için işlemeye devam etmeli — baskı hesabı yöneten kişide
    expect((await login(ids.driverEmail)).statusCode).toBe(200)
  })

  it('suspended: her iki rol de 402 alır', async () => {
    await setStatus('suspended')
    expect((await login(ids.adminEmail)).statusCode).toBe(402)
    expect((await login(ids.driverEmail)).statusCode).toBe(402)
  })

  it('şirket pasifse rol fark etmeksizin 403', async () => {
    await app.db.query('UPDATE companies SET is_active = false WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)
    expect((await login(ids.driverEmail)).statusCode).toBe(403)
    await app.db.query('UPDATE companies SET is_active = true WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)
  })
})

describe('kademeli askıya alma — harcama durur', () => {
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
    // Durak 41.0/29.0'da. Araç ~2 km kuzeyde: haversine ETA ~5 dk (25 km/sa),
    // yani bildirim eşiğinin (10 dk) altında ama "geçildi" yarıçapının dışında.
    // Böylece overdue senaryosunda Google olmadan da bildirim üretilebilir.
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

  it('overdue: Google sorgusu yapılmaz ama bildirim gitmeye devam eder', async () => {
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

    expect(providerCalls).toBe(0) // faturalı çağrı yok
    expect(result.source).toBe('haversine')
    expect(enqueued).toHaveLength(1) // yolcu yine bilgilendirilir
  })

  it('suspended: bildirim de üretilmez', async () => {
    await setStatus('suspended')

    const enqueued = []
    const result = await computeEtaForRoute(
      deps({ enqueueNotification: async (job) => enqueued.push(job) }),
      { companyId: ids.companyId, routeId: ids.routeId, tripId: ids.tripId },
    )

    expect(result).toMatchObject({ ok: true, notified: 0, billingBlocked: true })
    expect(enqueued).toHaveLength(0)
  })

  it('suspended: sürücünün konumu reddedilir', async () => {
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

describe('yolcu kotası (C6)', () => {
  afterAll(async () => {
    await app.db.query('UPDATE companies SET max_passengers = NULL WHERE id = $1', [
      ids.companyId,
    ])
    await invalidateCompanyAccess(ids.companyId, app.redis)
  })

  it('kota doluysa yeni yolcu 402 ile reddedilir', async () => {
    // Halihazırda 1 aktif yolcu var
    await app.db.query('UPDATE companies SET max_passengers = 1 WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passengers',
      headers: auth('company_admin', ids.adminId),
      payload: { stopId: ids.stopId, fullName: 'Kotayı Aşan', telegramChatId: '1' },
    })
    expect(res.statusCode).toBe(402)
    expect(res.json().message).toContain('1/1')
  })

  it('kota yükseltilince yolcu eklenebilir', async () => {
    await app.db.query('UPDATE companies SET max_passengers = 5 WHERE id = $1', [ids.companyId])
    await invalidateCompanyAccess(ids.companyId, app.redis)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passengers',
      headers: auth('company_admin', ids.adminId),
      payload: { stopId: ids.stopId, fullName: 'Kota İçi', telegramChatId: '2' },
    })
    expect(res.statusCode).toBe(201)
    await app.db.query('DELETE FROM passengers WHERE id = $1', [res.json().id])
  })
})

describe('ödeme defteri (C4)', () => {
  it('ödeme alındı işaretlemesi geçmişe kayıt düşer', async () => {
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
