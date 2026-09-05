/**
 * T2.3 — /start webhook.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'

let app
let passengerId
let inviteCode

beforeAll(async () => {
  app = await getTestApp()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const company = await app.db.query(
    `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
    ['Telegram Test Co', `telegram-test-${suffix}`],
  )
  const companyId = company.rows[0].id

  const route = await app.db.query(
    `INSERT INTO routes (company_id, name) VALUES ($1, $2) RETURNING id`,
    [companyId, 'Hat'],
  )
  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'Durak', 41.0, 29.0, 1) RETURNING id`,
    [companyId, route.rows[0].id],
  )

  inviteCode = `T${Math.random().toString(36).slice(2, 10).toUpperCase()}`
  const passenger = await app.db.query(
    `INSERT INTO passengers (company_id, stop_id, full_name, invite_code)
     VALUES ($1, $2, 'Test Yolcu', $3) RETURNING id`,
    [companyId, stop.rows[0].id, inviteCode],
  )
  passengerId = passenger.rows[0].id
})

afterAll(closeTestApp)

describe('POST /api/v1/telegram/webhook', () => {
  it('ignores updates without /start', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      payload: { message: { chat: { id: 999 }, text: 'merhaba' } },
    })
    expect(res.statusCode).toBe(200)
  })

  it('does not link an unknown invite code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      payload: { message: { chat: { id: 111 }, text: '/start NOSUCHCODE' } },
    })
    expect(res.statusCode).toBe(200)
    const { rows } = await app.db.query('SELECT telegram_chat_id FROM passengers WHERE id = $1', [
      passengerId,
    ])
    expect(rows[0].telegram_chat_id).toBeNull()
  })

  it('links telegram_chat_id for a valid invite code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      payload: { message: { chat: { id: 555 }, text: `/start ${inviteCode}` } },
    })
    expect(res.statusCode).toBe(200)
    const { rows } = await app.db.query('SELECT telegram_chat_id FROM passengers WHERE id = $1', [
      passengerId,
    ])
    expect(rows[0].telegram_chat_id).toBe('555')
  })

  it('is case-insensitive on the code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      payload: { message: { chat: { id: 777 }, text: `/start ${inviteCode.toLowerCase()}` } },
    })
    expect(res.statusCode).toBe(200)
    const { rows } = await app.db.query('SELECT telegram_chat_id FROM passengers WHERE id = $1', [
      passengerId,
    ])
    expect(rows[0].telegram_chat_id).toBe('777')
  })
})
