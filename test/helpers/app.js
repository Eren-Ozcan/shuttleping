import { buildApp } from '../../src/app.js'

let _app

/**
 * Test süresince tek bir Fastify instance yeniden kullanılır.
 * DB/Redis bağlantıları paylaşılır — her test dosyası afterAll(closeTestApp) çağırmalı.
 */
export async function getTestApp() {
  if (!_app) {
    _app = await buildApp({ logger: false })
    await _app.ready()
  }
  return _app
}

export async function closeTestApp() {
  if (_app) {
    await _app.close()
    _app = null
  }
}

/**
 * Rate limit sayaçlarını sıfırlar. Sayaçlar Redis'te yaşadığı için test
 * dosyaları ve ardışık koşular birbirinin kotasını tüketir; limit davranışını
 * sınayan testler dışında her testin taze başlaması gerekir.
 */
export async function clearRateLimits(key) {
  const app = await getTestApp()
  // Global limitin anahtarı `rl:<key>`, route seviyesindekilerin
  // `rl:<METHOD><url>-<key>` — bu yüzden desen her iki biçimi de yakalamalı.
  // key verilirse yalnızca o kova temizlenir: test dosyaları paralel koştuğu
  // için global temizlik birbirinin sayacını sıfırlayıp limit testini bozar.
  const keys = await app.redis.keys(key ? `rl:*${key}` : 'rl:*')
  if (keys.length) await app.redis.del(...keys)
}

const SUPER_ADMIN_EMAIL = 'test-helper-super@shuttleping.local'
let _superAdminId = null

/**
 * Test için kalıcı bir super_admin satırı sağlar.
 * Denetim alanları (ör. company_payments.recorded_by) gerçek bir kullanıcıya
 * FK ile bağlı olduğundan, uydurma bir sub ile imzalanan token 500 ürettirir.
 */
export async function getSuperAdminId() {
  if (_superAdminId) return _superAdminId
  const app = await getTestApp()
  const { rows } = await app.db.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name)
     VALUES (NULL, $1, 'x', 'super_admin', 'Test Helper Super')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [SUPER_ADMIN_EMAIL],
  )
  _superAdminId = rows[0].id
  return _superAdminId
}

/**
 * Verilen rolle imzalı access token içeren Authorization header'ı üretir.
 * super_admin dışındaki roller için DB'ye kullanıcı yazmaz — auth/rol/validation
 * seviyesi testler için yeterli.
 */
export async function authHeader(role = 'company_admin', companyId = '00000000-0000-4000-8000-000000000001') {
  const app = await getTestApp()
  const sub =
    role === 'super_admin'
      ? await getSuperAdminId()
      : '00000000-0000-4000-8000-000000000099'
  const token = app.jwt.sign({
    sub,
    role,
    companyId: role === 'super_admin' ? null : companyId,
  })
  return { authorization: `Bearer ${token}` }
}
