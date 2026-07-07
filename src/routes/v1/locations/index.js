import { ingestLocationSchema, getLocationSchema, getEtaSchema } from './schema.js'
import { locationKey, etaKey } from '../../../services/eta/index.js'
import { enqueueEtaJob } from '../../../queues/index.js'

// Son konum Redis'te tutulur; araç yayın kesilirse 5 dk sonra "çevrimdışı" sayılır
const LOCATION_TTL_SECONDS = 300

export default async function locationRoutes(fastify) {
  /**
   * POST /api/v1/locations
   * Sürücü (Android app) anlık konum gönderir.
   * Sürücünün atandığı aktif güzergah bulunur, son konum Redis'e yazılır,
   * ETA worker'ı için kuyruğa job atılır.
   */
  fastify.post(
    '/',
    { schema: ingestLocationSchema, onRequest: [fastify.requireRole(['driver'])] },
    async (request, reply) => {
      const { lat, lng, heading, speed } = request.body
      const companyId = request.user.companyId
      const driverId = request.user.sub

      const { rows } = await fastify.db.query(
        `SELECT id FROM routes
         WHERE driver_id = $1 AND company_id = $2 AND is_active = true`,
        [driverId, companyId],
      )
      if (!rows[0]) {
        return reply.notFound('Size atanmış aktif bir güzergah yok')
      }

      const routeId = rows[0].id
      const payload = JSON.stringify({
        lat,
        lng,
        heading: heading ?? null,
        speed: speed ?? null,
        driverId,
        ts: Date.now(),
      })

      await fastify.redis.set(
        locationKey(companyId, routeId),
        payload,
        'EX',
        LOCATION_TTL_SECONDS,
      )

      await enqueueEtaJob({ companyId, routeId })

      return { ok: true, routeId }
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
