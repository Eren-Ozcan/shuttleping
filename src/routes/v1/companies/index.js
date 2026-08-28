import {
  createCompanySchema,
  createCompanyAdminSchema,
  listCompaniesSchema,
  listPaymentsSchema,
  updateCompanySchema,
  updatePaymentStatusSchema,
} from './schema.js'
import { hashPassword } from '../../../services/auth.service.js'
import { invalidateCompanyAccess } from '../../../services/billing.service.js'
import { buildUpdate } from '../../../utils/sql.js'

const COMPANY_COLUMNS = `id, name, slug, is_active AS "isActive",
  payment_status AS "paymentStatus",
  last_payment_date AS "lastPaymentDate",
  next_due_date AS "nextDueDate",
  max_passengers AS "maxPassengers",
  dry_run AS "dryRun",
  created_at AS "createdAt"`

export default async function companyRoutes(fastify) {
  /**
   * GET /api/v1/companies
   * Lists all companies. Only super_admin can access it.
   */
  fastify.get(
    '/',
    {
      schema: listCompaniesSchema,
      onRequest: [fastify.requireRole(['super_admin'])],
    },
    async (request) => {
      const { active } = request.query
      const params = []
      let sql = `SELECT ${COMPANY_COLUMNS} FROM companies`

      if (active !== undefined) {
        params.push(active)
        sql += ` WHERE is_active = $${params.length}`
      }

      sql += ' ORDER BY created_at DESC'
      const { rows } = await fastify.db.query(sql, params)
      return rows
    },
  )

  /**
   * POST /api/v1/companies
   * Creates a new company. super_admin only.
   */
  fastify.post(
    '/',
    {
      schema: createCompanySchema,
      onRequest: [fastify.requireRole(['super_admin'])],
    },
    async (request, reply) => {
      const { name, slug } = request.body

      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO companies (name, slug)
           VALUES ($1, $2)
           RETURNING ${COMPANY_COLUMNS}`,
          [name, slug],
        )
        return reply.code(201).send(rows[0])
      } catch (err) {
        // PostgreSQL unique violation
        if (err.code === '23505') {
          return reply.conflict('Bu slug zaten kullanımda')
        }
        throw err
      }
    },
  )

  /**
   * PATCH /api/v1/companies/:id/payment-status
   * Payment is taken in cash / by bank transfer (no gateway) — super_admin marks it manually.
   * 'active': last_payment_date = now(), next_due_date defaults to +30 days if not given.
   * 'overdue': company_admin/driver logins are blocked in the auth layer.
   */
  fastify.patch(
    '/:id/payment-status',
    {
      schema: updatePaymentStatusSchema,
      onRequest: [fastify.requireRole(['super_admin'])],
    },
    async (request, reply) => {
      const { paymentStatus, nextDueDate, amount, note } = request.body
      const companyId = request.params.id

      const { rows: existing } = await fastify.db.query(
        'SELECT last_payment_date FROM companies WHERE id = $1',
        [companyId],
      )
      if (!existing[0]) return reply.notFound('Şirket bulunamadı')

      const client = await fastify.db.connect()
      let company
      try {
        await client.query('BEGIN')

        if (paymentStatus === 'active') {
          const { rows } = await client.query(
            `UPDATE companies
             SET payment_status = 'active',
                 last_payment_date = now(),
                 next_due_date = COALESCE($2, now() + interval '30 days')
             WHERE id = $1
             RETURNING ${COMPANY_COLUMNS}`,
            [companyId, nextDueDate ?? null],
          )
          company = rows[0]

          // Payment ledger (C4): previously last_payment_date was overwritten,
          // and amount / who marked it / which period were never stored
          await client.query(
            `INSERT INTO company_payments
               (company_id, amount, period_start, period_end, recorded_by, note)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              companyId,
              amount ?? null,
              existing[0].last_payment_date,
              company.nextDueDate,
              request.user.sub,
              note ?? null,
            ],
          )
        } else {
          const { rows } = await client.query(
            `UPDATE companies
             SET payment_status = $2
             WHERE id = $1
             RETURNING ${COMPANY_COLUMNS}`,
            [companyId, paymentStatus],
          )
          company = rows[0]
        }

        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }

      // Suspension must take effect immediately: existing sessions must not
      // live another 15 min, and the ETA/notification workers must not read stale cache
      if (paymentStatus === 'suspended') {
        await fastify.db.query(
          `DELETE FROM refresh_tokens
           WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)`,
          [companyId],
        )
      }
      await invalidateCompanyAccess(companyId, fastify.redis)

      return company
    },
  )

  /**
   * PATCH /api/v1/companies/:id
   * Company name, active flag and passenger quota. super_admin only.
   */
  fastify.patch(
    '/:id',
    { schema: updateCompanySchema, onRequest: [fastify.requireRole(['super_admin'])] },
    async (request, reply) => {
      const { name, isActive, maxPassengers, dryRun } = request.body
      const { sets, params } = buildUpdate({
        name,
        is_active: isActive,
        max_passengers: maxPassengers,
        dry_run: dryRun,
      })

      params.push(request.params.id)
      const { rows } = await fastify.db.query(
        `UPDATE companies SET ${sets.join(', ')}
         WHERE id = $${params.length}
         RETURNING ${COMPANY_COLUMNS}`,
        params,
      )
      if (!rows[0]) return reply.notFound('Şirket bulunamadı')

      if (isActive === false) {
        await fastify.db.query(
          `DELETE FROM refresh_tokens
           WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)`,
          [request.params.id],
        )
      }
      await invalidateCompanyAccess(request.params.id, fastify.redis)
      return rows[0]
    },
  )

  /**
   * GET /api/v1/companies/:id/payments
   * Payment history. super_admin only.
   */
  fastify.get(
    '/:id/payments',
    { schema: listPaymentsSchema, onRequest: [fastify.requireRole(['super_admin'])] },
    async (request) => {
      const { rows } = await fastify.db.query(
        `SELECT p.id, p.amount, p.currency, p.paid_at AS "paidAt",
                p.period_start AS "periodStart", p.period_end AS "periodEnd",
                p.note, u.full_name AS "recordedBy"
         FROM company_payments p
         LEFT JOIN users u ON u.id = p.recorded_by
         WHERE p.company_id = $1
         ORDER BY p.paid_at DESC
         LIMIT $2`,
        [request.params.id, request.query.limit],
      )
      return { items: rows }
    },
  )

  /**
   * POST /api/v1/companies/:id/admins
   * Creates the company's (first) admin. super_admin only —
   * onboarding flow: create a company -> assign its admin -> they manage the rest.
   */
  fastify.post(
    '/:id/admins',
    {
      schema: createCompanyAdminSchema,
      onRequest: [fastify.requireRole(['super_admin'])],
    },
    async (request, reply) => {
      const { rows: companies } = await fastify.db.query(
        'SELECT id FROM companies WHERE id = $1 AND is_active = true',
        [request.params.id],
      )
      if (!companies[0]) return reply.notFound('Şirket bulunamadı')

      const { email, password, fullName, phone } = request.body
      const passwordHash = await hashPassword(password)

      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO users (company_id, email, password_hash, role, full_name, phone)
           VALUES ($1, $2, $3, 'company_admin', $4, $5)
           RETURNING id, email, role, full_name AS "fullName", phone,
                     is_active AS "isActive", created_at AS "createdAt"`,
          [request.params.id, email, passwordHash, fullName, phone ?? null],
        )
        return reply.code(201).send(rows[0])
      } catch (err) {
        if (err.code === '23505') {
          return reply.conflict('Bu e-posta zaten kayıtlı')
        }
        throw err
      }
    },
  )
}
