import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'

afterAll(closeTestApp)

describe('POST /api/v1/auth/login', () => {
  it('body olmadan 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('geçersiz e-posta formatında 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-an-email', password: 'validpassword' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('yanlış şifrede 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'notexist@test.com', password: 'wrongpassword' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/v1/auth/refresh', () => {
  it('refresh cookie olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
    })
    expect(res.statusCode).toBe(401)
  })

  it('geçersiz refresh cookie ile 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { refreshToken: 'invalid_token_value' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('access token olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /health', () => {
  it('200 ve { status: ok } döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
