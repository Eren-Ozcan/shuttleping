/**
 * Faz F3 — prova (dry-run) modu.
 *
 * Bugüne kadar bildirim akışını test etmek, gerçek yolcuya gerçek SMS/Telegram
 * göndermek demekti (PILOT-READINESS R-2). Artık:
 *   - global `NOTIFICATION_DRY_RUN` env bayrağı, ve
 *   - şirket bazında `companies.dry_run`
 * Biri açıksa gönderim yapılmaz; kayıt notification_logs'a 'dry_run'
 * durumuyla düşer, böylece denetim kaydında canlı gönderimden ayrılır.
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
