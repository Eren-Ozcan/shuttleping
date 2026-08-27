/**
 * Çok kiracılılık izolasyon matrisi (PILOT-READINESS F).
 *
 * Bu, ürünün en temel güvenlik sözü: `company_id` yalnızca JWT'den okunur ve
 * her sorguda zorunludur. Buna rağmen bugüne kadar tek bir izolasyon testi
 * yoktu — mevcut testler tek şirketle çalışıyor ve çapraz okuma denemiyordu.
 *
 * Kurgu: iki ayrı şirket (A ve B), her birinin kendi güzergahı, durağı,
 * yolcusu, aracı ve kullanıcıları. A'nın yöneticisi B'nin hiçbir kaydını
 * görememeli, değiştirememeli ve kendi kaydına B'nin kaynağını bağlayamamalı.
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

/** A'nın yöneticisiyle istek atar. */
const asA = (method, url, payload) =>
  app.inject({ method, url, headers: authFor(A), ...(payload ? { payload } : {}) })

describe('liste uçları yalnızca kendi kiracısını döner', () => {
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

describe('tekil okuma başka kiracının kaydını vermez', () => {
  it('GET /trips/:id → 404', async () => {
    expect((await asA('GET', `/api/v1/trips/${B.tripId}`)).statusCode).toBe(404)
  })

  it('GET /routes/:id/stops → 404', async () => {
    expect((await asA('GET', `/api/v1/routes/${B.routeId}/stops`)).statusCode).toBe(404)
  })

  it('GET /history/locations/:routeId → boş liste, B\'nin izi sızmaz', async () => {
    const res = await asA('GET', `/api/v1/history/locations/${B.routeId}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([])
  })

  it('POST /locations/:routeId/stream-ticket → 404', async () => {
    const res = await asA('POST', `/api/v1/locations/${B.routeId}/stream-ticket`)
    expect(res.statusCode).toBe(404)
  })
})

describe('yazma uçları başka kiracının kaydına dokunamaz', () => {
  it('PATCH /routes/:id → 404, B\'nin adı değişmez', async () => {
    const res = await asA('PATCH', `/api/v1/routes/${B.routeId}`, { name: 'ELE GEÇİRİLDİ' })
    expect(res.statusCode).toBe(404)

    const { rows } = await app.db.query('SELECT name FROM routes WHERE id = $1', [B.routeId])
    expect(rows[0].name).toBe('Hat B')
  })

  it('PATCH /users/:id → 404, B\'nin kullanıcısı pasifleşmez', async () => {
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

  it('POST /routes/:id/stops başka kiracının güzergahına durak ekleyemez', async () => {
    const res = await asA('POST', `/api/v1/routes/${B.routeId}/stops`, {
      name: 'Sızan Durak',
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

describe('çapraz kiracı referansı kurulamaz', () => {
  it('A\'nın güzergahına B\'nin sürücüsü atanamaz', async () => {
    const res = await asA('PATCH', `/api/v1/routes/${A.routeId}`, { driverId: B.driverId })
    expect(res.statusCode).toBe(400)

    const { rows } = await app.db.query('SELECT driver_id FROM routes WHERE id = $1', [A.routeId])
    expect(rows[0].driver_id).toBe(A.driverId)
  })

  it('A\'nın güzergahına B\'nin aracı atanamaz', async () => {
    const res = await asA('PATCH', `/api/v1/routes/${A.routeId}`, { vehicleId: B.vehicleId })
    expect(res.statusCode).toBe(400)
  })

  it('A\'nın yolcusu B\'nin durağına bağlanamaz', async () => {
    const res = await asA('POST', '/api/v1/passengers', {
      stopId: B.stopId,
      fullName: 'Çapraz Yolcu',
      telegramChatId: '1',
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('body\'den gelen company_id JWT\'yi geçersiz kılamaz', () => {
  it('POST /passengers gövdesindeki companyId yok sayılır', async () => {
    const res = await asA('POST', '/api/v1/passengers', {
      stopId: A.stopId,
      fullName: 'Kiracı Testi',
      telegramChatId: '1',
      // Şema additionalProperties:false + removeAdditional ile bunu düşürür;
      // düşürmese bile insert company_id'yi JWT'den alır
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
