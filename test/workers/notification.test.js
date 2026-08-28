/**
 * Notification worker handler — unit test with a fake db.
 * The channel adapters make no real call: the permanent-failure scenarios
 * (missing chat id) work regardless of configuration.
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

/** A company that is current on payment — the billing gate is not the subject of these tests. */
const activeAccess = async () => ({
  paymentStatus: 'active',
  isActive: true,
  maxPassengers: null,
})

const jobData = {
  companyId: '00000000-0000-4000-8000-000000000001',
  routeId: '00000000-0000-4000-8000-000000000002',
  passengerId: '00000000-0000-4000-8000-000000000003',
  stopId: '00000000-0000-4000-8000-000000000004',
  stopName: 'Meydan',
  etaMinutes: 5,
}

describe('handleNotificationJob', () => {
  it('skips the job and writes no log when the passenger is not found', async () => {
    const db = fakeDb(null)
    const result = await handleNotificationJob({ db, checkAccess: activeAccess }, jobData)
    expect(result).toEqual({ skipped: 'passenger_not_found' })
    expect(db.queries).toHaveLength(1) // SELECT only
  })

  it('does not retry a permanent failure (missing chat id), logs it as failed', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      company_id: jobData.companyId,
      notification_channel: 'telegram',
      telegram_chat_id: null,
    })

    const result = await handleNotificationJob({ db, checkAccess: activeAccess }, jobData)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('missing_telegram_chat_id')

    const insert = db.queries.find((q) => q.text.includes('INSERT INTO notification_logs'))
    expect(insert).toBeDefined()
    expect(insert.params).toContain('failed')
    expect(insert.params).toContain('missing_telegram_chat_id')
    // the message is in the Turkish format and contains the stop name
    expect(insert.params.some((p) => typeof p === 'string' && p.includes('Meydan'))).toBe(true)
  })

  it('skips when the passenger tenant does not match the job payload (replay protection)', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      company_id: '00000000-0000-4000-8000-0000000000ff',
      notification_channel: 'telegram',
      telegram_chat_id: '123',
    })
    const result = await handleNotificationJob({ db, checkAccess: activeAccess }, jobData)
    expect(result).toEqual({ skipped: 'company_mismatch' })
    expect(db.queries).toHaveLength(1) // SELECT only, no log written
  })

  it('treats an unknown channel as a permanent failure, does not throw', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      company_id: jobData.companyId,
      notification_channel: 'carrier_pigeon',
    })

    const result = await handleNotificationJob({ db, checkAccess: activeAccess }, jobData)
    expect(result).toMatchObject({ ok: false, error: 'unknown_channel' })
  })

  it('logs a dry-run company record as dry_run (F3)', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      company_id: jobData.companyId,
      notification_channel: 'telegram',
      telegram_chat_id: '123',
    })
    const dryRunCompany = async () => ({
      paymentStatus: 'active',
      isActive: true,
      maxPassengers: null,
      dryRun: true,
    })

    const result = await handleNotificationJob({ db, checkAccess: dryRunCompany }, jobData)

    expect(result).toMatchObject({ ok: true, dryRun: true })
    const insert = db.queries.find((q) => q.text.includes('INSERT INTO notification_logs'))
    // A dry-run send must be separated from a live one in the audit log
    expect(insert.params).toContain('dry_run')
    expect(insert.params).not.toContain('sent')
  })

  it('does not send for a suspended company (C1)', async () => {
    const db = fakeDb({
      id: jobData.passengerId,
      company_id: jobData.companyId,
      notification_channel: 'telegram',
      telegram_chat_id: '123',
    })
    const suspended = async () => ({
      paymentStatus: 'suspended',
      isActive: true,
      maxPassengers: null,
    })

    const result = await handleNotificationJob({ db, checkAccess: suspended }, jobData)

    expect(result).toEqual({ skipped: 'billing_blocked' })
    // No send and no log — no SMS cost for a non-paying customer
    expect(db.queries).toHaveLength(1)
  })
})
