/**
 * Faz 7 — sefer geçmişi.
 * Her konum ping'i append-only olarak saklanır; geçmiş sefer izleme ve
 * raporlama bu tablodan beslenir. Yüksek hacim beklenen tablo — sorgular
 * her zaman (route_id, recorded_at) aralığıyla gelmeli.
 */

export const up = (pgm) => {
  pgm.createTable('location_history', {
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
    route_id: {
      type: 'uuid',
      notNull: true,
      references: 'routes',
      onDelete: 'RESTRICT',
    },
    driver_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    lat: { type: 'double precision', notNull: true },
    lng: { type: 'double precision', notNull: true },
    speed: { type: 'double precision' },
    heading: { type: 'double precision' },
    recorded_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('location_history', ['route_id', 'recorded_at'])
  pgm.createIndex('location_history', 'company_id')
}

export const down = (pgm) => {
  pgm.dropTable('location_history')
}
