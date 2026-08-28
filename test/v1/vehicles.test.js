import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/vehicles', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicles' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for the driver role', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vehicles',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/v1/vehicles', () => {
  it('returns 400 without a plate', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vehicles',
      headers: await authHeader(),
      payload: { name: 'Servis 1' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/v1/vehicles/:id', () => {
  it('returns 400 for an empty body', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/vehicles/00000000-0000-4000-8000-000000000001',
      headers: await authHeader(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
