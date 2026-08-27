/**
 * Kanal adapter'ları — fetch stub'lanır, gerçek API'ye istek gitmez.
 * env değerleri test içinde geçici değiştirilir ve geri yüklenir.
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
  it('token tanımlı değilse kalıcı hata döner, fetch çağrılmaz', async () => {
    env.TELEGRAM_BOT_TOKEN = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await telegram.send({ passenger, message: 'test' })
    expect(result).toEqual({ ok: false, error: 'telegram_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('chat id eksikse kalıcı hata döner', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    const result = await telegram.send({
      passenger: { ...passenger, telegram_chat_id: null },
      message: 'test',
    })
    expect(result).toEqual({ ok: false, error: 'missing_telegram_chat_id' })
  })

  it('başarılı gönderimde doğru endpoint ve payload kullanılır', async () => {
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

  it('403 (bot bloklu) kalıcı, 500 ve 429 geçici hatadır', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    for (const [status, retryable] of [[403, false], [500, true], [429, true]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ ok: false, description: 'hata' }),
      }))
      const result = await telegram.send({ passenger, message: 'test' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe(`telegram_${status}`)
      expect(Boolean(result.retryable)).toBe(retryable)
    }
  })

  it('network hatası geçicidir (retry edilir)', async () => {
    env.TELEGRAM_BOT_TOKEN = 'test-token'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const result = await telegram.send({ passenger, message: 'test' })
    expect(result).toMatchObject({ ok: false, error: 'telegram_network', retryable: true })
  })
})

describe('sms.normalizeGsm', () => {
  it('yaygın Türk telefon formatlarını Netgsm formatına çevirir', () => {
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

  it('kimlik bilgileri tanımlı değilse kalıcı hata döner', async () => {
    env.NETGSM_USERCODE = null
    const result = await sms.send({ passenger, message: 'test' })
    expect(result).toEqual({ ok: false, error: 'sms_not_configured' })
  })

  it('telefon yoksa / geçersizse kalıcı hata döner', async () => {
    configureNetgsm()
    expect(await sms.send({ passenger: { ...passenger, phone: null }, message: 't' }))
      .toEqual({ ok: false, error: 'missing_phone' })
    expect(await sms.send({ passenger: { ...passenger, phone: '123' }, message: 't' }))
      .toEqual({ ok: false, error: 'invalid_phone' })
  })

  it('"00 jobid" yanıtı başarıdır; gsmno normalize edilir', async () => {
    configureNetgsm()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '00 12345678',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sms.send({ passenger, message: 'Servis geliyor' })
    expect(result).toEqual({ ok: true })

    // Kimlik bilgileri gövdede taşınır (D11) — query string'de şifre
    // giden proxy/erişim loglarına düz metin düşüyordu
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.netgsm.com.tr/sms/send/get')
    expect(init.method).toBe('POST')
    expect(init.body.get('gsmno')).toBe('5321112233')
    expect(init.body.get('msgheader')).toBe('SHUTTLEPING')
    expect(init.body.get('password')).toBe('testpass')
  })

  it('şifre URL\'de taşınmaz', async () => {
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

  it('30 (geçersiz kimlik) kalıcı, 85 (sistem hatası) geçicidir', async () => {
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
  it('bilinmeyen kanal için unknown_channel döner', async () => {
    const result = await notify(
      { ...passenger, notification_channel: 'posta_guvercini' },
      'test',
    )
    expect(result).toEqual({ ok: false, error: 'unknown_channel' })
  })

  it('kanal tercihine göre doğru adapter\'a yönlendirir', async () => {
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
 * Faz F3 — prova modu. Bugüne kadar bildirim akışını denemek, gerçek yolcuya
 * gerçek mesaj göndermek demekti.
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

  it('global bayrak açıkken gönderim yapılmaz', async () => {
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

  it('şirket bazında bayrak da gönderimi durdurur', async () => {
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

  it('test chat id verilirse mesaj o hesaba yönlendirilir', async () => {
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
    // SMS tercihli yolcu bile test Telegram hesabına düşer
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.chat_id).toBe('99999')
    expect(body.text).toContain('DRY-RUN')
    expect(body.text).toContain('Ayşe')
  })
})
