/**
 * Phase 1 domain model:
 *   vehicles   — a company's shuttle vehicles
 *   routes     — routes (driver + vehicle assignment)
 *   stops      — route stops (sequence-ordered, lat/lng)
 *   passengers — passengers attached to a stop + notification channel preference
 *
 * Rules:
 *   - Every table carries company_id (denormalized for multi-tenant isolation queries)
 *   - No physical delete: is_active = false
 *   - notification_channel is bounded by a CHECK so 'push' can be added later
 */

export const up = (pgm) => {
  // ── vehicles ───────────────────────────────────────────────────────────────
  pgm.createTable('vehicles', {
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
    plate: { type: 'text', notNull: true },
    name: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('vehicles', 'company_id')
  pgm.addConstraint('vehicles', 'vehicles_company_plate_unique', {
    unique: ['company_id', 'plate'],
  })

  // ── routes ─────────────────────────────────────────────────────────────────
  pgm.createTable('routes', {
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
    name: { type: 'text', notNull: true },
    // Assignments are optional: the route is defined first, driver/vehicle attached later
    driver_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    vehicle_id: { type: 'uuid', references: 'vehicles', onDelete: 'SET NULL' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('routes', 'company_id')
  pgm.createIndex('routes', 'driver_id')

  // ── stops ──────────────────────────────────────────────────────────────────
  pgm.createTable('stops', {
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
    name: { type: 'text', notNull: true },
    lat: { type: 'double precision', notNull: true },
    lng: { type: 'double precision', notNull: true },
    sequence: { type: 'integer', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('stops', 'company_id')
  pgm.createIndex('stops', 'route_id')
  // Inactive stops must not block a sequence number
  pgm.createIndex('stops', ['route_id', 'sequence'], {
    unique: true,
    where: 'is_active = true',
    name: 'stops_route_sequence_active_unique',
  })

  // ── passengers ─────────────────────────────────────────────────────────────
  pgm.createTable('passengers', {
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
    stop_id: {
      type: 'uuid',
      notNull: true,
      references: 'stops',
      onDelete: 'RESTRICT',
    },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    telegram_chat_id: { type: 'text' },
    notification_channel: {
      type: 'text',
      notNull: true,
      default: 'telegram',
      check: "notification_channel IN ('telegram', 'sms')",
    },
    notify_before_minutes: { type: 'integer', notNull: true, default: 10 },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('passengers', 'company_id')
  pgm.createIndex('passengers', 'stop_id')
}

export const down = (pgm) => {
  pgm.dropTable('passengers')
  pgm.dropTable('stops')
  pgm.dropTable('routes')
  pgm.dropTable('vehicles')
}
