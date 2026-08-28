/**
 * Phase F3 — dry-run mode.
 *
 * Until now, testing the notification flow meant sending real SMS/Telegram to a
 * real passenger (PILOT-READINESS R-2). Now:
 *   - the global `NOTIFICATION_DRY_RUN` env flag, and
 *   - the per-company `companies.dry_run`
 * If either is on, nothing is sent; the record lands in notification_logs with
 * status 'dry_run', so it is separated from a live send in the audit log.
 */

export const up = (pgm) => {
  pgm.addColumns('companies', {
    dry_run: { type: 'boolean', notNull: true, default: false },
  })

  pgm.dropConstraint('notification_logs', 'notification_logs_status_check')
  pgm.addConstraint('notification_logs', 'notification_logs_status_check', {
    check: "status IN ('sent', 'failed', 'dry_run')",
  })
}

export const down = (pgm) => {
  pgm.sql(`DELETE FROM notification_logs WHERE status = 'dry_run'`)
  pgm.dropConstraint('notification_logs', 'notification_logs_status_check')
  pgm.addConstraint('notification_logs', 'notification_logs_status_check', {
    check: "status IN ('sent', 'failed')",
  })

  pgm.dropColumns('companies', ['dry_run'])
}
