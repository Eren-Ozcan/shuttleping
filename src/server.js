import './config/env.js'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'
import { startWorkers, stopWorkers } from './workers/index.js'

const fastify = await buildApp()

try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
  startWorkers()
  logger.info({ port: env.PORT }, 'Server başlatıldı')
} catch (err) {
  logger.error({ err }, 'Server başlatılamadı')
  process.exit(1)
}

// Zero-downtime deploy: Railway SIGTERM gönderir — önce worker'lar boşalır,
// sonra HTTP ve bağlantılar kapanır
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    logger.info({ signal }, 'Kapanış sinyali alındı')
    await stopWorkers().catch((err) => logger.error({ err }, 'Worker kapanış hatası'))
    await fastify.close()
    process.exit(0)
  })
}
