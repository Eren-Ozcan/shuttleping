import {
  listPassengersSchema,
  createPassengerSchema,
  updatePassengerSchema,
} from './schema.js'
import { buildUpdate } from '../../../utils/sql.js'

const PASSENGER_COLS = [
  'id',
  'stop_id AS "stopId"',
  'full_name AS "fullName"',
  'phone',
  'telegram_chat_id AS "telegramChatId"',
  'notification_channel AS "notificationChannel"',
  'notify_before_minutes AS "notifyBeforeMinutes"',
  'is_active AS "isActive"',
  'created_at AS "createdAt"',
]

/** Kolon listesini opsiyonel tablo alias'ıyla üretir: passengerColumns('p.') */
const passengerColumns = (prefix = '') =>
  PASSENGER_COLS.map((col) => prefix + col).join(', ')

export default async function passengerRoutes(fastify) {
  const adminOnly = [fastify.requireRole(['company_admin'])]

  /** Durağın bu şirkete ait ve aktif olduğunu doğrular. */
  async function stopBelongsToCompany(stopId, companyId) {
    const { rows } = await fastify.db.query(
      'SELECT id FROM stops WHERE id = $1 AND company_id = $2 AND is_active = true',
      [stopId, companyId],
    )
    return Boolean(rows[0])
  }

  /**
   * GET /api/v1/passengers
   * Durak adıyla birlikte listeler (stopId/active filtreli).
   */
  fastify.get(
    '/',
    { schema: listPassengersSchema, onRequest: adminOnly },
    async (request) => {
      const { stopId, active } = request.query
      const params = [request.user.companyId]
      let sql = `
        SELECT ${passengerColumns('p.')}, s.name AS "stopName"
        FROM passengers p
        JOIN stops s ON s.id = p.stop_id
        WHERE p.company_id = $1`

      if (stopId !== undefined) {
        params.push(stopId)
        sql += ` AND p.stop_id = $${params.length}`
      }
      if (active !== undefined) {
        params.push(active)
        sql += ` AND p.is_active = $${params.length}`
      }

      sql += ' ORDER BY p.created_at DESC'
      const { rows } = await fastify.db.query(sql, params)
      return rows
    },
  )

  /**
   * POST /api/v1/passengers
   */
  fastify.post(
    '/',
    { schema: createPassengerSchema, onRequest: adminOnly },
    async (request, reply) => {
      const companyId = request.user.companyId
      const {
        stopId,
        fullName,
        phone,
        telegramChatId,
        notificationChannel,
        notifyBeforeMinutes,
      } = request.body

      if (!(await stopBelongsToCompany(stopId, companyId))) {
        return reply.badRequest('Durak bulunamadı')
      }

      const { rows } = await fastify.db.query(
        `INSERT INTO passengers
           (company_id, stop_id, full_name, phone, telegram_chat_id,
            notification_channel, notify_before_minutes)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE($6, 'telegram'), COALESCE($7, 10))
         RETURNING ${passengerColumns()}`,
        [
          companyId,
          stopId,
          fullName,
          phone ?? null,
          telegramChatId ?? null,
          notificationChannel ?? null,
          notifyBeforeMinutes ?? null,
        ],
      )
      return reply.code(201).send(rows[0])
    },
  )

  /**
   * PATCH /api/v1/passengers/:id
   */
  fastify.patch(
    '/:id',
    { schema: updatePassengerSchema, onRequest: adminOnly },
    async (request, reply) => {
      const companyId = request.user.companyId
      const {
        stopId,
        fullName,
        phone,
        telegramChatId,
        notificationChannel,
        notifyBeforeMinutes,
        isActive,
      } = request.body

      if (stopId !== undefined && !(await stopBelongsToCompany(stopId, companyId))) {
        return reply.badRequest('Durak bulunamadı')
      }

      const { sets, params } = buildUpdate({
        stop_id: stopId,
        full_name: fullName,
        phone,
        telegram_chat_id: telegramChatId,
        notification_channel: notificationChannel,
        notify_before_minutes: notifyBeforeMinutes,
        is_active: isActive,
      })

      params.push(request.params.id, companyId)
      const { rows } = await fastify.db.query(
        `UPDATE passengers SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.length - 1} AND company_id = $${params.length}
         RETURNING ${passengerColumns()}`,
        params,
      )

      if (!rows[0]) return reply.notFound('Yolcu bulunamadı')
      return rows[0]
    },
  )
}
