import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

afterAll(closeTestApp)

describe('GET /api/v1/users', () => {
  it('token olmadan 401 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' })
    expect(res.statusCode).toBe(401)
  })

  it('driver rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: await authHeader('driver'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('geçersiz role filtresinde 400 döner', async () => {
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
  it('eksik body ile 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: await authHeader(),
      payload: { email: 'a@b.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('super_admin rolü atanamaz (400)', async () => {
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
  it('geçersiz uuid ile 400 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/not-a-uuid',
      headers: await authHeader(),
      payload: { fullName: 'Yeni Ad' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('boş body ile 400 döner', async () => {
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
