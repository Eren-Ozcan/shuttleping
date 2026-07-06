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
 * Verilen rolle imzalı access token içeren Authorization header'ı üretir.
 * DB'ye kullanıcı yazmaz — auth/rol/validation seviyesi testler için yeterli.
 */
export async function authHeader(role = 'company_admin', companyId = '00000000-0000-4000-8000-000000000001') {
  const app = await getTestApp()
  const token = app.jwt.sign({
    sub: '00000000-0000-4000-8000-000000000099',
    role,
    companyId: role === 'super_admin' ? null : companyId,
  })
  return { authorization: `Bearer ${token}` }
}
