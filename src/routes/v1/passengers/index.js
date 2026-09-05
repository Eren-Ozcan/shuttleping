import {
  listPassengersSchema,
  createPassengerSchema,
  updatePassengerSchema,
} from './schema.js'
import { buildUpdate } from '../../../utils/sql.js'
import { checkPassengerQuota } from '../../../services/billing.service.js'
import { generateInviteCode } from '../../../utils/inviteCode.js'

const PASSENGER_COLS = [
  'id',
  'stop_id AS "stopId"',
  'full_name AS "fullName"',
  'phone',
  'telegram_chat_id AS "telegramChatId"',
  'invite_code AS "inviteCode"',
  'consent_given_at AS "consentGivenAt"',
  'notification_channel AS "notificationChannel"',
  'notify_before_minutes AS "notifyBeforeMinutes"',
  'is_active AS "isActive"',
  'created_at AS "createdAt"',
]

const UNIQUE_VIOLATION = '23505'
const INVITE_CODE_ATTEMPTS = 5
// Matches the "Sürüm" line in docs/KVKK-AYDINLATMA-METNI.md — bump both
// together when the disclosure text materially changes
const CONSENT_VERSION = 'taslak-1'

/** Builds the column list with an optional table alias: passengerColumns('p.') */
const passengerColumns = (prefix = '') =>
  PASSENGER_COLS.map((col) => prefix + col).join(', ')

export default async function passengerRoutes(fastify) {
  const adminOnly = [fastify.requireRole(['company_admin'])]

  /** Verifies the stop belongs to this company and is active. */
  async function stopBelongsToCompany(stopId, companyId) {
    const { rows } = await fastify.db.query(
      'SELECT id FROM stops WHERE id = $1 AND company_id = $2 AND is_active = true',
      [stopId, companyId],
    )
    return Boolean(rows[0])
  }

  /**
   * GET /api/v1/passengers
   * Lists passengers with the stop name (filtered by stopId/active).
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

      // Passenger quota (C6) — pricing is per passenger, this is the only meaningful limit
      const quota = await checkPassengerQuota(companyId, fastify.redis)
      if (!quota.allowed) {
        return reply.paymentRequired(
          `Yolcu kotanız dolu (${quota.used}/${quota.max}). Paketinizi yükseltmek için iletişime geçin`,
        )
      }

      for (let attempt = 1; attempt <= INVITE_CODE_ATTEMPTS; attempt += 1) {
        try {
          const { rows } = await fastify.db.query(
            `INSERT INTO passengers
               (company_id, stop_id, full_name, phone, telegram_chat_id,
                invite_code, consent_given_at, consent_version,
                notification_channel, notify_before_minutes)
             VALUES ($1, $2, $3, $4, $5,
                     $6, now(), $7, COALESCE($8, 'telegram'), COALESCE($9, 10))
             RETURNING ${passengerColumns()}`,
            [
              companyId,
              stopId,
              fullName,
              phone ?? null,
              telegramChatId ?? null,
              generateInviteCode(),
              CONSENT_VERSION,
              notificationChannel ?? null,
              notifyBeforeMinutes ?? null,
            ],
          )
          return reply.code(201).send(rows[0])
        } catch (err) {
          // invite_code collision (astronomically unlikely at 8 chars/33-symbol
          // alphabet, but the index is unique so a retry has to exist) — retry
          // with a fresh code instead of failing the passenger's creation
          if (err.code !== UNIQUE_VIOLATION || attempt === INVITE_CODE_ATTEMPTS) throw err
        }
      }
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
        `UPDATE passengers SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND company_id = $${params.length}
         RETURNING ${passengerColumns()}`,
        params,
      )

      if (!rows[0]) return reply.notFound('Yolcu bulunamadı')
      return rows[0]
    },
  )
}
