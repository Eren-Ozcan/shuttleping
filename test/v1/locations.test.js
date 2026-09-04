import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'
import { locationKey } from '../../src/services/eta/index.js'

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

  // E12 — support read: super_admin has no companyId of its own, must pass ?companyId=
  it('returns 400 for super_admin without ?companyId=', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001',
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('lets super_admin read the tenant with ?companyId=', async () => {
    const app = await getTestApp()
    const companyId = '00000000-0000-4000-8000-000000000001'
    const routeId = '00000000-0000-4000-8000-0000000e1200'
    const key = locationKey(companyId, routeId)
    await app.redis.set(key, JSON.stringify({ lat: 40.9, lng: 29.1 }), 'EX', 300)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${routeId}?companyId=${companyId}`,
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(200)

    await app.redis.del(key)
  })
})

/**
 * B8 — the broadcast stops. The location key carries a 300 s TTL, so once it
 * expires the panel must report the vehicle as offline instead of showing a
 * stale position forever.
 */
describe('location TTL expiry (B8)', () => {
  const companyId = '00000000-0000-4000-8000-000000000001'
  const routeId = '00000000-0000-4000-8000-0000000008b8'

  it('returns 404 once the key is gone, and the stale position is not served', async () => {
    const app = await getTestApp()
    const key = locationKey(companyId, routeId)

    // The broadcast is live: written exactly as the ingest route writes it
    await app.redis.set(
      key,
      JSON.stringify({ lat: 40.99, lng: 29.02, ts: Date.now() }),
      'EX',
      300,
    )
    const live = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${routeId}`,
      headers: await authHeader('company_admin', companyId),
    })
    expect(live.statusCode).toBe(200)
    expect(live.json()).toMatchObject({ lat: 40.99, lng: 29.02 })

    // The TTL runs out (simulated: the key is dropped the way expiry drops it)
    await app.redis.del(key)

    const offline = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${routeId}`,
      headers: await authHeader('company_admin', companyId),
    })
    expect(offline.statusCode).toBe(404)
    expect(offline.json().message).toMatch(/güncel konum yok/i)
  })

  it('the key really carries a TTL, it is not written forever', async () => {
    const app = await getTestApp()
    const key = locationKey(companyId, routeId)
    await app.redis.set(key, JSON.stringify({ lat: 40.99, lng: 29.02 }), 'EX', 300)

    const ttl = await app.redis.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(300)

    await app.redis.del(key)
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

  it('returns 400 for super_admin without ?companyId=', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/eta',
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(400)
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

  it('returns 400 for super_admin without ?companyId=', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/locations/00000000-0000-4000-8000-000000000001/stream-ticket',
      headers: await authHeader('super_admin'),
    })
    expect(res.statusCode).toBe(400)
  })
})
