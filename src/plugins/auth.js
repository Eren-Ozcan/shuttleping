import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import { env } from '../config/env.js'

async function authPlugin(fastify) {
  await fastify.register(fastifyCookie)

  await fastify.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES },
  })

  /**
   * JWT verification only. Use in routes with onRequest: [fastify.authenticate].
   */
  fastify.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify()
    } catch {
      throw fastify.httpErrors.unauthorized('Geçersiz veya süresi dolmuş token')
    }
  })

  /**
   * JWT verification + role check.
   * Usage: onRequest: [fastify.requireRole(['super_admin', 'company_admin'])]
   */
  fastify.decorate('requireRole', (roles) => {
    return async (request) => {
      try {
        await request.jwtVerify()
      } catch {
        throw fastify.httpErrors.unauthorized('Geçersiz veya süresi dolmuş token')
      }
      if (!roles.includes(request.user.role)) {
        throw fastify.httpErrors.forbidden('Bu işlem için yetkiniz yok')
      }
    }
  })

  /**
   * Read-only support access to tenant resources (E12).
   *
   * Until now super_admin could not read any tenant record: it could create a
   * company and an admin but could not see a single route, trip or
   * notification log — diagnosing a customer issue from the product was impossible.
   *
   * A super_admin JWT has no companyId; it specifies which tenant it is
   * inspecting via `?companyId=`, and that value is written into
   * request.user.companyId so every query below works unchanged. Only used on
   * GET endpoints — write paths stay closed to non company_admin callers.
   */
  fastify.decorate('allowSupportRead', (roles) => {
    const check = fastify.requireRole([...roles, 'super_admin'])
    return async (request) => {
      await check(request)
      if (request.user.role !== 'super_admin') return

      const companyId = request.query?.companyId
      if (!companyId) {
        throw fastify.httpErrors.badRequest(
          'super_admin için companyId query parametresi zorunlu',
        )
      }
      request.user = { ...request.user, companyId }
    }
  })
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] })
