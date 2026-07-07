/**
 * Worker yaşam döngüsü. Server process'i içinde çalışır (bu ölçekte ayrı
 * process gereksiz); server.js listen sonrası startWorkers(), kapanışta
 * stopWorkers() çağırır.
 */
import { pool } from '../db/pool.js'
import { createQueueConnection } from '../queues/connection.js'
import { closeQueues } from '../queues/index.js'
import { createEtaWorker } from './eta.worker.js'
import { createNotificationWorker } from './notification.worker.js'
import { logger } from '../utils/logger.js'

let _workers = []
let _workerConnection = null // BullMQ worker bağlantısı
let _serviceRedis = null // loc/eta/dedup anahtar okuma-yazması için

export function startWorkers() {
  if (_workers.length) return _workers

  _workerConnection = createQueueConnection()
  _serviceRedis = createQueueConnection()
  _workers = [
    createEtaWorker({ db: pool, redis: _serviceRedis, connection: _workerConnection }),
    createNotificationWorker({ db: pool, connection: _workerConnection }),
  ]

  logger.info('Kuyruk worker\'ları başlatıldı (eta, notifications)')
  return _workers
}

export async function stopWorkers() {
  const workers = _workers
  _workers = []
  await Promise.all(workers.map((worker) => worker.close()))
  await closeQueues()

  for (const conn of [_workerConnection, _serviceRedis]) {
    if (conn) await conn.quit().catch(() => conn.disconnect())
  }
  _workerConnection = _serviceRedis = null
}
