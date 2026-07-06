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
   * Sadece JWT doğrulama. Route'larda onRequest: [fastify.authenticate] ile kullan.
   */
  fastify.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify()
    } catch {
      throw fastify.httpErrors.unauthorized('Geçersiz veya süresi dolmuş token')
    }
  })

  /**
   * JWT doğrulama + rol kontrolü.
   * Kullanım: onRequest: [fastify.requireRole(['super_admin', 'company_admin'])]
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
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] })
