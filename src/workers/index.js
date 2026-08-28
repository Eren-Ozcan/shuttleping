/**
 * Worker lifecycle. Runs inside the server process (a separate process is
 * unnecessary at this scale); server.js calls startWorkers() after listen and
 * stopWorkers() on shutdown.
 */
import { pool } from '../db/pool.js'
import { createQueueConnection } from '../queues/connection.js'
import { closeQueues } from '../queues/index.js'
import { createEtaWorker } from './eta.worker.js'
import { createNotificationWorker } from './notification.worker.js'
import { startMaintenance } from './maintenance.js'
import { logger } from '../utils/logger.js'

let _workers = []
let _workerConnection = null // BullMQ worker connection
let _serviceRedis = null // loc/eta key reads+writes + maintenance sweeps
let _maintenanceTimers = []

export function startWorkers() {
  if (_workers.length) return _workers

  _workerConnection = createQueueConnection()
  _serviceRedis = createQueueConnection()
  _workers = [
    createEtaWorker({ db: pool, redis: _serviceRedis, connection: _workerConnection }),
    createNotificationWorker({
      db: pool,
      redis: _serviceRedis,
      connection: _workerConnection,
    }),
  ]
  _maintenanceTimers = startMaintenance({ db: pool, redis: _serviceRedis })

  logger.info('Queue workers started (eta, notifications, maintenance)')
  return _workers
}

/**
 * Worker liveness status (F7).
 * /health/deep used to return 200 even with both workers dead — the health
 * check stayed green while queues silently piled up.
 */
export function getWorkerHealth() {
  if (!_workers.length) return { running: false, workers: [] }
  return {
    running: _workers.every((w) => w.isRunning()),
    workers: _workers.map((w) => ({ name: w.name, running: w.isRunning() })),
  }
}

export async function stopWorkers() {
  const workers = _workers
  _workers = []
  for (const timer of _maintenanceTimers) clearInterval(timer)
  _maintenanceTimers = []
  await Promise.all(workers.map((worker) => worker.close()))
  await closeQueues()

  for (const conn of [_workerConnection, _serviceRedis]) {
    if (conn) await conn.quit().catch(() => conn.disconnect())
  }
  _workerConnection = _serviceRedis = null
}
