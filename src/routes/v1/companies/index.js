import { createCompanySchema, listCompaniesSchema } from './schema.js'

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
}
