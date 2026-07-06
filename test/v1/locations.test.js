import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('POST /api/v1/locations', () => {
  it('token olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      payload: { lat: 40.9, lng: 29.1 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('company_admin rolüyle 403 döner (sadece driver)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: await authHeader('company_admin'),
      payload: { lat: 40.9, lng: 29.1 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('lat/lng olmadan 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: await authHeader('driver'),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/v1/locations/:routeId', () => {
  it('driver rolüyle 403 döner (sadece company_admin)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })
})
