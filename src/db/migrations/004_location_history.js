/**
 * Phase 7 — trip history.
 * Every location ping is stored append-only; past-trip tracking and reporting
 * are fed from this table. A high-volume table is expected — queries must
 * always come with a (route_id, recorded_at) range.
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
