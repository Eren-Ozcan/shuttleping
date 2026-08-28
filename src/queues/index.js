/**
 * BullMQ queue definitions.
 *
 *   eta           — per-route ETA computation jobs (triggered by location ingest)
 *   notifications — notification jobs to send to a passenger (triggered by the ETA worker)
 *
 * Queues are created lazily; a process that never enqueues (e.g. most tests)
 * opens no Redis connection.
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
 * Adds an ETA computation job for a route.
 * jobId = eta-{routeId} — while a route has a pending job, incoming location
 * pings do not create a new one (burst dedup). A BullMQ custom jobId cannot
 * contain ':'.
 */
export async function enqueueEtaJob({ companyId, routeId, tripId }) {
  await getEtaQueue().add(
    'compute',
    { companyId, routeId, tripId },
    { jobId: `eta-${routeId}`, removeOnComplete: true, removeOnFail: true },
  )
}

/**
 * Adds a notification job. On transient errors (network, 5xx): 3 attempts
 * with exponential backoff.
 */
export async function enqueueNotificationJob(data) {
  await getNotificationQueue().add('send', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  })
}

/**
 * Queue depths (F7). Even when the workers are up, /health/deep should show
 * work piling up.
 */
export async function getQueueDepths() {
  const [eta, notifications] = await Promise.all([
    getEtaQueue().getJobCounts('waiting', 'active', 'failed'),
    getNotificationQueue().getJobCounts('waiting', 'active', 'failed'),
  ])
  return { eta, notifications }
}

export async function closeQueues() {
  const etaQueue = _etaQueue
  const notificationQueue = _notificationQueue
  const conn = _connection
  _etaQueue = _notificationQueue = _connection = null

  await Promise.all([etaQueue?.close(), notificationQueue?.close()])
  if (conn) await conn.quit().catch(() => conn.disconnect())
}
