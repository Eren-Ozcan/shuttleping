import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

async function redisPlugin(fastify) {
  // maxRetriesPerRequest: null yalnızca BullMQ bağlantısı için doğru — HTTP
  // yolunda komutları süresiz kuyruklar, Redis düşünce istek hata vermek
  // yerine asılı kalır ve Fastify soketlerini tüketir. Uygulama client'ı
  // hızlı hata vermeli.
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
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
