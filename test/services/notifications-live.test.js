/**
 * Real end-to-end HTTP round trip through the adapters against
 * test/helpers/fake-notify-server.js (T0.6) — complements
 * notifications.test.js (which stubs fetch) by exercising actual retryable
 * vs. permanent status-code handling over a real socket.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env.js'
import * as telegram from '../../src/services/notifications/telegram.js'
import * as sms from '../../src/services/notifications/sms.js'
import { createFakeNotifyServer } from '../helpers/fake-notify-server.js'

let fake
let savedTelegramBase
let savedNetgsmBase
let savedToken
let savedUsercode
let savedPassword
let savedHeader

beforeAll(async () => {
  fake = createFakeNotifyServer()
  const { telegramBase, netgsmBase } = await fake.start()
  savedTelegramBase = env.TELEGRAM_API_BASE
  savedNetgsmBase = env.NETGSM_API_BASE
  savedToken = env.TELEGRAM_BOT_TOKEN
  savedUsercode = env.NETGSM_USERCODE
  savedPassword = env.NETGSM_PASSWORD
  savedHeader = env.NETGSM_MSGHEADER
  env.TELEGRAM_API_BASE = telegramBase
  env.NETGSM_API_BASE = netgsmBase
  env.TELEGRAM_BOT_TOKEN = 'fake-token'
  env.NETGSM_USERCODE = 'user'
  env.NETGSM_PASSWORD = 'pass'
  env.NETGSM_MSGHEADER = 'HEADER'
})

afterAll(async () => {
  await fake.stop()
  env.TELEGRAM_API_BASE = savedTelegramBase
  env.NETGSM_API_BASE = savedNetgsmBase
  env.TELEGRAM_BOT_TOKEN = savedToken
  env.NETGSM_USERCODE = savedUsercode
  env.NETGSM_PASSWORD = savedPassword
  env.NETGSM_MSGHEADER = savedHeader
})

beforeEach(() => fake.reset())

describe('telegram.send against a real fake server', () => {
  it('sends the exact text (D1-ish sanity check)', async () => {
    fake.setBehavior('111', 'ok')
    const result = await telegram.send({
      passenger: { id: 'p1', telegram_chat_id: '111' },
      message: 'Servisiniz 5 dk sonra',
    })
    expect(result).toEqual({ ok: true })
    expect(fake.getRequests()).toEqual([
      { channel: 'telegram', url: '/botfake-token/sendMessage', chat_id: '111', text: 'Servisiniz 5 dk sonra' },
    ])
  })

  it('bot-blocked (403) is permanent — not retryable (D6)', async () => {
    fake.setBehavior('222', 403)
    const result = await telegram.send({
      passenger: { id: 'p2', telegram_chat_id: '222' },
      message: 'x',
    })
    expect(result).toMatchObject({ ok: false, error: 'telegram_403', retryable: false })
  })

  it('429 is transient — retryable (D7)', async () => {
    fake.setBehavior('333', 429)
    const result = await telegram.send({
      passenger: { id: 'p3', telegram_chat_id: '333' },
      message: 'x',
    })
    expect(result).toMatchObject({ ok: false, error: 'telegram_429', retryable: true })
  })
})

describe('sms.send against a real fake server', () => {
  it('sends and normalizes the GSM number', async () => {
    fake.setBehavior('5321112233', 'ok')
    const result = await sms.send({
      passenger: { id: 'p4', phone: '0532 111 22 33' },
      message: 'Servisiniz 5 dk sonra',
    })
    expect(result).toEqual({ ok: true })
    expect(fake.getRequests()[0]).toMatchObject({ channel: 'sms', gsmno: '5321112233' })
  })

  it('code 30 (invalid credentials) is permanent (D8)', async () => {
    fake.setBehavior('5321112233', '30')
    const result = await sms.send({
      passenger: { id: 'p5', phone: '0532 111 22 33' },
      message: 'x',
    })
    expect(result).toMatchObject({ ok: false, error: 'netgsm_30', retryable: false })
  })

  it('code 85 (system error) is transient (D8)', async () => {
    fake.setBehavior('5321112233', '85')
    const result = await sms.send({
      passenger: { id: 'p5', phone: '0532 111 22 33' },
      message: 'x',
    })
    expect(result).toMatchObject({ ok: false, error: 'netgsm_85', retryable: true })
  })
})
