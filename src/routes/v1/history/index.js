import { locationHistorySchema, notificationHistorySchema } from './schema.js'

export default async function historyRoutes(fastify) {
  /**
   * GET /api/v1/history/locations/:routeId
   * Güzergahın geçmiş konum kayıtları (sefer izi). from/to aralığı ve
   * limit ile sınırlandırılır; en yeni kayıt önce gelir.
   */
  fastify.get(
    '/locations/:routeId',
    {
      schema: locationHistorySchema,
      onRequest: [fastify.requireRole(['company_admin'])],
    },
    async (request) => {
      const { routeId } = request.params
      const { from, to, limit } = request.query

      const params = [routeId, request.user.companyId]
      const conditions = ['route_id = $1', 'company_id = $2']
      if (from) {
        params.push(from)
        conditions.push(`recorded_at >= $${params.length}`)
      }
      if (to) {
        params.push(to)
        conditions.push(`recorded_at <= $${params.length}`)
      }
      params.push(limit)

      const { rows } = await fastify.db.query(
        `SELECT id, driver_id, lat, lng, speed, heading, recorded_at
         FROM location_history
         WHERE ${conditions.join(' AND ')}
         ORDER BY recorded_at DESC
         LIMIT $${params.length}`,
        params,
      )
      return { items: rows }
    },
  )

  /**
   * GET /api/v1/history/notifications
   * Bildirim denetim kaydı; yolcu/durum/tarih filtreleri ile.
   */
  fastify.get(
    '/notifications',
    {
      schema: notificationHistorySchema,
      onRequest: [fastify.requireRole(['company_admin'])],
    },
    async (request) => {
      const { from, to, passengerId, status, limit } = request.query

      const params = [request.user.companyId]
      const conditions = ['n.company_id = $1']
      if (passengerId) {
        params.push(passengerId)
        conditions.push(`n.passenger_id = $${params.length}`)
      }
      if (status) {
        params.push(status)
        conditions.push(`n.status = $${params.length}`)
      }
      if (from) {
        params.push(from)
        conditions.push(`n.created_at >= $${params.length}`)
      }
      if (to) {
        params.push(to)
        conditions.push(`n.created_at <= $${params.length}`)
      }
      params.push(limit)

      const { rows } = await fastify.db.query(
        `SELECT n.id, n.passenger_id, p.full_name AS passenger_name,
                n.route_id, n.stop_id, n.channel, n.message, n.status,
                n.error, n.created_at
         FROM notification_logs n
         JOIN passengers p ON p.id = n.passenger_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY n.created_at DESC
         LIMIT $${params.length}`,
        params,
      )
      return { items: rows }
    },
  )
}
