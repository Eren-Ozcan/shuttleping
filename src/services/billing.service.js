/**
 * Company access / billing status (Phase C).
 *
 * Graduated suspension:
 *   active    — no restriction
 *   overdue   — company_admin login is closed, the external ETA provider is
 *               not used (falls back to haversine). Driver and notifications
 *               keep working: the passenger is not a party to the payment relationship.
 *   suspended — all logins closed, location ingest rejected, no notifications sent.
 *
 * The status is read on the hot path of the ETA and notification workers, so
 * it is cached briefly in Redis; the cache is explicitly cleared when the
 * payment status changes.
 */
import { pool } from '../db/pool.js'

const CACHE_TTL_SECONDS = 60
const cacheKey = (companyId) => `company:access:${companyId}`

/** The external ETA provider (Google) is only used while payment is current. */
export const canUseEtaProvider = (status) => status?.paymentStatus === 'active'

/** Notification sending only stops for suspended companies. */
export const canNotify = (status) =>
  Boolean(status?.isActive) && status?.paymentStatus !== 'suspended'

/** Location ingest also stops for suspended companies. */
export const canIngestLocation = canNotify

async function loadCompanyAccess(companyId) {
  const { rows } = await pool.query(
    `SELECT payment_status, is_active, max_passengers, dry_run
     FROM companies WHERE id = $1`,
    [companyId],
  )
  if (!rows[0]) return null
  return {
    paymentStatus: rows[0].payment_status,
    isActive: rows[0].is_active,
    maxPassengers: rows[0].max_passengers,
    dryRun: rows[0].dry_run,
  }
}

/**
 * Returns the company's access status (Redis-cached).
 * If Redis is not provided or cannot be read, it goes straight to the DB — the
 * billing gate must not silently open on a cache failure.
 * @returns {Promise<{paymentStatus:string,isActive:boolean,maxPassengers:number|null,dryRun:boolean}|null>}
 */
export async function getCompanyAccess(companyId, redis) {
  if (!companyId) return null

  if (redis) {
    try {
      const cached = await redis.get(cacheKey(companyId))
      if (cached) return JSON.parse(cached)
    } catch {
      // cache unreadable — fall through to the DB
    }
  }

  const status = await loadCompanyAccess(companyId)
  if (status && redis) {
    await redis
      .set(cacheKey(companyId), JSON.stringify(status), 'EX', CACHE_TTL_SECONDS)
      .catch(() => {})
  }
  return status
}

/** Drop the cache when payment status / quota changes. */
export async function invalidateCompanyAccess(companyId, redis) {
  if (!redis || !companyId) return
  await redis.del(cacheKey(companyId)).catch(() => {})
}

/**
 * Checks the active passenger quota.
 * @returns {Promise<{allowed:boolean, used:number, max:number|null}>}
 */
export async function checkPassengerQuota(companyId, redis) {
  const status = await getCompanyAccess(companyId, redis)
  const max = status?.maxPassengers ?? null
  if (max == null) return { allowed: true, used: 0, max: null }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS used FROM passengers
     WHERE company_id = $1 AND is_active = true`,
    [companyId],
  )
  const used = rows[0].used
  return { allowed: used < max, used, max }
}

/**
 * Marks active companies past their due date as 'overdue'.
 * next_due_date was being written but no code path read it.
 * @returns {Promise<Array<{id:string,name:string}>>} companies whose status changed
 */
export async function markOverdueCompanies(redis) {
  const { rows } = await pool.query(
    `UPDATE companies SET payment_status = 'overdue', updated_at = now()
     WHERE payment_status = 'active'
       AND next_due_date IS NOT NULL
       AND next_due_date < now()
     RETURNING id, name`,
  )
  for (const company of rows) await invalidateCompanyAccess(company.id, redis)
  return rows
}
