import path from 'node:path'
import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
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
import tripRoutes from './routes/v1/trips/index.js'
import historyRoutes from './routes/v1/history/index.js'
import { budgetKey } from './services/eta/distance.js'
import { EmptyUpdateError } from './utils/sql.js'
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

  /**
   * Rate limit (D1). preHandler'da çalışır: auth hook'ları onRequest'te
   * koştuğu için bu noktada request.user hazırdır ve limit kullanıcı bazında
   * sayılabilir — mobil operatör NAT'ı arkasındaki sürücüler birbirinin
   * kotasını yemez. Kimliksiz istekler IP'ye düşer.
   *
   * Sayaç Redis'te tutulur; birden fazla instance aynı kotayı paylaşır.
   */
  await fastify.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: fastify.redis,
    nameSpace: 'rl:',
    keyGenerator: (request) => request.user?.sub ?? request.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin',
    }),
  })

  // Route'lar
  await fastify.register(authRoutes, { prefix: '/api/v1/auth' })
  await fastify.register(companyRoutes, { prefix: '/api/v1/companies' })
  await fastify.register(userRoutes, { prefix: '/api/v1/users' })
  await fastify.register(vehicleRoutes, { prefix: '/api/v1/vehicles' })
  await fastify.register(routeRoutes, { prefix: '/api/v1/routes' })
  await fastify.register(passengerRoutes, { prefix: '/api/v1/passengers' })
  await fastify.register(locationRoutes, { prefix: '/api/v1/locations' })
  await fastify.register(tripRoutes, { prefix: '/api/v1/trips' })
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

    // Google Maps günlük element kullanımı — bütçe aşıldıysa ETA kaba tahmine
    // düşmüştür; servis ayakta olduğu için 503 değil, bayrak olarak raporlanır
    let maps
    if (checks.redis === 'ok' && env.GOOGLE_MAPS_API_KEY) {
      const used = Number((await fastify.redis.get(budgetKey())) ?? 0)
      maps = {
        elementsToday: used,
        budget: env.GOOGLE_DAILY_ELEMENT_BUDGET,
        overBudget: used > env.GOOGLE_DAILY_ELEMENT_BUDGET,
      }
    }

    const healthy = Object.values(checks).every((s) => s === 'ok')
    reply.code(healthy ? 200 : 503)
    return { status: healthy ? 'ok' : 'degraded', ...checks, ...(maps ? { maps } : {}) }
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

  // buildUpdate boş gövdede fırlatır (E10) — 500 yerine 400 dönmeli
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof EmptyUpdateError) {
      return reply.badRequest(error.message)
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.send(error)
    }
    request.log.error({ err: error }, 'İşlenmemiş hata')
    return reply.internalServerError('Beklenmeyen bir hata oluştu')
  })

  // Route handler'ları lazy kuyruk oluşturduysa bağlantıları app ile kapat
  fastify.addHook('onClose', () => closeQueues())

  return fastify
}
