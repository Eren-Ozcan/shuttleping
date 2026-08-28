/**
 * Periodic maintenance jobs. Light enough not to need a separate queue;
 * they run on setInterval inside the server process. Even with multiple
 * instances running, the operations are idempotent (conditional UPDATE) — a
 * double run is harmless.
 */
import { env } from '../config/env.js'
import { locationKey, etaKey, etaCalcKey } from '../services/eta/index.js'
import { markOverdueCompanies } from '../services/billing.service.js'
import { purgeExpiredRefreshTokens } from '../services/auth.service.js'
import { logger } from '../utils/logger.js'

const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const BILLING_SWEEP_INTERVAL_MS = 60 * 60 * 1000
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
// Delete chunk size — so a large table is not locked in a single statement
const RETENTION_BATCH_SIZE = 5_000

/**
 * Marks active trips with no ping for the configured window as 'abandoned' and
 * clears the route's live Redis keys (breaks the infinite location-record /
 * notification loop when a driver leaves without pressing "End Trip").
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
      .catch((err) => logger.warn({ err, routeId }, 'Failed to clear abandoned trip key'))
  }

  if (rows.length) {
    logger.info({ count: rows.length }, 'Abandoned trips closed')
  }
  return rows.length
}

/**
 * Marks companies past their due date as 'overdue' (C3). next_due_date was
 * being written but no code path read it — an overdue company stayed 'active'
 * until a human pressed a button.
 */
export async function sweepOverdueCompanies({ redis }) {
  const companies = await markOverdueCompanies(redis)
  for (const company of companies) {
    logger.warn(
      { companyId: company.id, name: company.name },
      'Company past due — marked overdue',
    )
  }
  return companies.length
}

/**
 * Deletes records past their retention window (E7).
 *
 * `location_history` gets a row per ping and was never cleaned: ~144k rows/day
 * for 50 drivers, ~52M/year. Location and notification records are also
 * personal data — there is no KVKK basis for keeping them forever.
 *
 * Deletion is done in chunks so the table is not locked for long.
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

  // refresh_tokens was also growing without bound: rotation no longer deletes
  // the row, it revokes it (D9), so cleanup is even more necessary
  deleted.refreshTokens = await purgeExpiredRefreshTokens()

  if (deleted.locations || deleted.notifications || deleted.refreshTokens) {
    logger.info(deleted, 'Records past retention window deleted')
  }
  return deleted
}

export function startMaintenance({ db, redis }) {
  const run = (name, fn) => () =>
    fn().catch((err) => logger.error({ err, sweep: name }, 'Maintenance sweep failed'))

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
