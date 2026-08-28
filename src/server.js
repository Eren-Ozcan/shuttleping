import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'
import { startWorkers, stopWorkers } from './workers/index.js'

const fastify = await buildApp()

try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
  startWorkers()
  logger.info({ port: env.PORT }, 'Server started')
} catch (err) {
  logger.error({ err }, 'Server failed to start')
  process.exit(1)
}

// Zero-downtime deploy: Railway sends SIGTERM — workers drain first, then
// HTTP and connections close
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    logger.info({ signal }, 'Shutdown signal received')
    await stopWorkers().catch((err) => logger.error({ err }, 'Worker shutdown error'))
    await fastify.close()
    process.exit(0)
  })
}
