import { Worker } from 'bullmq'
import { ETA_QUEUE } from '../queues/index.js'
import { computeEtaForRoute } from '../services/eta/index.js'
import { logger } from '../utils/logger.js'

export function createEtaWorker({ db, redis, connection }) {
  const worker = new Worker(
    ETA_QUEUE,
    async (job) => {
      const result = await computeEtaForRoute({ db, redis }, job.data)
      logger.debug({ ...job.data, result }, 'ETA hesaplandı')
      return result
    },
    { connection, concurrency: 5 },
  )

  worker.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id, data: job?.data }, 'ETA job başarısız'),
  )
  return worker
}
