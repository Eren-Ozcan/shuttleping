import {
  listVehiclesSchema,
  createVehicleSchema,
  updateVehicleSchema,
} from './schema.js'
import { buildUpdate } from '../../../utils/sql.js'

const VEHICLE_COLUMNS = `id, plate, name, is_active AS "isActive", created_at AS "createdAt"`

export default async function vehicleRoutes(fastify) {
  const adminOnly = [fastify.requireRole(['company_admin'])]

  /**
   * GET /api/v1/vehicles
   */
  fastify.get(
    '/',
    { schema: listVehiclesSchema, onRequest: adminOnly },
    async (request) => {
      const { active } = request.query
      const params = [request.user.companyId]
      let sql = `SELECT ${VEHICLE_COLUMNS} FROM vehicles WHERE company_id = $1`

      if (active !== undefined) {
        params.push(active)
        sql += ` AND is_active = $${params.length}`
      }

      sql += ' ORDER BY created_at DESC'
      const { rows } = await fastify.db.query(sql, params)
      return rows
    },
  )

  /**
   * POST /api/v1/vehicles
   */
  fastify.post(
    '/',
    { schema: createVehicleSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { plate, name } = request.body

      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO vehicles (company_id, plate, name)
           VALUES ($1, $2, $3)
           RETURNING ${VEHICLE_COLUMNS}`,
          [request.user.companyId, plate, name ?? null],
        )
        return reply.code(201).send(rows[0])
      } catch (err) {
        if (err.code === '23505') {
          return reply.conflict('Bu plaka zaten kayıtlı')
        }
        throw err
      }
    },
  )

  /**
   * PATCH /api/v1/vehicles/:id
   */
  fastify.patch(
    '/:id',
    { schema: updateVehicleSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { plate, name, isActive } = request.body
      const { sets, params } = buildUpdate({ plate, name, is_active: isActive })

      params.push(request.params.id, request.user.companyId)

      try {
        const { rows } = await fastify.db.query(
          `UPDATE vehicles SET ${sets.join(', ')}, updated_at = now()
           WHERE id = $${params.length - 1} AND company_id = $${params.length}
           RETURNING ${VEHICLE_COLUMNS}`,
          params,
        )
        if (!rows[0]) return reply.notFound('Araç bulunamadı')
        return rows[0]
      } catch (err) {
        if (err.code === '23505') {
          return reply.conflict('Bu plaka zaten kayıtlı')
        }
        throw err
      }
    },
  )
}
