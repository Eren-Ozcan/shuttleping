import { ingestLocationSchema, getLocationSchema } from './schema.js'

// Son konum Redis'te tutulur; araç yayın kesilirse 5 dk sonra "çevrimdışı" sayılır
const LOCATION_TTL_SECONDS = 300

const locationKey = (companyId, routeId) => `loc:${companyId}:${routeId}`

export default async function locationRoutes(fastify) {
  /**
   * POST /api/v1/locations
   * Sürücü (Android app) anlık konum gönderir.
   * Sürücünün atandığı aktif güzergah bulunur, son konum Redis'e yazılır.
   * Faz 3'te ETA worker'ı, Faz 6'da SSE canlı harita bu veriyi okur.
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
}
