import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import sensible from '@fastify/sensible'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'
import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import authPlugin from './plugins/auth.js'
import authRoutes from './routes/v1/auth/index.js'
import companyRoutes from './routes/v1/companies/index.js'
import userRoutes from './routes/v1/users/index.js'
import vehicleRoutes from './routes/v1/vehicles/index.js'
import routeRoutes from './routes/v1/routes/index.js'
import passengerRoutes from './routes/v1/passengers/index.js'
import locationRoutes from './routes/v1/locations/index.js'
import { closeQueues } from './queues/index.js'

/**
 * @param {object} opts - Fastify seçeneklerini override etmek için (test'te logger: false)
 */
export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger !== undefined ? opts.logger : logger,
    ajv: {
      customOptions: {
        removeAdditional: true,
        // Querystring değerleri her zaman string gelir; boolean/number filtreler için şart
        coerceTypes: true,
        allErrors: false,
      },
    },
  })

  // Güvenlik başlıkları
  await fastify.register(helmet, { contentSecurityPolicy: false })
  await fastify.register(cors, { origin: env.CORS_ORIGIN, credentials: true })
  await fastify.register(sensible)

  // Core plugin'ler
  await fastify.register(dbPlugin)
  await fastify.register(redisPlugin)
  await fastify.register(authPlugin)

  // Route'lar
  await fastify.register(authRoutes, { prefix: '/api/v1/auth' })
  await fastify.register(companyRoutes, { prefix: '/api/v1/companies' })
  await fastify.register(userRoutes, { prefix: '/api/v1/users' })
  await fastify.register(vehicleRoutes, { prefix: '/api/v1/vehicles' })
  await fastify.register(routeRoutes, { prefix: '/api/v1/routes' })
  await fastify.register(passengerRoutes, { prefix: '/api/v1/passengers' })
  await fastify.register(locationRoutes, { prefix: '/api/v1/locations' })

  // Health check (Railway probe için)
  fastify.get('/health', { logLevel: 'silent' }, async () => ({ status: 'ok' }))

  // Route handler'ları lazy kuyruk oluşturduysa bağlantıları app ile kapat
  fastify.addHook('onClose', () => closeQueues())

  return fastify
}
