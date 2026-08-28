import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/history/locations/:routeId', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for the driver role', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for an invalid date format', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/locations/00000000-0000-4000-8000-000000000001?from=dun',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns an empty list when there are no records', async () => {
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
  it('returns 403 for the driver role', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for an invalid status filter', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/history/notifications?status=belirsiz',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns an empty list with filters', async () => {
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
  it('returns ok while DB and Redis are up', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/health/deep' })
    expect(res.statusCode).toBe(200)
    // the maps flag is only added when a Google key is configured
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' })
  })
})
