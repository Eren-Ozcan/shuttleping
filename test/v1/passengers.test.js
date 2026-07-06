import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/passengers', () => {
  it('token olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/passengers' })
    expect(res.statusCode).toBe(401)
  })

  it('driver rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/passengers',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/v1/passengers', () => {
  it('stopId olmadan 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passengers',
      headers: await authHeader(),
      payload: { fullName: 'Ali Veli' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('geçersiz bildirim kanalında 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passengers',
      headers: await authHeader(),
      payload: {
        stopId: '00000000-0000-4000-8000-000000000001',
        fullName: 'Ali Veli',
        notificationChannel: 'whatsapp',
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
