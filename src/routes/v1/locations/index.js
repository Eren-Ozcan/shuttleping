import {
  ingestLocationSchema,
  getLocationSchema,
  getEtaSchema,
  streamSchema,
} from './schema.js'
import { locationKey, etaKey } from '../../../services/eta/index.js'
import { enqueueEtaJob } from '../../../queues/index.js'

// Son konum Redis'te tutulur; araç yayın kesilirse 5 dk sonra "çevrimdışı" sayılır
const LOCATION_TTL_SECONDS = 300

export default async function locationRoutes(fastify) {
  /**
   * POST /api/v1/locations
   * Sürücü anlık konum gönderir. Konum yalnızca AKTİF SEFER varken kabul edilir
   * (POST /api/v1/trips/start ile açılır); son konum Redis'e yazılır, sefer
   * geçmişine iz düşülür ve ETA worker'ı için kuyruğa job atılır.
   */
  fastify.post(
    '/',
    { schema: ingestLocationSchema, onRequest: [fastify.requireRole(['driver'])] },
    async (request, reply) => {
      const { lat, lng, heading, speed, recordedAt } = request.body
      const companyId = request.user.companyId
      const driverId = request.user.sub

      const { rows } = await fastify.db.query(
        `SELECT id, route_id FROM trips
         WHERE driver_id = $1 AND company_id = $2 AND status = 'active'`,
        [driverId, companyId],
      )
      if (!rows[0]) {
        return reply.conflict('Önce seferi başlatın (POST /api/v1/trips/start)')
      }

      const tripId = rows[0].id
      const routeId = rows[0].route_id
      // Offline buffer flush'ı: eski bir fix canlı konumu ve ETA'yı tetiklemesin,
      // sadece geçmişe işlenir. Bağlantının döndüğünü kanıtladığı için last_ping
      // yine tazelenir (yanlış "abandoned" işaretlemesini önler).
      const isBackfill = recordedAt !== undefined

      await Promise.all([
        isBackfill
          ? null
          : fastify.redis.set(
              locationKey(companyId, routeId),
              JSON.stringify({
                lat,
                lng,
                heading: heading ?? null,
                speed: speed ?? null,
                driverId,
                tripId,
                ts: Date.now(),
              }),
              'EX',
              LOCATION_TTL_SECONDS,
            ),
        // Sefer geçmişi (Faz 7) — append-only iz kaydı
        fastify.db.query(
          `INSERT INTO location_history
             (company_id, route_id, trip_id, driver_id, lat, lng, speed, heading, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
          [
            companyId,
            routeId,
            tripId,
            driverId,
            lat,
            lng,
            speed ?? null,
            heading ?? null,
            recordedAt ?? null,
          ],
        ),
        fastify.db.query('UPDATE trips SET last_ping_at = now() WHERE id = $1', [tripId]),
      ])

      if (!isBackfill) await enqueueEtaJob({ companyId, routeId, tripId })

      return { ok: true, routeId, tripId }
    },
  )

  /**
   * GET /api/v1/locations/:routeId
   * Güzergahtaki aracın son bilinen konumu (admin panel harita).
   */
  fastify.get(
    '/:routeId',
    { schema: getLocationSchema, onRequest: [fastify.requireRole(['company_admin'])] },
    async (request, reply) => {
      const raw = await fastify.redis.get(
        locationKey(request.user.companyId, request.params.routeId),
      )
      if (!raw) return reply.notFound('Bu güzergah için güncel konum yok')
      return JSON.parse(raw)
    },
  )

  /**
   * GET /api/v1/locations/:routeId/stream
   * SSE: konum + ETA'yı 3 sn'de bir yayınlar (canlı harita).
   * EventSource Authorization header gönderemediği için access token
   * ?token= query param'ıyla da kabul edilir.
   */
  fastify.get('/:routeId/stream', { schema: streamSchema }, async (request, reply) => {
    const token =
      request.query.token ??
      (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '')

    let user
    try {
      user = fastify.jwt.verify(token)
    } catch {
      return reply.unauthorized('Geçersiz veya süresi dolmuş token')
    }
    if (user.role !== 'company_admin') {
      return reply.forbidden('Bu işlem için yetkiniz yok')
    }

    const { routeId } = request.params
    const companyId = user.companyId

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': request.headers.origin ?? '*',
      'access-control-allow-credentials': 'true',
      // Nginx/proxy buffering'i kapat — SSE anında akmalı
      'x-accel-buffering': 'no',
    })
    reply.raw.write('retry: 5000\n\n')

    const push = async () => {
      const [rawLocation, rawEta] = await fastify.redis.mget(
        locationKey(companyId, routeId),
        etaKey(companyId, routeId),
      )
      const payload = {
        location: rawLocation ? JSON.parse(rawLocation) : null,
        eta: rawEta ? JSON.parse(rawEta) : null,
        ts: Date.now(),
      }
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    await push()
    const interval = setInterval(() => {
      push().catch(() => clearInterval(interval))
    }, 3_000)

    request.raw.on('close', () => clearInterval(interval))
  })

  /**
   * GET /api/v1/locations/:routeId/eta
   * ETA worker'ının son hesapladığı durak bazlı varış süreleri.
   */
  fastify.get(
    '/:routeId/eta',
    { schema: getEtaSchema, onRequest: [fastify.requireRole(['company_admin'])] },
    async (request, reply) => {
      const raw = await fastify.redis.get(
        etaKey(request.user.companyId, request.params.routeId),
      )
      if (!raw) return reply.notFound('Bu güzergah için güncel ETA yok')
      return JSON.parse(raw)
    },
  )
}
