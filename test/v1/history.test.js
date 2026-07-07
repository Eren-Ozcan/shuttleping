import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/history/locations/:routeId', () => {
  it('token olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
    })
    expect(res.statusCode).toBe(401)
  })

  it('driver rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('geçersiz tarih formatı 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001?from=dun',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('kayıt yoksa boş liste döner', async () => {
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
  it('driver rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('geçersiz status filtresi 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications?status=belirsiz',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('filtrelerle boş liste döner', async () => {
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

describe('GET /health/deep', () => {
  it('DB ve Redis ayaktayken ok döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/health/deep' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', redis: 'ok' })
  })
})
