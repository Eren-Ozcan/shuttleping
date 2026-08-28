import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/users', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for the driver role', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 for an invalid role filter', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?role=super_admin',
      headers: await authHeader(),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/users', () => {
  it('returns 400 for an incomplete body', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: await authHeader(),
      payload: { email: 'a@b.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('the super_admin role cannot be assigned (400)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: await authHeader(),
      payload: {
        email: 'a@b.com',
        password: 'password123',
        fullName: 'Test Kullanıcı',
        role: 'super_admin',
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/v1/users/:id', () => {
  it('returns 400 for an invalid uuid', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/not-a-uuid',
      headers: await authHeader(),
      payload: { fullName: 'Yeni Ad' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for an empty body', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/00000000-0000-4000-8000-000000000001',
      headers: await authHeader(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
