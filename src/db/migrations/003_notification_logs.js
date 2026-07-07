/**
 * Faz 3/4 — bildirim denetim kaydı.
 * Append-only log: her gönderim denemesi (başarılı/başarısız) bir satır.
 * Faz 7 monitoring/raporlama bu tablodan beslenecek.
 */

export const up = (pgm) => {
  pgm.createTable('notification_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    company_id: {
      type: 'uuid',
      notNull: true,
      references: 'companies',
      onDelete: 'RESTRICT',
    },
    passenger_id: {
      type: 'uuid',
      notNull: true,
      references: 'passengers',
      onDelete: 'RESTRICT',
    },
    route_id: { type: 'uuid', references: 'routes', onDelete: 'SET NULL' },
    stop_id: { type: 'uuid', references: 'stops', onDelete: 'SET NULL' },
    channel: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      check: "status IN ('sent', 'failed')",
    },
    error: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('notification_logs', 'company_id')
  pgm.createIndex('notification_logs', ['passenger_id', 'created_at'])
}

export const down = (pgm) => {
  pgm.dropTable('notification_logs')
}
