import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

async function redisPlugin(fastify) {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  redis.on('error', (err) => logger.error({ err }, 'Redis error'))
  redis.on('connect', () => logger.info('Redis connected'))

  fastify.decorate('redis', redis)
  fastify.addHook('onClose', async () => {
    // quit() cevabı gelmeden soket kapanırsa "Connection is closed" ile
    // reject eder — kapanış sırasında bu zararsızdır, bağlantıyı koparıp geç.
    await redis.quit().catch(() => redis.disconnect())
  })
}

export default fp(redisPlugin, { name: 'redis' })
