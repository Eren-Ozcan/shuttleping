/**
 * Şirket erişim/faturalama durumu (Faz C).
 *
 * Kademeli askıya alma:
 *   active    — kısıt yok
 *   overdue   — company_admin girişi kapalı, harici ETA sağlayıcısı
 *               kullanılmaz (haversine'e düşülür). Sürücü ve bildirimler
 *               çalışır: yolcu ödeme ilişkisinin tarafı değil.
 *   suspended — tüm girişler kapalı, konum ingest reddedilir, bildirim gitmez.
 *
 * Durum ETA ve bildirim worker'larının sıcak yolunda okunduğu için Redis'te
 * kısa süreli cache'lenir; ödeme durumu değişince cache açıkça temizlenir.
 */
import { pool } from '../db/pool.js'

const CACHE_TTL_SECONDS = 60
const cacheKey = (companyId) => `company:access:${companyId}`

/** Harici ETA sağlayıcısı (Google) yalnızca ödeme güncelken kullanılır. */
export const canUseEtaProvider = (status) => status?.paymentStatus === 'active'

/** Bildirim gönderimi yalnızca askıya alınmış şirketlerde durur. */
export const canNotify = (status) =>
  Boolean(status?.isActive) && status?.paymentStatus !== 'suspended'

/** Konum kabulü de askıya alınmış şirketlerde durur. */
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
 * Şirketin erişim durumunu döner (Redis cache'li).
 * Redis verilmezse ya da okunamazsa doğrudan DB'ye gidilir — faturalama
 * kapısı cache arızasında sessizce açılmamalı.
 * @returns {Promise<{paymentStatus:string,isActive:boolean,maxPassengers:number|null}|null>}
 */
export async function getCompanyAccess(companyId, redis) {
  if (!companyId) return null

  if (redis) {
    try {
      const cached = await redis.get(cacheKey(companyId))
      if (cached) return JSON.parse(cached)
    } catch {
      // cache okunamadı — DB'ye düş
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

/** Ödeme durumu / kota değişince cache'i düşür. */
export async function invalidateCompanyAccess(companyId, redis) {
  if (!redis || !companyId) return
  await redis.del(cacheKey(companyId)).catch(() => {})
}

/**
 * Aktif yolcu kotasını kontrol eder.
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
 * Vadesi geçmiş aktif şirketleri 'overdue' işaretler.
 * next_due_date bugüne kadar yazılıyor ama hiçbir kod yolu okumuyordu.
 * @returns {Promise<Array<{id:string,name:string}>>} durumu değişen şirketler
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
