import { getTrackSchema } from './schema.js'
import { trackTokenKey } from '../../../services/tracking.service.js'
import { etaKey } from '../../../services/eta/index.js'
import { env } from '../../../config/env.js'

/**
 * Public, unauthenticated passenger tracking page data (T1.5 / R-5).
 *
 * The token is opaque and multi-use for its TTL (see notification.worker.js);
 * it scopes the response to exactly one stop — never the vehicle position or
 * the rest of the route, so a leaked link cannot be used to track anyone else.
 */
export default async function trackRoutes(fastify) {
  fastify.get(
    '/:token',
    {
      schema: getTrackSchema,
      config: { rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const raw = await fastify.redis.get(trackTokenKey(request.params.token))
      if (!raw) return reply.notFound('Bu takip bağlantısının süresi dolmuş')

      const { companyId, routeId, stopId, stopName, companyName } = JSON.parse(raw)

      const rawEta = await fastify.redis.get(etaKey(companyId, routeId))
      const eta = rawEta ? JSON.parse(rawEta) : null
      const stop = eta?.stops?.find((s) => s.stopId === stopId)

      return {
        companyName,
        stopName,
        status: stop?.state ?? 'unknown',
        etaMinutes: stop?.etaSeconds != null ? Math.max(Math.round(stop.etaSeconds / 60), 0) : null,
        updatedAt: eta?.ts ?? null,
      }
    },
  )
}
