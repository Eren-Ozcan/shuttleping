import { loginSchema, refreshSchema, logoutSchema } from './schema.js'
import * as authService from '../../../services/auth.service.js'
import { env } from '../../../config/env.js'

const REFRESH_COOKIE = 'refreshToken'
// Ömür env'den gelir (JWT_REFRESH_EXPIRES); eskiden burada sabitti
const REFRESH_EXPIRES_MS = env.JWT_REFRESH_EXPIRES_MS

const OVERDUE_MESSAGE =
  'Şirketinizin ödemesi gecikmiş, lütfen yöneticinizle iletişime geçin'

/**
 * Kademeli faturalama kapısı (Faz C).
 *
 * overdue   — yalnızca company_admin bloklanır. Sürücü girişi açık kalır ki
 *             servis işlemeye devam etsin: yolcu ödeme ilişkisinin tarafı
 *             değil, baskı hesabı yöneten kişiye binmeli.
 * suspended — tüm roller bloklanır.
 *
 * @returns {{reply:string, message:string}|null} null = erişim serbest
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
   * Kullanıcı adı/şifre ile giriş; access token + refresh cookie döner.
   */
  fastify.post(
    '/login',
    {
      schema: loginSchema,
      // Kaba kuvvet ve bcrypt(12) üzerinden CPU tüketimi koruması (D1)
      config: { rateLimit: { max: env.RATE_LIMIT_LOGIN_MAX, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password } = request.body

      const user = await authService.findUserByEmail(email)
      // Kullanıcı yoksa da bcrypt maliyeti ödenir — aksi halde yanıt süresi
      // e-postanın kayıtlı olup olmadığını sızdırır (D8)
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

    // Yeniden kullanım tespiti (D9): iptal edilmiş bir token tekrar sunulduysa
    // kopyalanmış demektir. Tüm aile iptal edilir — hem hırsızın hem meşru
    // kullanıcının oturumu düşer, kullanıcı yeniden giriş yapmak zorunda kalır.
    if (record.revoked_at) {
      await authService.revokeTokenFamily(record.family_id)
      request.log.warn(
        { userId: record.user_id, familyId: record.family_id },
        'İptal edilmiş refresh token yeniden kullanıldı — aile iptal edildi',
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

    // Rotasyon: yenisi aynı ailede açılır, eskisi silinmeyip iptal edilir —
    // satır kalmazsa yeniden kullanım tespit edilemez
    const created = await authService.createRefreshToken(
      record.user_id,
      newHash,
      expiresAt,
      record.family_id,
    )
    await authService.rotateRefreshToken(record.id, created.id)

    // Kullanıcı bilgisi de döner: panel access token'ı bellekte tuttuğu için
    // sayfa yenilendiğinde oturumu bununla yeniden kurar (D6)
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
   * Refresh token'ı iptal eder ve cookie'yi temizler.
   *
   * Access token gerektirmez (D10): 15 dakikalık access token süresi dolmuş
   * bir oturumda kullanıcı kendi refresh token'ını iptal edemiyordu. Yetki
   * zaten HttpOnly cookie'nin kendisi — sahip olan iptal edebilir.
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
