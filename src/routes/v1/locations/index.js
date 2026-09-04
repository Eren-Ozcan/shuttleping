import { randomBytes } from 'node:crypto'
import {
  ingestLocationSchema,
  getLocationSchema,
  getEtaSchema,
  streamSchema,
  streamTicketSchema,
} from './schema.js'
import { locationKey, etaKey } from '../../../services/eta/index.js'
import { enqueueEtaJob } from '../../../queues/index.js'
import { getCompanyAccess, canIngestLocation } from '../../../services/billing.service.js'
import { env } from '../../../config/env.js'

// The last location lives in Redis; if the vehicle stops broadcasting it is "offline" after 5 min
const LOCATION_TTL_SECONDS = 300
// The SSE ticket must be short-lived — just long enough to open the EventSource
const STREAM_TICKET_TTL_SECONDS = 60
const streamTicketKey = (ticket) => `streamticket:${ticket}`

export default async function locationRoutes(fastify) {
  // Closers for the open SSE streams; all are terminated on shutdown (E8)
  const openStreams = new Set()
  fastify.addHook('onClose', async () => {
    for (const close of [...openStreams]) close()
  })

  /**
   * POST /api/v1/locations
   * The driver sends a live location. It is only accepted while an ACTIVE TRIP
   * exists (opened via POST /api/v1/trips/start); the last location is written
   * to Redis, a trace is appended to trip history, and a job is queued for the ETA worker.
   */
  fastify.post(
    '/',
    {
      schema: ingestLocationSchema,
      onRequest: [fastify.requireRole(['driver'])],
      // The client sends every 10s; 12/minute per driver is a sane ceiling.
      // Each ping is a DB write + a potentially billed Google call (D1)
      config: {
        rateLimit: { max: env.RATE_LIMIT_LOCATION_MAX, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { lat, lng, heading, speed, recordedAt } = request.body
      const companyId = request.user.companyId
      const driverId = request.user.sub

      // No location is accepted for a suspended company — so trip history does
      // not keep growing and ETA/notification cost does not keep flowing (C1)
      const access = await getCompanyAccess(companyId, fastify.redis)
      if (!canIngestLocation(access)) {
        return reply.paymentRequired('Şirket hesabı askıya alındı')
      }

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
      // Offline buffer flush: an old fix must not trigger the live location and
      // ETA, only be written to history. It still refreshes last_ping (which
      // proves the connection is back) — preventing a wrong "abandoned" mark.
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
        // Trip history (Phase 7) — append-only trace record
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
   * The last known position of the vehicle on a route (admin panel map).
   */
  fastify.get(
    '/:routeId',
    { schema: getLocationSchema, onRequest: [fastify.allowSupportRead(['company_admin'])] },
    async (request, reply) => {
      const raw = await fastify.redis.get(
        locationKey(request.user.companyId, request.params.routeId),
      )
      if (!raw) return reply.notFound('Bu güzergah için güncel konum yok')
      return JSON.parse(raw)
    },
  )

  /**
   * POST /api/v1/locations/:routeId/stream-ticket
   * Produces a single-use, 60s ticket for SSE. Because EventSource cannot
   * carry an Authorization header, the stream is opened with this ticket —
   * the access token never enters the URL (D2).
   */
  fastify.post(
    '/:routeId/stream-ticket',
    // POST but read-only in effect (issues an opaque ticket, writes no tenant
    // record) — support access is allowed the same as the GET endpoints below
    { schema: streamTicketSchema, onRequest: [fastify.allowSupportRead(['company_admin'])] },
    async (request, reply) => {
      const { routeId } = request.params
      const companyId = request.user.companyId

      // Route ownership is verified here, from the DB — the stream's isolation
      // no longer relies only on the Redis key namespace (D4)
      const { rows } = await fastify.db.query(
        'SELECT id FROM routes WHERE id = $1 AND company_id = $2',
        [routeId, companyId],
      )
      if (!rows[0]) return reply.notFound('Güzergah bulunamadı')

      const ticket = randomBytes(32).toString('hex')
      await fastify.redis.set(
        streamTicketKey(ticket),
        JSON.stringify({ companyId, routeId, sub: request.user.sub }),
        'EX',
        STREAM_TICKET_TTL_SECONDS,
      )
      return { ticket, expiresIn: STREAM_TICKET_TTL_SECONDS }
    },
  )

  /**
   * GET /api/v1/locations/:routeId/stream
   * SSE: pushes location + ETA every 3s (live map).
   * Authentication is via the stream ticket; the ticket is single-use.
   */
  fastify.get('/:routeId/stream', { schema: streamSchema }, async (request, reply) => {
    const { routeId } = request.params

    // Single-use: deleted the moment it is read, cannot be reused
    const key = streamTicketKey(request.query.ticket)
    const raw = await fastify.redis.get(key)
    if (!raw) return reply.unauthorized('Geçersiz veya süresi dolmuş bilet')
    await fastify.redis.del(key)

    const granted = JSON.parse(raw)
    if (granted.routeId !== routeId) {
      return reply.forbidden('Bilet bu güzergah için geçerli değil')
    }
    const { companyId } = granted

    // CORS: rather than reflecting the incoming Origin, allow the same origin
    // as the global policy — a hijacked response bypasses @fastify/cors, so set it by hand (D3)
    const origin = request.headers.origin
    const corsHeaders =
      origin && origin === env.CORS_ORIGIN
        ? {
            'access-control-allow-origin': origin,
            'access-control-allow-credentials': 'true',
            vary: 'Origin',
          }
        : {}

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...corsHeaders,
      // Disable nginx/proxy buffering — SSE must flow immediately
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

    // Shutdown registration: if open streams are not terminated during
    // shutdown, fastify.close() hangs and the platform SIGKILLs the process (E8)
    let interval = null
    const close = () => {
      if (interval) clearInterval(interval)
      openStreams.delete(close)
      reply.raw.end()
    }

    interval = setInterval(() => {
      push().catch(close)
    }, 3_000)

    openStreams.add(close)
    request.raw.on('close', () => {
      clearInterval(interval)
      openStreams.delete(close)
    })
  })

  /**
   * GET /api/v1/locations/:routeId/eta
   * The per-stop arrival times last computed by the ETA worker.
   */
  fastify.get(
    '/:routeId/eta',
    { schema: getEtaSchema, onRequest: [fastify.allowSupportRead(['company_admin'])] },
    async (request, reply) => {
      const raw = await fastify.redis.get(
        etaKey(request.user.companyId, request.params.routeId),
      )
      if (!raw) return reply.notFound('Bu güzergah için güncel ETA yok')
      return JSON.parse(raw)
    },
  )
}
