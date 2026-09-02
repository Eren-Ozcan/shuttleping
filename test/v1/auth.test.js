import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { getTestApp, closeTestApp, clearRateLimits } from '../helpers/app.js'

// The rate-limit key for unauthenticated requests is the IP. Test files run in
// parallel, so this file uses a dedicated address; the counters do not mix with
// other files and the limit test stays stable.
const IP = '10.0.0.1'

// The login rate limit is 5 per minute — every test must start with a fresh counter
beforeEach(() => clearRateLimits(IP))
afterAll(closeTestApp)

describe('POST /api/v1/auth/login', () => {
  it('returns 400 without a body', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: IP,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for an invalid email format', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: IP,
      payload: { email: 'not-an-email', password: 'validpassword' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 for a wrong password', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: IP,
      payload: { email: 'notexist@test.com', password: 'wrongpassword' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/v1/auth/refresh', () => {
  it('returns 401 without a refresh cookie', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      remoteAddress: IP,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 with an invalid refresh cookie', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      remoteAddress: IP,
      cookies: { refreshToken: 'invalid_token_value' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('login rate limit (D1)', () => {
  it('returns 429 after 5 attempts per minute', async () => {
    const app = await getTestApp()
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: IP,
        payload: { email: 'brute@test.com', password: 'wrongpassword' },
      })

    const codes = []
    for (let i = 0; i < 6; i++) codes.push((await attempt()).statusCode)

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(codes[5]).toBe(429)
  })
})

/**
 * A6 — sustained brute force. The limit must not just trip once: every further
 * attempt in the same window stays blocked, and the block is applied before the
 * credentials are looked at, so a correct password cannot walk past it either.
 */
describe('brute force over the limit (A6)', () => {
  it('blocks all 20 rapid attempts after the 5th', async () => {
    const app = await getTestApp()
    const attempt = (password) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: IP,
        payload: { email: 'brute20@test.com', password },
      })

    const codes = []
    for (let i = 0; i < 20; i++) codes.push((await attempt('wrongpassword')).statusCode)

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(codes.slice(5)).toEqual(new Array(15).fill(429))

    // Still 429 with a well-formed request: the limiter runs before the lookup
    expect((await attempt('demo12345')).statusCode).toBe(429)
  })

  it('the block is per key — another address is unaffected', async () => {
    const app = await getTestApp()
    const other = '10.0.0.99'
    await clearRateLimits(other)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: other,
      payload: { email: 'brute20@test.com', password: 'wrongpassword' },
    })
    expect(res.statusCode).toBe(401)
    await clearRateLimits(other)
  })
})

describe('POST /api/v1/auth/logout', () => {
  // D10: no access token required — a user must be able to revoke their own
  // refresh token even in an expired session. The authority is the cookie itself.
  it('succeeds without an access token and clears the cookie', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      remoteAddress: IP,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    expect(res.headers['set-cookie']).toBeDefined()
  })
})

describe('GET /health', () => {
  it('returns 200 and { status: ok }', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
