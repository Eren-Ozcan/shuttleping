/**
 * BullMQ kuyruk tanımları.
 *
 *   eta           — güzergah başına ETA hesaplama job'ları (konum ingest tetikler)
 *   notifications — yolcuya gönderilecek bildirim job'ları (ETA worker tetikler)
 *
 * Kuyruklar lazy oluşturulur; hiç enqueue yapılmayan süreçte (ör. testlerin
 * çoğu) Redis bağlantısı açılmaz.
 */
import { Queue } from 'bullmq'
import { createQueueConnection } from './connection.js'

export const ETA_QUEUE = 'eta'
export const NOTIFICATION_QUEUE = 'notifications'

let _connection = null
let _etaQueue = null
let _notificationQueue = null

function connection() {
  return (_connection ??= createQueueConnection())
}

export function getEtaQueue() {
  return (_etaQueue ??= new Queue(ETA_QUEUE, { connection: connection() }))
}

export function getNotificationQueue() {
  return (_notificationQueue ??= new Queue(NOTIFICATION_QUEUE, {
    connection: connection(),
  }))
}

/**
 * Güzergah için ETA hesaplama job'ı ekler.
 * jobId = eta-{routeId} → aynı güzergahın bekleyen job'ı varken gelen
 * konum ping'leri yeni job üretmez (burst dedup). BullMQ custom jobId
 * ':' içeremez.
 */
export async function enqueueEtaJob({ companyId, routeId }) {
  await getEtaQueue().add(
    'compute',
    { companyId, routeId },
    { jobId: `eta-${routeId}`, removeOnComplete: true, removeOnFail: true },
  )
}

/**
 * Bildirim job'ı ekler. Geçici hatalarda (network, 5xx) 3 deneme,
 * üstel geri çekilme ile.
 */
export async function enqueueNotificationJob(data) {
  await getNotificationQueue().add('send', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  })
}

export async function closeQueues() {
  const etaQueue = _etaQueue
  const notificationQueue = _notificationQueue
  const conn = _connection
  _etaQueue = _notificationQueue = _connection = null

  await Promise.all([etaQueue?.close(), notificationQueue?.close()])
  if (conn) await conn.quit().catch(() => conn.disconnect())
}
