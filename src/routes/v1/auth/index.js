import { loginSchema, refreshSchema, logoutSchema } from './schema.js'
import * as authService from '../../../services/auth.service.js'
import { env } from '../../../config/env.js'

const REFRESH_COOKIE = 'refreshToken'
// Lifetime comes from env (JWT_REFRESH_EXPIRES); used to be hard-coded here
const REFRESH_EXPIRES_MS = env.JWT_REFRESH_EXPIRES_MS

const OVERDUE_MESSAGE =
  'Şirketinizin ödemesi gecikmiş, lütfen yöneticinizle iletişime geçin'

/**
 * Graduated billing gate (Phase C).
 *
 * overdue   — only company_admin is blocked. Driver login stays open so the
 *             service keeps running: the passenger is not a party to the
 *             payment, the pressure should be on whoever manages the account.
 * suspended — all roles blocked.
 *
 * @returns {{reply:string, message:string}|null} null = access allowed
 */
function paymentGate(company, role) {
  if (!company?.is_active) {
    return { reply: 'forbidden', message: 'Şirket hesabı devre dışı' }
  }
  if (company.payment_status === 'suspended') {
    return { reply: 'paymentRequired', message: 'Şirket hesabı askıya alındı' }
  }
  if (company.payment_status === 'overdue' && role === 'company_admin') {
    return { reply: 'paymentRequired', message: OVERDUE_MESSAGE }
  }
  return null
}

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
   * Login with email/password; returns an access token + refresh cookie.
   */
  fastify.post(
    '/login',
    {
      schema: loginSchema,
      // Brute-force and bcrypt(12) CPU-exhaustion protection (D1)
      config: { rateLimit: { max: env.RATE_LIMIT_LOGIN_MAX, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password } = request.body

      const user = await authService.findUserByEmail(email)
      // The bcrypt cost is paid even when the user does not exist — otherwise
      // the response time leaks whether the email is registered (D8)
      const passwordOk = await authService.verifyPassword(
        password,
        user?.password_hash ?? authService.DUMMY_PASSWORD_HASH,
      )
      if (!user || !passwordOk) {
        return reply.unauthorized('E-posta veya şifre hatalı')
      }

      if (user.role !== 'super_admin') {
        const company = await authService.findCompanyAccess(user.company_id)
        const denied = paymentGate(company, user.role)
        if (denied) return reply[denied.reply](denied.message)
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
    },
  )

  /**
   * POST /api/v1/auth/refresh
   * Produces a new access token from the refresh cookie (token rotation).
   */
  fastify.post('/refresh', { schema: refreshSchema }, async (request, reply) => {
    const rawToken = request.cookies?.[REFRESH_COOKIE]
    if (!rawToken) return reply.unauthorized('Refresh token eksik')

    const tokenHash = authService.hashToken(rawToken)
    const record = await authService.findRefreshToken(tokenHash)
    if (!record || !record.user_active) {
      return reply.unauthorized('Geçersiz veya süresi dolmuş refresh token')
    }

    // Reuse detection (D9): if a revoked token is presented again it has been
    // copied. The whole family is revoked — both the thief's and the
    // legitimate user's sessions drop, forcing the user to log in again.
    if (record.revoked_at) {
      await authService.revokeTokenFamily(record.family_id)
      request.log.warn(
        { userId: record.user_id, familyId: record.family_id },
        'Revoked refresh token reused — family revoked',
      )
      return reply.unauthorized('Oturum güvenlik nedeniyle sonlandırıldı, tekrar giriş yapın')
    }

    if (record.role !== 'super_admin') {
      const denied = paymentGate(
        { is_active: record.company_active, payment_status: record.company_payment_status },
        record.role,
      )
      if (denied) return reply[denied.reply](denied.message)
    }

    const payload = { sub: record.user_id, role: record.role, companyId: record.company_id }
    const accessToken = fastify.jwt.sign(payload)

    const rawNew = authService.generateToken()
    const newHash = authService.hashToken(rawNew)
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS)

    // Rotation: the new one is opened in the same family, the old one is
    // revoked not deleted — without the row, reuse cannot be detected
    const created = await authService.createRefreshToken(
      record.user_id,
      newHash,
      expiresAt,
      record.family_id,
    )
    await authService.rotateRefreshToken(record.id, created.id)

    // User info is returned too: the panel keeps the access token in memory,
    // so on a page reload it re-establishes the session from this (D6)
    return reply
      .setCookie(REFRESH_COOKIE, rawNew, refreshCookieOpts(expiresAt))
      .send({
        accessToken,
        user: {
          id: record.user_id,
          email: record.email,
          role: record.role,
          fullName: record.full_name,
          companyId: record.company_id,
        },
      })
  })

  /**
   * POST /api/v1/auth/logout
   * Revokes the refresh token and clears the cookie.
   *
   * Does not require an access token (D10): with a 15-minute access token
   * expired, a user could not revoke their own refresh token. The authority is
   * the HttpOnly cookie itself — whoever holds it can revoke it.
   */
  fastify.post('/logout', { schema: logoutSchema }, async (request, reply) => {
    const rawToken = request.cookies?.[REFRESH_COOKIE]
    if (rawToken) {
      await authService.deleteRefreshToken(authService.hashToken(rawToken))
    }
    return reply
      .clearCookie(REFRESH_COOKIE, refreshCookieOpts(new Date(0)))
      .send({ success: true })
  })
}
