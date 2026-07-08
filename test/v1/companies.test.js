import { describe, it, expect, afterAll } from 'vitest'
import { getTestApp, closeTestApp, authHeader } from '../helpers/app.js'

const created = { companyId: null, adminId: null }

afterAll(async () => {
  const app = await getTestApp()
  if (created.adminId) {
    await app.db.query('DELETE FROM users WHERE id = $1', [created.adminId])
  }
  if (created.companyId) {
    await app.db.query('DELETE FROM companies WHERE id = $1', [created.companyId])
  }
  await closeTestApp()
})

describe('GET /api/v1/companies', () => {
  it('company_admin rolüyle 403 döner (sadece super_admin)', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/companies',
      headers: await authHeader('company_admin'),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/v1/companies/:id/admins', () => {
  it('company_admin rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies/00000000-0000-4000-8000-000000000001/admins',
      headers: await authHeader('company_admin'),
      payload: { email: 'a@b.co', password: 'Sifre123!', fullName: 'Test' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('olmayan şirket için 404 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies/00000000-0000-4000-8000-00000000dead/admins',
      headers: await authHeader('super_admin'),
      payload: { email: 'a@b.co', password: 'Sifre123!', fullName: 'Test Yönetici' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('şirket açıp ilk yöneticisini oluşturur; aynı e-posta 409 döner', async () => {
    const app = await getTestApp()

    const companyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: await authHeader('super_admin'),
      payload: { name: 'Onboarding Test AŞ', slug: `onb-test-${Date.now()}` },
    })
    expect(companyRes.statusCode).toBe(201)
    created.companyId = companyRes.json().id

    const email = `onb-admin-${Date.now()}@test.com`
    const adminRes = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${created.companyId}/admins`,
      headers: await authHeader('super_admin'),
      payload: { email, password: 'Sifre123!', fullName: 'İlk Yönetici' },
    })
    expect(adminRes.statusCode).toBe(201)
    const admin = adminRes.json()
    created.adminId = admin.id
    expect(admin).toMatchObject({ email, role: 'company_admin', fullName: 'İlk Yönetici' })

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/companies/${created.companyId}/admins`,
      headers: await authHeader('super_admin'),
      payload: { email, password: 'Sifre123!', fullName: 'Kopya' },
    })
    expect(duplicate.statusCode).toBe(409)
  })
})

describe('PATCH /api/v1/companies/:id/payment-status', () => {
  it('company_admin rolüyle 403 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/00000000-0000-4000-8000-000000000001/payment-status',
      headers: await authHeader('company_admin'),
      payload: { paymentStatus: 'overdue' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('olmayan şirket için 404 döner', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/00000000-0000-4000-8000-00000000dead/payment-status',
      headers: await authHeader('super_admin'),
      payload: { paymentStatus: 'overdue' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('overdue işaretler, sonra active ile son ödeme/vade tarihini günceller', async () => {
    const app = await getTestApp()

    const companyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: await authHeader('super_admin'),
      payload: { name: 'Ödeme Test AŞ', slug: `pay-test-${Date.now()}` },
    })
    expect(companyRes.statusCode).toBe(201)
    const company = companyRes.json()
    created.companyId = company.id
    expect(company.paymentStatus).toBe('active')

    const overdueRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${company.id}/payment-status`,
      headers: await authHeader('super_admin'),
      payload: { paymentStatus: 'overdue' },
    })
    expect(overdueRes.statusCode).toBe(200)
    expect(overdueRes.json().paymentStatus).toBe('overdue')

    const activeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${company.id}/payment-status`,
      headers: await authHeader('super_admin'),
      payload: { paymentStatus: 'active' },
    })
    expect(activeRes.statusCode).toBe(200)
    const activated = activeRes.json()
    expect(activated.paymentStatus).toBe('active')
    expect(activated.lastPaymentDate).toBeTruthy()
    expect(activated.nextDueDate).toBeTruthy()
  })
})
