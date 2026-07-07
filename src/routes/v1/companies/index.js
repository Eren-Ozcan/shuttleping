import {
  createCompanySchema,
  createCompanyAdminSchema,
  listCompaniesSchema,
} from './schema.js'
import { hashPassword } from '../../../services/auth.service.js'

export default async function companyRoutes(fastify) {
  /**
   * GET /api/v1/companies
   * Tüm şirketleri listeler. Sadece super_admin erişebilir.
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
      let sql = `SELECT id, name, slug, is_active AS "isActive",
        created_at AS "createdAt" FROM companies`

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
   * Yeni şirket oluşturur. Sadece super_admin.
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
           RETURNING id, name, slug, is_active AS "isActive", created_at AS "createdAt"`,
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
   * POST /api/v1/companies/:id/admins
   * Şirketin (ilk) yöneticisini oluşturur. Sadece super_admin —
   * onboarding akışı: şirket aç → yöneticisini ata → gerisini o yönetir.
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
