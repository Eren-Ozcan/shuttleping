/**
 * Bildirim worker handler'ı — sahte db ile birim test.
 * Kanal adapter'ları gerçek çağrı yapmaz: kalıcı hata senaryoları
 * (eksik chat id) yapılandırmadan bağımsız çalışır.
 */
import { describe, it, expect } from 'vitest'
import { handleNotificationJob } from '../../src/workers/notification.worker.js'

function fakeDb(passengerRow) {
  const queries = []
  return {
    queries,
    query: async (text, params) => {
      queries.push({ text, params })
      if (text.startsWith('SELECT')) {
        return { rows: passengerRow ? [passengerRow] : [] }
      }
      return { rows: [] }
    },
  }
}

const jobData = {
  companyId: '00000000-0000-4000-8000-000000000001',
  routeId: '00000000-0000-4000-8000-000000000002',
  passengerId: '00000000-0000-4000-8000-000000000003',
  stopId: '00000000-0000-4000-8000-000000000004',
  stopName: 'Meydan',
  etaMinutes: 5,
}

describe('handleNotificationJob', () => {
  it('yolcu bulunamazsa işi atlar, log yazmaz', async () => {
    const db = fakeDb(null)
    const result = await handleNotificationJob({ db }, jobData)
    expect(result).toEqual({ skipped: 'passenger_not_found' })
    expect(db.queries).toHaveLength(1) // sadece SELECT
  })

  it('kalıcı hata (chat id eksik) retry edilmez, failed olarak loglanır', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      notification_channel: 'telegram',
      telegram_chat_id: null,
    })

    const result = await handleNotificationJob({ db }, jobData)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('missing_telegram_chat_id')

    const insert = db.queries.find((q) => q.text.includes('INSERT INTO notification_logs'))
    expect(insert).toBeDefined()
    expect(insert.params).toContain('failed')
    expect(insert.params).toContain('missing_telegram_chat_id')
    // mesaj Türkçe formatta ve durak adını içeriyor
    expect(insert.params.some((p) => typeof p === 'string' && p.includes('Meydan'))).toBe(true)
  })

  it('bilinmeyen kanal kalıcı hatadır, throw etmez', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      notification_channel: 'posta_guvercini',
    })

    const result = await handleNotificationJob({ db }, jobData)
    expect(result).toMatchObject({ ok: false, error: 'unknown_channel' })
  })
})
