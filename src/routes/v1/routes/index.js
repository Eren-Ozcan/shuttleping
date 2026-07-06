import {
  listRoutesSchema,
  createRouteSchema,
  updateRouteSchema,
  listStopsSchema,
  createStopSchema,
  updateStopSchema,
} from './schema.js'
import { buildUpdate } from '../../../utils/sql.js'

const STOP_COLUMNS = `id, route_id AS "routeId", name, lat, lng, sequence,
  is_active AS "isActive", created_at AS "createdAt"`

export default async function routeRoutes(fastify) {
  const adminOnly = [fastify.requireRole(['company_admin'])]

  /** Güzergahın bu şirkete ait olduğunu doğrular; değilse null döner. */
  async function findRoute(routeId, companyId) {
    const { rows } = await fastify.db.query(
      'SELECT id FROM routes WHERE id = $1 AND company_id = $2',
      [routeId, companyId],
    )
    return rows[0] ?? null
  }

  /**
   * GET /api/v1/routes
   * Sürücü adı ve araç plakasıyla birlikte listeler.
   */
  fastify.get(
    '/',
    { schema: listRoutesSchema, onRequest: adminOnly },
    async (request) => {
      const { active } = request.query
      const params = [request.user.companyId]
      let sql = `
        SELECT r.id, r.name,
               r.driver_id AS "driverId", u.full_name AS "driverName",
               r.vehicle_id AS "vehicleId", v.plate AS "vehiclePlate",
               r.is_active AS "isActive", r.created_at AS "createdAt"
        FROM routes r
        LEFT JOIN users u ON u.id = r.driver_id
        LEFT JOIN vehicles v ON v.id = r.vehicle_id
        WHERE r.company_id = $1`

      if (active !== undefined) {
        params.push(active)
        sql += ` AND r.is_active = $${params.length}`
      }

      sql += ' ORDER BY r.created_at DESC'
      const { rows } = await fastify.db.query(sql, params)
      return rows
    },
  )

  /**
   * POST /api/v1/routes
   */
  fastify.post(
    '/',
    { schema: createRouteSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { rows } = await fastify.db.query(
        `INSERT INTO routes (company_id, name)
         VALUES ($1, $2)
         RETURNING id, name, driver_id AS "driverId", vehicle_id AS "vehicleId",
                   is_active AS "isActive", created_at AS "createdAt"`,
        [request.user.companyId, request.body.name],
      )
      return reply.code(201).send(rows[0])
    },
  )

  /**
   * PATCH /api/v1/routes/:id
   * Ad, sürücü/araç ataması (null = atamayı kaldır), soft delete.
   */
  fastify.patch(
    '/:id',
    { schema: updateRouteSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { name, driverId, vehicleId, isActive } = request.body
      const companyId = request.user.companyId

      // Atanan sürücü/araç aynı şirkette ve aktif olmalı
      if (driverId) {
        const { rows } = await fastify.db.query(
          `SELECT id FROM users
           WHERE id = $1 AND company_id = $2 AND role = 'driver' AND is_active = true`,
          [driverId, companyId],
        )
        if (!rows[0]) return reply.badRequest('Sürücü bulunamadı')
      }
      if (vehicleId) {
        const { rows } = await fastify.db.query(
          'SELECT id FROM vehicles WHERE id = $1 AND company_id = $2 AND is_active = true',
          [vehicleId, companyId],
        )
        if (!rows[0]) return reply.badRequest('Araç bulunamadı')
      }

      const { sets, params } = buildUpdate({
        name,
        driver_id: driverId,
        vehicle_id: vehicleId,
        is_active: isActive,
      })

      params.push(request.params.id, companyId)
      const { rows } = await fastify.db.query(
        `UPDATE routes SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.length - 1} AND company_id = $${params.length}
         RETURNING id, name, driver_id AS "driverId", vehicle_id AS "vehicleId",
                   is_active AS "isActive", created_at AS "createdAt"`,
        params,
      )

      if (!rows[0]) return reply.notFound('Güzergah bulunamadı')
      return rows[0]
    },
  )

  /**
   * GET /api/v1/routes/:id/stops
   * Durakları sequence sırasıyla listeler.
   */
  fastify.get(
    '/:id/stops',
    { schema: listStopsSchema, onRequest: adminOnly },
    async (request, reply) => {
      const companyId = request.user.companyId
      if (!(await findRoute(request.params.id, companyId))) {
        return reply.notFound('Güzergah bulunamadı')
      }

      const { rows } = await fastify.db.query(
        `SELECT ${STOP_COLUMNS} FROM stops
         WHERE route_id = $1 AND company_id = $2
         ORDER BY sequence`,
        [request.params.id, companyId],
      )
      return rows
    },
  )

  /**
   * POST /api/v1/routes/:id/stops
   */
  fastify.post(
    '/:id/stops',
    { schema: createStopSchema, onRequest: adminOnly },
    async (request, reply) => {
      const companyId = request.user.companyId
      if (!(await findRoute(request.params.id, companyId))) {
        return reply.notFound('Güzergah bulunamadı')
      }

      const { name, lat, lng, sequence } = request.body

      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO stops (company_id, route_id, name, lat, lng, sequence)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${STOP_COLUMNS}`,
          [companyId, request.params.id, name, lat, lng, sequence],
        )
        return reply.code(201).send(rows[0])
      } catch (err) {
        if (err.code === '23505') {
          return reply.conflict('Bu sıra numarası bu güzergahta zaten kullanımda')
        }
        throw err
      }
    },
  )

  /**
   * PATCH /api/v1/routes/:id/stops/:stopId
   */
  fastify.patch(
    '/:id/stops/:stopId',
    { schema: updateStopSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { name, lat, lng, sequence, isActive } = request.body
      const { sets, params } = buildUpdate({
        name,
        lat,
        lng,
        sequence,
        is_active: isActive,
      })

      params.push(request.params.stopId, request.params.id, request.user.companyId)

      try {
        const { rows } = await fastify.db.query(
          `UPDATE stops SET ${sets.join(', ')}, updated_at = now()
           WHERE id = $${params.length - 2} AND route_id = $${params.length - 1}
             AND company_id = $${params.length}
           RETURNING ${STOP_COLUMNS}`,
          params,
        )
        if (!rows[0]) return reply.notFound('Durak bulunamadı')
        return rows[0]
      } catch (err) {
        if (err.code === '23505') {
          return reply.conflict('Bu sıra numarası bu güzergahta zaten kullanımda')
        }
        throw err
      }
    },
  )
}
