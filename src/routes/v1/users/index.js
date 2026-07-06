import { listUsersSchema, createUserSchema, updateUserSchema } from './schema.js'
import { hashPassword } from '../../../services/auth.service.js'
import { buildUpdate } from '../../../utils/sql.js'

const USER_COLUMNS = `id, email, role, full_name AS "fullName", phone,
  is_active AS "isActive", created_at AS "createdAt"`

export default async function userRoutes(fastify) {
  const adminOnly = [fastify.requireRole(['company_admin'])]

  /**
   * GET /api/v1/users
   * Kendi şirketindeki kullanıcıları listeler (role/active filtreli).
   */
  fastify.get(
    '/',
    { schema: listUsersSchema, onRequest: adminOnly },
    async (request) => {
      const { role, active } = request.query
      const params = [request.user.companyId]
      let sql = `SELECT ${USER_COLUMNS} FROM users WHERE company_id = $1`

      if (role !== undefined) {
        params.push(role)
        sql += ` AND role = $${params.length}`
      }
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
   * POST /api/v1/users
   * Kendi şirketine kullanıcı (driver / company_admin) ekler.
   */
  fastify.post(
    '/',
    { schema: createUserSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { email, password, fullName, phone, role } = request.body
      const passwordHash = await hashPassword(password)

      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO users (company_id, email, password_hash, role, full_name, phone)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${USER_COLUMNS}`,
          [request.user.companyId, email, passwordHash, role, fullName, phone ?? null],
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

  /**
   * PATCH /api/v1/users/:id
   * Kendi şirketindeki kullanıcıyı günceller (isActive: false = soft delete).
   */
  fastify.patch(
    '/:id',
    { schema: updateUserSchema, onRequest: adminOnly },
    async (request, reply) => {
      const { fullName, phone, password, isActive } = request.body

      const { sets, params } = buildUpdate({
        full_name: fullName,
        phone,
        password_hash: password !== undefined ? await hashPassword(password) : undefined,
        is_active: isActive,
      })

      params.push(request.params.id, request.user.companyId)
      const { rows } = await fastify.db.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.length - 1} AND company_id = $${params.length}
         RETURNING ${USER_COLUMNS}`,
        params,
      )

      if (!rows[0]) return reply.notFound('Kullanıcı bulunamadı')
      return rows[0]
    },
  )
}
