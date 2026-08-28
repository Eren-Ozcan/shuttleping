/**
 * Channel adapters — fetch is stubbed, no request goes to a real API.
 * env values are changed temporarily inside a test and restored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { env } from '../../src/config/env.js'
import { notify } from '../../src/services/notifications/index.js'
import * as telegram from '../../src/services/notifications/telegram.js'
import * as sms from '../../src/services/notifications/sms.js'

const savedEnv = {}
const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'NETGSM_USERCODE', 'NETGSM_PASSWORD', 'NETGSM_MSGHEADER']

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) env[key] = savedEnv[key]
  vi.unstubAllGlobals()
})

const passenger = {
  id: '00000000-0000-4000-8000-000000000003',
  telegram_chat_id: '12345',
  phone: '0532 111 22 33',
}

describe('telegram.send', () => {
  it('returns a permanent error and does not call fetch when the token is not set', async () => {
    env.TELEGRAM_BOT_TOKEN = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await telegram.send({ passenger, message: 'test' })
    expect(result).toEqual({ ok: false, error: 'telegram_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a permanent error when the chat id is missing', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    const result = await telegram.send({
      passenger: { ...passenger, telegram_chat_id: null },
      message: 'test',
    })
    expect(result).toEqual({ ok: false, error: 'missing_telegram_chat_id' })
  })

  it('uses the correct endpoint and payload on a successful send', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await telegram.send({ passenger, message: 'Servis geliyor' })
    expect(result).toEqual({ ok: true })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage')
    expect(JSON.parse(opts.body)).toEqual({ chat_id: '12345', text: 'Servis geliyor' })
  })

  it('403 (bot blocked) is permanent, 500 and 429 are transient', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    for (const [status, retryable] of [[403, false], [500, true], [429, true]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ ok: false, description: 'error' }),
      }))
      const result = await telegram.send({ passenger, message: 'test' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe(`telegram_${status}`)
      expect(Boolean(result.retryable)).toBe(retryable)
    }
  })

  it('a network error is transient (retried)', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const result = await telegram.send({ passenger, message: 'test' })
    expect(result).toMatchObject({ ok: false, error: 'telegram_network', retryable: true })
  })
})

describe('sms.normalizeGsm', () => {
  it('converts common Turkish phone formats to the Netgsm format', () => {
    expect(sms.normalizeGsm('0532 111 22 33')).toBe('5321112233')
    expect(sms.normalizeGsm('+90 532 111 22 33')).toBe('5321112233')
    expect(sms.normalizeGsm('905321112233')).toBe('5321112233')
    expect(sms.normalizeGsm('5321112233')).toBe('5321112233')
  })
})

describe('sms.send', () => {
  function configureNetgsm() {
    env.NETGSM_USERCODE = 'testuser'
    env.NETGSM_PASSWORD = 'testpass'
    env.NETGSM_MSGHEADER = 'SHUTTLEPING'
  }

  it('returns a permanent error when credentials are not set', async () => {
    env.NETGSM_USERCODE = null
    const result = await sms.send({ passenger, message: 'test' })
    expect(result).toEqual({ ok: false, error: 'sms_not_configured' })
  })

  it('returns a permanent error when the phone is missing / invalid', async () => {
    configureNetgsm()
    expect(await sms.send({ passenger: { ...passenger, phone: null }, message: 't' }))
      .toEqual({ ok: false, error: 'missing_phone' })
    expect(await sms.send({ passenger: { ...passenger, phone: '123' }, message: 't' }))
      .toEqual({ ok: false, error: 'invalid_phone' })
  })

  it('a "00 jobid" response is success; gsmno is normalized', async () => {
    configureNetgsm()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '00 12345678',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sms.send({ passenger, message: 'Servis geliyor' })
    expect(result).toEqual({ ok: true })

    // Credentials are carried in the body (D11) — a password in the query string
    // ended up as plain text in the outbound proxy / access logs
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.netgsm.com.tr/sms/send/get')
    expect(init.method).toBe('POST')
    expect(init.body.get('gsmno')).toBe('5321112233')
    expect(init.body.get('msgheader')).toBe('SHUTTLEPING')
    expect(init.body.get('password')).toBe('testpass')
  })

  it('does not carry the password in the URL', async () => {
    configureNetgsm()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '00 12345678',
    })
    vi.stubGlobal('fetch', fetchMock)

    await sms.send({ passenger, message: 'test' })

    expect(fetchMock.mock.calls[0][0]).not.toContain('testpass')
    expect(fetchMock.mock.calls[0][0]).not.toContain('?')
  })

  it('30 (invalid credentials) is permanent, 85 (system error) is transient', async () => {
    configureNetgsm()
    for (const [code, retryable] of [['30', false], ['85', true]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => code,
      }))
      const result = await sms.send({ passenger, message: 'test' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe(`netgsm_${code}`)
      expect(Boolean(result.retryable)).toBe(retryable)
    }
  })
})

describe('notify (dispatcher)', () => {
  it('returns unknown_channel for an unknown channel', async () => {
    const result = await notify(
      { ...passenger, notification_channel: 'carrier_pigeon' },
      'test',
    )
    expect(result).toEqual({ ok: false, error: 'unknown_channel' })
  })

  it('routes to the correct adapter based on the channel preference', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await notify(
      { ...passenger, notification_channel: 'telegram' },
      'test',
    )
    expect(result).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toContain('api.telegram.org')
  })
})

/**
 * Phase F3 — dry-run mode. Until now, trying out the notification flow meant
 * sending a real message to a real passenger.
 */
describe('dry-run', () => {
  const DRY_KEYS = ['NOTIFICATION_DRY_RUN', 'NOTIFICATION_TEST_CHAT_ID']
  const savedDry = {}

  beforeEach(() => {
    for (const key of DRY_KEYS) savedDry[key] = env[key]
    env.TELEGRAM_BOT_TOKEN = 'test-token'
  })
  afterEach(() => {
    for (const key of DRY_KEYS) env[key] = savedDry[key]
  })

  it('does not send while the global flag is on', async () => {
    env.NOTIFICATION_DRY_RUN = true
    env.NOTIFICATION_TEST_CHAT_ID = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await notify(
      { ...passenger, notification_channel: 'telegram' },
      'test',
    )

    expect(result).toEqual({ ok: true, dryRun: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the per-company flag also stops the send', async () => {
    env.NOTIFICATION_DRY_RUN = false
    env.NOTIFICATION_TEST_CHAT_ID = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await notify(
      { ...passenger, notification_channel: 'sms' },
      'test',
      { dryRun: true },
    )

    expect(result).toEqual({ ok: true, dryRun: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes the message to the test account when a test chat id is set', async () => {
    env.NOTIFICATION_DRY_RUN = true
    env.NOTIFICATION_TEST_CHAT_ID = '99999'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await notify(
      { ...passenger, notification_channel: 'sms', full_name: 'Ayşe' },
      'Servisiniz 5 dk sonra',
      {},
    )

    expect(result).toMatchObject({ ok: true, dryRun: true })
    // even an SMS-preferring passenger lands on the test Telegram account
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.chat_id).toBe('99999')
    expect(body.text).toContain('DRY-RUN')
    expect(body.text).toContain('Ayşe')
  })
})
