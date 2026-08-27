/**
 * Periyodik bakım işleri. Ayrı kuyruk gerektirmeyecek kadar hafif;
 * server process'i içinde setInterval ile döner. Çok instance çalışsa bile
 * işlemler idempotent (koşullu UPDATE) — çift çalışması zararsız.
 */
import { env } from '../config/env.js'
import { locationKey, etaKey, etaCalcKey } from '../services/eta/index.js'
import { markOverdueCompanies } from '../services/billing.service.js'
import { purgeExpiredRefreshTokens } from '../services/auth.service.js'
import { logger } from '../utils/logger.js'

const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const BILLING_SWEEP_INTERVAL_MS = 60 * 60 * 1000
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
// Silme parça boyutu — büyük tabloyu tek işlemde kilitlememek için
const RETENTION_BATCH_SIZE = 5_000

/**
 * Belirtilen süredir ping gelmeyen aktif seferleri 'abandoned' işaretler ve
 * güzergahın canlı Redis anahtarlarını temizler (sürücü "Seferi Bitir"e
 * basmadan çekildiğinde sonsuz konum kaydı / bildirim döngüsünü keser).
 */
export async function sweepAbandonedTrips({ db, redis }) {
  const { rows } = await db.query(
    `UPDATE trips SET status = 'abandoned', ended_at = now()
     WHERE status = 'active'
       AND last_ping_at < now() - ($1 || ' minutes')::interval
     RETURNING company_id, route_id`,
    [String(env.TRIP_ABANDON_AFTER_MINUTES)],
  )

  for (const { company_id: companyId, route_id: routeId } of rows) {
    await redis
      .del(
        locationKey(companyId, routeId),
        etaKey(companyId, routeId),
        etaCalcKey(routeId),
      )
      .catch((err) => logger.warn({ err, routeId }, 'Abandoned sefer anahtarı silinemedi'))
  }

  if (rows.length) {
    logger.info({ count: rows.length }, 'Terkedilmiş seferler kapatıldı')
  }
  return rows.length
}

/**
 * Vadesi geçmiş şirketleri 'overdue' işaretler (C3). next_due_date bugüne
 * kadar yazılıyor ama hiçbir kod yolu okumuyordu — vadesi geçen şirket bir
 * insan butona basana kadar 'active' kalıyordu.
 */
export async function sweepOverdueCompanies({ redis }) {
  const companies = await markOverdueCompanies(redis)
  for (const company of companies) {
    logger.warn(
      { companyId: company.id, name: company.name },
      'Şirket vadesi geçti — overdue işaretlendi',
    )
  }
  return companies.length
}

/**
 * Saklama süresi dolmuş kayıtları siler (E7).
 *
 * `location_history` her ping'de bir satır alıyor ve bugüne kadar hiç
 * temizlenmiyordu: 50 sürücüde ~144k satır/gün, yılda ~52M. Konum ve bildirim
 * kayıtları aynı zamanda kişisel veri — süresiz saklamanın KVKK karşılığı yok.
 *
 * Silme, tabloyu uzun süre kilitlememek için parçalar hâlinde yapılır.
 */
export async function sweepRetention({ db }) {
  const deleted = { locations: 0, notifications: 0 }

  const purge = async (table, column, days) => {
    if (!days) return 0
    let total = 0
    for (;;) {
      const { rowCount } = await db.query(
        `DELETE FROM ${table}
         WHERE ctid IN (
           SELECT ctid FROM ${table}
           WHERE ${column} < now() - ($1 || ' days')::interval
           LIMIT ${RETENTION_BATCH_SIZE}
         )`,
        [String(days)],
      )
      total += rowCount
      if (rowCount < RETENTION_BATCH_SIZE) break
    }
    return total
  }

  deleted.locations = await purge(
    'location_history',
    'recorded_at',
    env.LOCATION_HISTORY_RETENTION_DAYS,
  )
  deleted.notifications = await purge(
    'notification_logs',
    'created_at',
    env.NOTIFICATION_LOG_RETENTION_DAYS,
  )

  // refresh_tokens de sınırsız büyüyordu: rotasyon artık satırı silmiyor,
  // iptal ediyor (D9), dolayısıyla temizlik daha da gerekli
  deleted.refreshTokens = await purgeExpiredRefreshTokens()

  if (deleted.locations || deleted.notifications || deleted.refreshTokens) {
    logger.info(deleted, 'Saklama süresi dolan kayıtlar silindi')
  }
  return deleted
}

export function startMaintenance({ db, redis }) {
  const run = (name, fn) => () =>
    fn().catch((err) => logger.error({ err, sweep: name }, 'Bakım süpürmesi başarısız'))

  const trips = run('trips', () => sweepAbandonedTrips({ db, redis }))
  const billing = run('billing', () => sweepOverdueCompanies({ redis }))
  const retention = run('retention', () => sweepRetention({ db }))

  trips()
  billing()
  retention()

  const timers = [
    setInterval(trips, SWEEP_INTERVAL_MS),
    setInterval(billing, BILLING_SWEEP_INTERVAL_MS),
    setInterval(retention, RETENTION_SWEEP_INTERVAL_MS),
  ]
  for (const timer of timers) timer.unref?.()
  return timers
}
