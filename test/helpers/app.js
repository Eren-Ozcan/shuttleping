import { buildApp } from '../../src/app.js'

let _app

/**
 * A single Fastify instance is reused for the whole test run.
 * DB/Redis connections are shared — every test file must call afterAll(closeTestApp).
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
 * Resets the rate-limit counters. The counters live in Redis, so test files and
 * consecutive runs consume each other's quota; apart from the tests that check
 * limit behavior, every test needs to start fresh.
 */
export async function clearRateLimits(key) {
  const app = await getTestApp()
  // The global limit's key is `rl:<key>`, route-level ones are
  // `rl:<METHOD><url>-<key>` — so the pattern must catch both shapes.
  // If key is given, only that bucket is cleared: test files run in parallel,
  // so a global clear would reset each other's counter and break the limit test.
  const keys = await app.redis.keys(key ? `rl:*${key}` : 'rl:*')
  if (keys.length) await app.redis.del(...keys)
}

const SUPER_ADMIN_EMAIL = 'test-helper-super@shuttleping.local'
let _superAdminId = null

/**
 * Provides a persistent super_admin row for tests.
 * Audit fields (e.g. company_payments.recorded_by) are FK-bound to a real user,
 * so a token signed with a made-up sub would produce a 500.
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
 * Produces an Authorization header with an access token signed for the given role.
 * For roles other than super_admin it writes no user to the DB — enough for
 * auth/role/validation-level tests.
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
