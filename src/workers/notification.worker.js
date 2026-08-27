import { Worker } from 'bullmq'
import { NOTIFICATION_QUEUE } from '../queues/index.js'
import { notify } from '../services/notifications/index.js'
import { buildApproachMessage } from '../services/notifications/message.js'
import { logger } from '../utils/logger.js'

/**
 * Tek bildirim job'ını işler; testler bu fonksiyonu sahte db ile çağırır.
 *
 * Kalıcı hatalar (eksik chat id / telefon, yapılandırılmamış kanal) retry
 * edilmez — sadece log'a yazılır. Geçici hatalarda (retryable) throw edilir,
 * BullMQ backoff ile yeniden dener.
 */
export async function handleNotificationJob({ db }, data) {
  const { rows } = await db.query(
    'SELECT * FROM passengers WHERE id = $1 AND is_active = true',
    [data.passengerId],
  )
  const passenger = rows[0]
  if (!passenger) return { skipped: 'passenger_not_found' }

  // Job payload'ından gelen company_id'ye güvenme — yolcunun gerçek tenant'ıyla
  // eşleşmiyorsa bozuk/replay job'dır, loga yanlış tenant yazma
  if (passenger.company_id !== data.companyId) {
    return { skipped: 'company_mismatch' }
  }

  const message = buildApproachMessage(data)
  const result = await notify(passenger, message)

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
      result.ok ? 'sent' : 'failed',
      result.ok ? null : result.error,
    ],
  )

  if (!result.ok && result.retryable) {
    throw new Error(`Bildirim gönderilemedi: ${result.error}`)
  }
  return result
}

export function createNotificationWorker({ db, connection }) {
  const worker = new Worker(
    NOTIFICATION_QUEUE,
    (job) => handleNotificationJob({ db }, job.data),
    { connection, concurrency: 10 },
  )

  worker.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id, data: job?.data }, 'Bildirim job başarısız'),
  )
  return worker
}
