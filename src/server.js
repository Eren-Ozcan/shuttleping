import './config/env.js'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'

const fastify = await buildApp()

try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
  logger.info({ port: env.PORT }, 'Server başlatıldı')
} catch (err) {
  logger.error({ err }, 'Server başlatılamadı')
  process.exit(1)
}
