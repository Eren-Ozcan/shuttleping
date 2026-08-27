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

  /**
   * Kiracı kaynaklarına salt-okunur destek erişimi (E12).
   *
   * super_admin bugüne kadar hiçbir kiracı kaydını okuyamıyordu: şirket ve
   * yönetici açabiliyor ama tek bir güzergahı, seferi ya da bildirim kaydını
   * göremiyordu — müşteri sorununu üründen teşhis etmek imkânsızdı.
   *
   * super_admin'in JWT'sinde companyId yoktur; hangi kiracıyı incelediğini
   * `?companyId=` ile belirtir ve bu değer request.user.companyId'ye yazılır,
   * böylece aşağıdaki tüm sorgular değişmeden çalışır. Yalnızca GET
   * uçlarında kullanılır — yazma yolları company_admin'e kapalı kalır.
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
