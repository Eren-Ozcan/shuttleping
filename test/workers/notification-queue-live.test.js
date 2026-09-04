/**
 * H4 — Telegram down for a stretch, then recovers. Unlike notification.test.js
 * (calls handleNotificationJob directly, one shot) this runs the job through a
 * real BullMQ Queue + Worker against the fake HTTP server (T0.6), so retry/
 * backoff actually happens: the first attempts hit a down server and fail
 * retryably, the queue holds the job, and once the fake server "comes back up"
 * the same job is delivered — exactly once, not once per failed attempt.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Queue, Worker } from 'bullmq'
import { getTestApp, closeTestApp } from '../helpers/app.js'
import { createQueueConnection } from '../../src/queues/connection.js'
import { handleNotificationJob } from '../../src/workers/notification.worker.js'
import { env } from '../../src/config/env.js'
import { createFakeNotifyServer } from '../helpers/fake-notify-server.js'

const QUEUE_NAME = 'notifications-h4-test'
let app
let fake
let connection
let queue
let worker
const ids = {}
let savedTelegramBase
let savedToken

beforeAll(async () => {
  app = await getTestApp()
  fake = createFakeNotifyServer()
  const { telegramBase } = await fake.start()
  savedTelegramBase = env.TELEGRAM_API_BASE
  savedToken = env.TELEGRAM_BOT_TOKEN
  env.TELEGRAM_API_BASE = telegramBase
  env.TELEGRAM_BOT_TOKEN = 'h4-fake-token'

  const company = await app.db.query(
    `INSERT INTO companies (name, slug) VALUES ('H4 Test AŞ', 'h4-test-' || uuid_generate_v4()) RETURNING id`,
  )
  ids.companyId = company.rows[0].id
  const route = await app.db.query(
    `INSERT INTO routes (company_id, name) VALUES ($1, 'H4 Hat') RETURNING id`,
    [ids.companyId],
  )
  ids.routeId = route.rows[0].id
  const stop = await app.db.query(
    `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
     VALUES ($1, $2, 'H4 Durak', 41.0, 29.0, 1) RETURNING id`,
    [ids.companyId, ids.routeId],
  )
  ids.stopId = stop.rows[0].id
  const passenger = await app.db.query(
    `INSERT INTO passengers (company_id, stop_id, full_name, notification_channel, telegram_chat_id, notify_before_minutes)
     VALUES ($1, $2, 'H4 Yolcu', 'telegram', 'h4-chat', 10) RETURNING id`,
    [ids.companyId, ids.stopId],
  )
  ids.passengerId = passenger.rows[0].id

  connection = createQueueConnection()
  queue = new Queue(QUEUE_NAME, { connection })
  worker = new Worker(QUEUE_NAME, (job) => handleNotificationJob({ db: app.db, redis: app.redis }, job.data), {
    connection,
    concurrency: 1,
  })
})

afterAll(async () => {
  await worker?.close()
  await queue?.close()
  await connection?.quit()
  await fake?.stop()
  env.TELEGRAM_API_BASE = savedTelegramBase
  env.TELEGRAM_BOT_TOKEN = savedToken

  if (app) {
    await app.db.query('DELETE FROM notification_logs WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM passengers WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM stops WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM routes WHERE company_id = $1', [ids.companyId])
    await app.db.query('DELETE FROM companies WHERE id = $1', [ids.companyId])
  }
  await closeTestApp()
})

function waitForCompletion(jobId, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('job did not complete in time')), timeoutMs)
    worker.on('completed', (job) => {
      if (job.id === jobId) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

describe('notification queue survives a downed channel and delivers once recovered (H4)', () => {
  it('retries through failures, delivers exactly once notification_logs row', async () => {
    // Down for the first two attempts (503 = retryable), healthy on the third
    fake.setBehavior('h4-chat', 503)

    const job = await queue.add(
      'send',
      {
        companyId: ids.companyId,
        routeId: ids.routeId,
        passengerId: ids.passengerId,
        stopId: ids.stopId,
        stopName: 'H4 Durak',
        etaMinutes: 5,
      },
      { attempts: 3, backoff: { type: 'fixed', delay: 300 } },
    )

    const completion = waitForCompletion(job.id)
    // Let the first (failing) attempt run, then bring the fake server back
    await new Promise((resolve) => setTimeout(resolve, 400))
    fake.setBehavior('h4-chat', 'ok')
    await completion

    // Every attempt (failed or not) writes its own audit row — that's by
    // design (each is a real send attempt). What must hold is: the failed
    // attempt(s) are marked 'failed', not silently dropped, and exactly one
    // 'sent' row exists once the channel recovers — not a duplicate delivery
    const { rows } = await app.db.query(
      `SELECT status FROM notification_logs WHERE passenger_id = $1 ORDER BY created_at`,
      [ids.passengerId],
    )
    const sent = rows.filter((r) => r.status === 'sent')
    const failed = rows.filter((r) => r.status === 'failed')
    expect(sent).toHaveLength(1)
    expect(failed.length).toBeGreaterThanOrEqual(1)

    const telegramRequests = fake.getRequests().filter((r) => r.channel === 'telegram')
    expect(telegramRequests.length).toBeGreaterThan(1) // at least one failed attempt before success
  })
})
