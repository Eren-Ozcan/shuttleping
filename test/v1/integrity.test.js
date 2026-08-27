/**
 * Faz E — veri bütünlüğü ve dayanıklılık.
 *   E1  bileşik FK: uyuşmayan company_id veritabanı seviyesinde reddedilir
 *   E7  saklama süresi temizliği
 *   E10 buildUpdate boş gövdede 500 değil 400
 *   E11 updated_at trigger'la yönetilir
 *   E12 super_admin salt-okunur destek erişimi
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

describe('E1 — bileşik FK tenant tutarlılığını zorlar', () => {
  it('durak, güzergahın şirketinden farklı bir company_id ile yazılamaz', async () => {
    await expect(
      app.db.query(
        `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
         VALUES ($1, $2, 'Sızan', 41.0, 29.0, 99)`,
        [other.companyId, ids.routeId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('yolcu, durağın şirketinden farklı bir company_id ile yazılamaz', async () => {
    await expect(
      app.db.query(
        `INSERT INTO passengers (company_id, stop_id, full_name, telegram_chat_id)
         VALUES ($1, $2, 'Sızan Yolcu', '1')`,
        [other.companyId, ids.stopId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('konum kaydı, güzergahın şirketinden farklı company_id ile yazılamaz', async () => {
    await expect(
      app.db.query(
        `INSERT INTO location_history (company_id, route_id, lat, lng)
         VALUES ($1, $2, 41.0, 29.0)`,
        [other.companyId, ids.routeId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })
})

describe('E11 — updated_at trigger tarafından yönetilir', () => {
  it('route güncellemesinde updated_at kendiliğinden ilerler', async () => {
    const before = await app.db.query('SELECT updated_at FROM routes WHERE id = $1', [
      ids.routeId,
    ])
    // Sorgu artık updated_at'e hiç dokunmuyor — trigger yapmazsa değişmez
    await app.db.query('UPDATE routes SET name = $2 WHERE id = $1', [
      ids.routeId,
      'IHat güncel',
    ])
    const after = await app.db.query('SELECT updated_at FROM routes WHERE id = $1', [
      ids.routeId,
    ])
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
      before.rows[0].updated_at.getTime(),
    )
  })
})

describe('E10 — buildUpdate boş güncellemede güvenli davranır', () => {
  it('hiç alan yoksa geçersiz SQL üretmek yerine fırlatır', () => {
    expect(() => buildUpdate({ a: undefined, b: undefined })).toThrow(EmptyUpdateError)
  })

  it('alan varsa normal çalışır', () => {
    expect(buildUpdate({ name: 'x', other: undefined })).toEqual({
      sets: ['name = $1'],
      params: ['x'],
    })
  })
})

describe('E7 — saklama süresi temizliği', () => {
  it('süresi dolmuş konum kayıtlarını siler, yenileri kalır', async () => {
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
    expect(rows[0].n).toBe(1) // yalnızca güncel kayıt kaldı
  })
})

describe('E12 — super_admin salt-okunur destek erişimi', () => {
  it('companyId verilmezse 400 döner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/routes',
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('companyId ile o kiracının güzergahlarını okuyabilir', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/routes?companyId=${ids.companyId}`,
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((r) => r.id)).toContain(ids.routeId)
  })

  it('yazma uçları super_admin\'e kapalı kalır', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/routes/${ids.routeId}?companyId=${ids.companyId}`,
      headers: await authHeader('super_admin'),
      payload: { name: 'Destek Değiştirdi' },
    })
    expect(res.statusCode).toBe(403)
  })
})
