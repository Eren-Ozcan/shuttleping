import { randomBytes } from 'node:crypto'
import { Worker } from 'bullmq'
import { NOTIFICATION_QUEUE } from '../queues/index.js'
import { notify } from '../services/notifications/index.js'
import { buildApproachMessage } from '../services/notifications/message.js'
import { getCompanyAccess, canNotify } from '../services/billing.service.js'
import { trackTokenKey } from '../services/tracking.service.js'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

/**
 * Handles a single notification job; tests call this function with a fake db.
 *
 * Permanent failures (missing chat id / phone, unconfigured channel) are not
 * retried — they are only logged. Transient (retryable) failures are thrown so
 * BullMQ retries with backoff.
 */
export async function handleNotificationJob(
  { db, redis, checkAccess = getCompanyAccess },
  data,
) {
  const { rows } = await db.query(
    'SELECT * FROM passengers WHERE id = $1 AND is_active = true',
    [data.passengerId],
  )
  const passenger = rows[0]
  if (!passenger) return { skipped: 'passenger_not_found' }

  // Do not trust the company_id from the job payload — if it does not match
  // the passenger's real tenant this is a corrupt/replay job, do not log the wrong tenant
  if (passenger.company_id !== data.companyId) {
    return { skipped: 'company_mismatch' }
  }

  // Billing gate (C1): the company may have been suspended after the job was
  // enqueued — check again at send time, otherwise SMS cost keeps being paid
  // for a non-paying customer
  const access = await checkAccess(passenger.company_id, redis)
  if (!canNotify(access)) return { skipped: 'billing_blocked' }

  const { rows: companyRows } = await db.query('SELECT name FROM companies WHERE id = $1', [
    passenger.company_id,
  ])
  const companyName = companyRows[0]?.name ?? null

  let trackUrl = null
  if (env.PUBLIC_URL) {
    const token = randomBytes(24).toString('hex')
    await redis.set(
      trackTokenKey(token),
      JSON.stringify({
        companyId: passenger.company_id,
        routeId: data.routeId,
        stopId: data.stopId,
        stopName: data.stopName,
        companyName,
      }),
      'EX',
      env.TRACK_TOKEN_TTL_SECONDS,
    )
    trackUrl = `${env.PUBLIC_URL}/track.html?t=${token}`
  }

  const message = buildApproachMessage({ ...data, companyName, trackUrl })
  const result = await notify(passenger, message, { dryRun: access.dryRun })

  await db.query(
    `INSERT INTO notification_logs
       (company_id, passenger_id, route_id, trip_id, stop_id, channel, message, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      passenger.company_id,
      passenger.id,
      data.routeId,
      data.tripId ?? null,
      data.stopId,
      passenger.notification_channel,
      message,
      // Dry-run sends must be distinguishable from live ones in the audit log
      result.dryRun ? 'dry_run' : result.ok ? 'sent' : 'failed',
      result.ok ? null : result.error,
    ],
  )

  if (!result.ok && result.retryable) {
    throw new Error(`Notification send failed: ${result.error}`)
  }
  return result
}

export function createNotificationWorker({ db, redis, connection }) {
  const worker = new Worker(
    NOTIFICATION_QUEUE,
    (job) => handleNotificationJob({ db, redis }, job.data),
    { connection, concurrency: 10 },
  )

  worker.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id, data: job?.data }, 'Notification job failed'),
  )
  return worker
}
