import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

async function redisPlugin(fastify) {
  // maxRetriesPerRequest: null is only correct for the BullMQ connection — on
  // the HTTP path it queues commands forever, so when Redis goes down the
  // request hangs instead of erroring and exhausts Fastify's sockets. The
  // application client must fail fast.
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    enableReadyCheck: false,
  })

  redis.on('error', (err) => logger.error({ err }, 'Redis error'))
  redis.on('connect', () => logger.info('Redis connected'))

  fastify.decorate('redis', redis)
  fastify.addHook('onClose', async () => {
    // If the socket closes before quit() responds it rejects with
    // "Connection is closed" — harmless during shutdown, so drop the connection and move on.
    await redis.quit().catch(() => redis.disconnect())
  })
}

export default fp(redisPlugin, { name: 'redis' })
