import path from 'node:path'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
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
import historyRoutes from './routes/v1/history/index.js'
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
  await fastify.register(historyRoutes, { prefix: '/api/v1/history' })

  // Health check (Railway probe için — hafif, bağımlılıklara dokunmaz)
  fastify.get('/health', { logLevel: 'silent' }, async () => ({ status: 'ok' }))

  // Derin health check (monitoring) — DB ve Redis'i gerçekten yoklar
  fastify.get('/health/deep', { logLevel: 'silent' }, async (request, reply) => {
    const checks = {}
    try {
      await fastify.db.query('SELECT 1')
      checks.db = 'ok'
    } catch {
      checks.db = 'down'
    }
    try {
      await fastify.redis.ping()
      checks.redis = 'ok'
    } catch {
      checks.redis = 'down'
    }

    const healthy = Object.values(checks).every((s) => s === 'ok')
    reply.code(healthy ? 200 : 503)
    return { status: healthy ? 'ok' : 'degraded', ...checks }
  })

  // Statik dosyalar: public/driver.html (sürücü istemcisi) ve
  // public/admin/ (React panel build çıktısı — `npm run build:admin`)
  const publicDir = path.join(process.cwd(), 'public')
  if (existsSync(publicDir)) {
    await fastify.register(fastifyStatic, { root: publicDir })

    fastify.setNotFoundHandler((request, reply) => {
      // SPA fallback: /admin altındaki derin linkler index.html'e düşer
      const wantsAdmin =
        request.method === 'GET' &&
        request.url.startsWith('/admin') &&
        existsSync(path.join(publicDir, 'admin', 'index.html'))
      if (wantsAdmin) return reply.sendFile('admin/index.html')
      return reply.notFound(`${request.method} ${request.url} bulunamadı`)
    })
  }

  // Route handler'ları lazy kuyruk oluşturduysa bağlantıları app ile kapat
  fastify.addHook('onClose', () => closeQueues())

  return fastify
}
