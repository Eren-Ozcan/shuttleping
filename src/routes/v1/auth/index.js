import { loginSchema, refreshSchema, logoutSchema } from './schema.js'
import * as authService from '../../../services/auth.service.js'
import { env } from '../../../config/env.js'

const REFRESH_COOKIE = 'refreshToken'
const REFRESH_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000 // 7 gün

function refreshCookieOpts(expires) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/v1/auth',
    expires,
  }
}

export default async function authRoutes(fastify) {
  /**
   * POST /api/v1/auth/login
   * Kullanıcı adı/şifre ile giriş; access token + refresh cookie döner.
   */
  fastify.post('/login', { schema: loginSchema }, async (request, reply) => {
    const { email, password } = request.body

    const user = await authService.findUserByEmail(email)
    if (!user || !(await authService.verifyPassword(password, user.password_hash))) {
      return reply.unauthorized('E-posta veya şifre hatalı')
    }

    if (user.role !== 'super_admin') {
      const companyPaymentStatus = await authService.findCompanyPaymentStatus(user.company_id)
      if (companyPaymentStatus === 'overdue') {
        return reply.paymentRequired('Şirketinizin ödemesi gecikmiş, lütfen yöneticinizle iletişime geçin')
      }
    }

    const payload = { sub: user.id, role: user.role, companyId: user.company_id }
    const accessToken = fastify.jwt.sign(payload)

    const rawRefreshToken = authService.generateToken()
    const tokenHash = authService.hashToken(rawRefreshToken)
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS)

    await authService.createRefreshToken(user.id, tokenHash, expiresAt)

    return reply
      .setCookie(REFRESH_COOKIE, rawRefreshToken, refreshCookieOpts(expiresAt))
      .send({
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          fullName: user.full_name,
          companyId: user.company_id,
        },
      })
  })

  /**
   * POST /api/v1/auth/refresh
   * Refresh cookie'den yeni access token üretir (token rotation).
   */
  fastify.post('/refresh', { schema: refreshSchema }, async (request, reply) => {
    const rawToken = request.cookies?.[REFRESH_COOKIE]
    if (!rawToken) return reply.unauthorized('Refresh token eksik')

    const tokenHash = authService.hashToken(rawToken)
    const record = await authService.findRefreshToken(tokenHash)
    if (!record || !record.user_active) {
      return reply.unauthorized('Geçersiz veya süresi dolmuş refresh token')
    }

    if (record.role !== 'super_admin' && record.company_payment_status === 'overdue') {
      return reply.paymentRequired('Şirketinizin ödemesi gecikmiş, lütfen yöneticinizle iletişime geçin')
    }

    // Token rotation: eskiyi sil, yenisini yaz
    await authService.deleteRefreshToken(tokenHash)

    const payload = { sub: record.user_id, role: record.role, companyId: record.company_id }
    const accessToken = fastify.jwt.sign(payload)

    const rawNew = authService.generateToken()
    const newHash = authService.hashToken(rawNew)
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS)

    await authService.createRefreshToken(record.user_id, newHash, expiresAt)

    return reply
      .setCookie(REFRESH_COOKIE, rawNew, refreshCookieOpts(expiresAt))
      .send({ accessToken })
  })

  /**
   * POST /api/v1/auth/logout
   * Refresh token'ı iptal eder ve cookie'yi temizler.
   */
  fastify.post(
    '/logout',
    { schema: logoutSchema, onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const rawToken = request.cookies?.[REFRESH_COOKIE]
      if (rawToken) {
        await authService.deleteRefreshToken(authService.hashToken(rawToken))
      }
      return reply
        .clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' })
        .send({ success: true })
    },
  )
}
