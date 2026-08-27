import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'

// Login rate limit'i dakikada 5 — her test taze sayaçla başlamalı
beforeEach(clearRateLimits)
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

describe('login rate limit (D1)', () => {
  it('dakikada 5 denemeden sonra 429 döner', async () => {
    const app = await getTestApp()
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'brute@test.com', password: 'wrongpassword' },
      })

    const codes = []
    for (let i = 0; i < 6; i++) codes.push((await attempt()).statusCode)

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(codes[5]).toBe(429)
  })
})

describe('POST /api/v1/auth/logout', () => {
  // D10: access token gerektirmez — süresi dolmuş oturumda da kullanıcı
  // kendi refresh token'ını iptal edebilmeli. Yetki cookie'nin kendisidir.
  it('access token olmadan da başarılı olur ve cookie temizlenir', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    expect(res.headers['set-cookie']).toBeDefined()
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
