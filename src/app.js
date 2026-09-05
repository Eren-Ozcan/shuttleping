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
import trackRoutes from './routes/v1/track/index.js'
import telegramRoutes from './routes/v1/telegram/index.js'
import { budgetKey } from './services/eta/distance.js'
import { EmptyUpdateError } from './utils/sql.js'
import { getWorkerHealth } from './workers/index.js'
import { closeQueues, getQueueDepths } from './queues/index.js'

/**
 * @param {object} opts - override Fastify options (in tests: logger: false)
 */
export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger !== undefined ? opts.logger : logger,
    ajv: {
      customOptions: {
        removeAdditional: true,
        // Querystring values always arrive as strings; required for boolean/number filters
        coerceTypes: true,
        allErrors: false,
      },
    },
  })

  // Security headers.
  //
  // CSP used to be fully disabled (D5): the panel and driver.html are served
  // from the same origin that carries the session cookie, so XSS had no primary
  // defense. The policy is kept narrow, matching what those two clients actually need.
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Leaflet markers/tiles come from data: and the OSM host
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        // Leaflet and driver.html write styles inline on elements
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Local development runs over http; helmet's default
        // upgrade-insecure-requests directive would rewrite the request to https and break it
        upgradeInsecureRequests: env.isProd ? [] : null,
      },
    },
  })
  await fastify.register(cors, { origin: env.CORS_ORIGIN, credentials: true })
  await fastify.register(sensible)

  // Core plugins
  await fastify.register(dbPlugin)
  await fastify.register(redisPlugin)
  await fastify.register(authPlugin)

  /**
   * Rate limit (D1). Runs in preHandler: auth hooks run in onRequest, so
   * request.user is ready at this point and the limit can be counted per
   * user — drivers behind a mobile carrier NAT do not eat each other's
   * quota. Unauthenticated requests fall back to IP.
   *
   * The counter lives in Redis; multiple instances share the same quota.
   */
  await fastify.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: fastify.redis,
    nameSpace: 'rl:',
    // Fail open: if Redis is unreachable the limiter must not take the API
    // down with it. Losing the limit for the length of an outage is the
    // cheaper failure — every request otherwise hangs in this preHandler.
    skipOnError: true,
    keyGenerator: (request) => request.user?.sub ?? request.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Çok fazla istek gönderdiniz, lütfen biraz bekleyin',
    }),
  })

  // Routes
  await fastify.register(authRoutes, { prefix: '/api/v1/auth' })
  await fastify.register(companyRoutes, { prefix: '/api/v1/companies' })
  await fastify.register(userRoutes, { prefix: '/api/v1/users' })
  await fastify.register(vehicleRoutes, { prefix: '/api/v1/vehicles' })
  await fastify.register(routeRoutes, { prefix: '/api/v1/routes' })
  await fastify.register(passengerRoutes, { prefix: '/api/v1/passengers' })
  await fastify.register(locationRoutes, { prefix: '/api/v1/locations' })
  await fastify.register(tripRoutes, { prefix: '/api/v1/trips' })
  await fastify.register(historyRoutes, { prefix: '/api/v1/history' })
  await fastify.register(trackRoutes, { prefix: '/api/v1/track' })
  await fastify.register(telegramRoutes, { prefix: '/api/v1/telegram' })

  // Health check (for the Railway probe — lightweight, touches no dependencies)
  fastify.get('/health', { logLevel: 'silent' }, async () => ({ status: 'ok' }))

  // Deep health check (monitoring) — actually probes DB and Redis
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

    // Worker liveness (F7): if the workers die, location pings keep being
    // accepted but no ETA is computed and no notification is sent — a silent failure
    const workerHealth = getWorkerHealth()
    // Workers are not started in test/CI; only check where they are expected to run
    if (workerHealth.workers.length) {
      checks.workers = workerHealth.running ? 'ok' : 'down'
    }

    // Google Maps daily element usage — if the budget is exceeded, ETA has
    // fallen back to a rough estimate; the service is up, so this is reported as a flag, not a 503
    let maps
    if (checks.redis === 'ok' && env.GOOGLE_MAPS_API_KEY) {
      const used = Number((await fastify.redis.get(budgetKey())) ?? 0)
      maps = {
        elementsToday: used,
        budget: env.GOOGLE_DAILY_ELEMENT_BUDGET,
        overBudget: used > env.GOOGLE_DAILY_ELEMENT_BUDGET,
      }
    }

    // Queue depth: surface it too when workers are up but work is piling up
    let queues
    if (checks.redis === 'ok' && workerHealth.workers.length) {
      queues = await getQueueDepths().catch(() => undefined)
    }

    const healthy = Object.values(checks).every((s) => s === 'ok')
    reply.code(healthy ? 200 : 503)
    return {
      status: healthy ? 'ok' : 'degraded',
      ...checks,
      ...(queues ? { queues } : {}),
      ...(maps ? { maps } : {}),
    }
  })

  // Static files: public/driver.html (driver client) and
  // public/admin/ (React panel build output — `npm run build:admin`)
  const publicDir = path.join(process.cwd(), 'public')
  if (existsSync(publicDir)) {
    await fastify.register(fastifyStatic, { root: publicDir })

    fastify.setNotFoundHandler((request, reply) => {
      // SPA fallback: deep links under /admin fall through to index.html
      const wantsAdmin =
        request.method === 'GET' &&
        request.url.startsWith('/admin') &&
        existsSync(path.join(publicDir, 'admin', 'index.html'))
      if (wantsAdmin) return reply.sendFile('admin/index.html')
      return reply.notFound(`${request.method} ${request.url} bulunamadı`)
    })
  }

  // buildUpdate throws on an empty body (E10) — should return 400, not 500
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof EmptyUpdateError) {
      return reply.badRequest(error.message)
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.send(error)
    }
    request.log.error({ err: error }, 'Unhandled error')
    return reply.internalServerError('Beklenmeyen bir hata oluştu')
  })

  // If route handlers lazily created queues, close those connections with the app
  fastify.addHook('onClose', () => closeQueues())

  return fastify
}
