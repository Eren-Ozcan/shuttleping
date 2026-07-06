import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

const ROUTE_ID = '00000000-0000-4000-8000-000000000001'

describe('GET /api/v1/routes', () => {
  it('token olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/routes' })
    expect(res.statusCode).toBe(401)
  })

  it('driver rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/routes',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/v1/routes', () => {
  it('isim olmadan 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      headers: await authHeader(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/routes/:id/stops', () => {
  it('lat sınır dışında 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/routes/${ROUTE_ID}/stops`,
      headers: await authHeader(),
      payload: { name: 'Durak 1', lat: 91, lng: 29.1, sequence: 1 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('sequence 0 olamaz (400)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/routes/${ROUTE_ID}/stops`,
      headers: await authHeader(),
      payload: { name: 'Durak 1', lat: 40.9, lng: 29.1, sequence: 0 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/v1/routes/:id', () => {
  it('boş body ile 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/routes/${ROUTE_ID}`,
      headers: await authHeader(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
