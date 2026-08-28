import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('POST /api/v1/locations', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      payload: { lat: 40.9, lng: 29.1 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for the company_admin role (driver only)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      headers: await authHeader('company_admin'),
      payload: { lat: 40.9, lng: 29.1 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 without lat/lng', async () => {
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
  it('returns 403 for the driver role (company_admin only)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/v1/locations/:routeId/eta', () => {
  it('returns 403 for the driver role (company_admin only)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/eta',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 when no ETA has been computed', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/eta',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/v1/locations/:routeId/stream (SSE)', () => {
  it('returns 400 without a ticket (ticket is required)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/stream',
    })
    expect(res.statusCode).toBe(400)
  })

  it('does not accept an access token as a ticket', async () => {
    const app = await getTestApp()
    const { authorization } = await authHeader('company_admin')
    const token = authorization.replace('Bearer ', '')
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/00000000-0000-4000-8000-000000000001/stream?ticket=${token}`,
    })
    // a JWT does not fit the ticket format (maxLength) — rejected at the schema level
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 for a made-up ticket', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/00000000-0000-4000-8000-000000000001/stream?ticket=${'a'.repeat(64)}`,
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/v1/locations/:routeId/stream-ticket', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/stream-ticket',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for the driver role (company_admin only)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/stream-ticket',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for another company\'s route', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/stream-ticket',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(404)
  })
})
