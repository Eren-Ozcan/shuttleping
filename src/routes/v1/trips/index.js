import {
  startTripSchema,
  endTripSchema,
  listTripsSchema,
  getTripSchema,
} from './schema.js'
import { locationKey, etaKey, etaCalcKey } from '../../../services/eta/index.js'

const TRIP_COLUMNS = `t.id, t.route_id AS "routeId", r.name AS "routeName",
  t.driver_id AS "driverId", t.vehicle_id AS "vehicleId", t.status,
  t.started_at AS "startedAt", t.ended_at AS "endedAt",
  t.last_ping_at AS "lastPingAt"`

export default async function tripRoutes(fastify) {
  const driverOnly = [fastify.requireRole(['driver'])]
  // Trip history is also open to super_admin for support (E12)
  const supportRead = [fastify.allowSupportRead(['company_admin'])]

  /**
   * POST /api/v1/trips/start
   * The driver starts a shift. If an active trip already exists, it is returned (idempotent).
   * Route selection is deterministic: the oldest-created active route.
   */
  fastify.post(
    '/start',
    { schema: startTripSchema, onRequest: driverOnly },
    async (request, reply) => {
      const companyId = request.user.companyId
      const driverId = request.user.sub

      const existing = await fastify.db.query(
        `SELECT ${TRIP_COLUMNS} FROM trips t
         JOIN routes r ON r.id = t.route_id
         WHERE t.driver_id = $1 AND t.company_id = $2 AND t.status = 'active'`,
        [driverId, companyId],
      )
      if (existing.rows[0]) return existing.rows[0]

      const { rows: routeRows } = await fastify.db.query(
        `SELECT id, vehicle_id FROM routes
         WHERE driver_id = $1 AND company_id = $2 AND is_active = true
         ORDER BY created_at
         LIMIT 1`,
        [driverId, companyId],
      )
      if (!routeRows[0]) {
        return reply.notFound('Size atanmış aktif bir güzergah yok')
      }
      const route = routeRows[0]

      const client = await fastify.db.connect()
      try {
        await client.query('BEGIN')

        const { rows: tripRows } = await client.query(
          `INSERT INTO trips (company_id, route_id, driver_id, vehicle_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [companyId, route.id, driverId, route.vehicle_id],
        )
        const tripId = tripRows[0].id

        // Snapshot the active stops when the trip is opened
        await client.query(
          `INSERT INTO trip_stops (company_id, trip_id, stop_id, sequence)
           SELECT $1, $2, id, sequence FROM stops
           WHERE route_id = $3 AND company_id = $1 AND is_active = true`,
          [companyId, tripId, route.id],
        )

        await client.query('COMMIT')

        const { rows } = await fastify.db.query(
          `SELECT ${TRIP_COLUMNS} FROM trips t
           JOIN routes r ON r.id = t.route_id
           WHERE t.id = $1`,
          [tripId],
        )
        return reply.code(201).send(rows[0])
      } catch (err) {
        await client.query('ROLLBACK')
        // trips_route_active_unique — another driver already opened a trip on this route
        if (err.code === '23505') {
          return reply.conflict('Bu güzergahta zaten aktif bir sefer var')
        }
        throw err
      } finally {
        client.release()
      }
    },
  )

  /**
   * POST /api/v1/trips/end
   * Completes the active trip and clears the route's live Redis keys.
   */
  fastify.post(
    '/end',
    { schema: endTripSchema, onRequest: driverOnly },
    async (request, reply) => {
      const companyId = request.user.companyId
      const driverId = request.user.sub

      const { rows } = await fastify.db.query(
        `UPDATE trips SET status = 'completed', ended_at = now()
         WHERE driver_id = $1 AND company_id = $2 AND status = 'active'
         RETURNING route_id`,
        [driverId, companyId],
      )
      if (!rows[0]) return reply.notFound('Aktif sefer yok')

      const routeId = rows[0].route_id
      await fastify.redis.del(
        locationKey(companyId, routeId),
        etaKey(companyId, routeId),
        etaCalcKey(routeId),
      )
      return { ok: true }
    },
  )

  /**
   * GET /api/v1/trips
   * Trip history list (company_admin).
   */
  fastify.get(
    '/',
    { schema: listTripsSchema, onRequest: supportRead },
    async (request) => {
      const { routeId, status, from, to, limit } = request.query
      const params = [request.user.companyId]
      const conditions = ['t.company_id = $1']

      if (routeId) {
        params.push(routeId)
        conditions.push(`t.route_id = $${params.length}`)
      }
      if (status) {
        params.push(status)
        conditions.push(`t.status = $${params.length}`)
      }
      if (from) {
        params.push(from)
        conditions.push(`t.started_at >= $${params.length}`)
      }
      if (to) {
        params.push(to)
        conditions.push(`t.started_at <= $${params.length}`)
      }
      params.push(limit)

      const { rows } = await fastify.db.query(
        `SELECT ${TRIP_COLUMNS} FROM trips t
         JOIN routes r ON r.id = t.route_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.started_at DESC
         LIMIT $${params.length}`,
        params,
      )
      return { items: rows }
    },
  )

  /**
   * GET /api/v1/trips/:id
   * A single trip + stop states + notification summary.
   */
  fastify.get(
    '/:id',
    { schema: getTripSchema, onRequest: supportRead },
    async (request, reply) => {
      const companyId = request.user.companyId

      const { rows } = await fastify.db.query(
        `SELECT ${TRIP_COLUMNS} FROM trips t
         JOIN routes r ON r.id = t.route_id
         WHERE t.id = $1 AND t.company_id = $2`,
        [request.params.id, companyId],
      )
      if (!rows[0]) return reply.notFound('Sefer bulunamadı')
      const trip = rows[0]

      const { rows: stops } = await fastify.db.query(
        `SELECT ts.stop_id AS "stopId", s.name, ts.sequence, ts.state,
                ts.notified_at AS "notifiedAt", ts.passed_at AS "passedAt"
         FROM trip_stops ts
         JOIN stops s ON s.id = ts.stop_id
         WHERE ts.trip_id = $1
         ORDER BY ts.sequence`,
        [request.params.id],
      )

      const { rows: notif } = await fastify.db.query(
        `SELECT status, count(*)::int AS n FROM notification_logs
         WHERE trip_id = $1 GROUP BY status`,
        [request.params.id],
      )
      const notifications = { sent: 0, failed: 0 }
      for (const row of notif) {
        if (row.status in notifications) notifications[row.status] = row.n
      }

      return { ...trip, stops, notifications }
    },
  )
}
