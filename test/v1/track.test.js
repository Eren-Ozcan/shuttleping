import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'
import { trackTokenKey } from '../../src/services/tracking.service.js'
import { etaKey } from '../../src/services/eta/index.js'

afterAll(closeTestApp)

const companyId = '00000000-0000-4000-8000-000000000001'
const routeId = '00000000-0000-4000-8000-000000000002'
const stopId = '00000000-0000-4000-8000-000000000004'

describe('GET /api/v1/track/:token', () => {
  it('returns 404 for an unknown token (no auth required, but no leak either)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/track/${'a'.repeat(48)}`,
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for a malformed token', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/track/not-hex!' })
    expect(res.statusCode).toBe(400)
  })

  it('resolves stop name and live ETA for a valid token, unauthenticated', async () => {
    const app = await getTestApp()
    const token = 'b'.repeat(48)

    await app.redis.set(
      trackTokenKey(token),
      JSON.stringify({ companyId, routeId, stopId, stopName: 'Meydan', companyName: 'Acme' }),
      'EX',
      3600,
    )
    await app.redis.set(
      etaKey(companyId, routeId),
      JSON.stringify({
        ts: 1234,
        stops: [{ stopId, name: 'Meydan', sequence: 1, state: 'pending', etaSeconds: 300 }],
      }),
      'EX',
      300,
    )

    const res = await app.inject({ method: 'GET', url: `/api/v1/track/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      companyName: 'Acme',
      stopName: 'Meydan',
      status: 'pending',
      etaMinutes: 5,
    })

    await app.redis.del(trackTokenKey(token))
    await app.redis.del(etaKey(companyId, routeId))
  })

  it('still resolves stop name when no ETA has been computed yet', async () => {
    const app = await getTestApp()
    const token = 'c'.repeat(48)
    await app.redis.set(
      trackTokenKey(token),
      JSON.stringify({ companyId, routeId, stopId, stopName: 'Meydan', companyName: 'Acme' }),
      'EX',
      3600,
    )

    const res = await app.inject({ method: 'GET', url: `/api/v1/track/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ stopName: 'Meydan', etaMinutes: null })

    await app.redis.del(trackTokenKey(token))
  })
})
