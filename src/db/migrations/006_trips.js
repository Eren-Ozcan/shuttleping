/**
 * Phase A — the trip model.
 *
 * The previous design had no concept of a "trip": routes.is_active meant both
 * soft-delete and "the vehicle is on the road right now", and repeat-notification
 * protection was left to a 45-minute Redis dedup TTL. Now every shift is a
 * trips row; per-stop notification state is kept in trip_stops.state.
 *
 *   trips       — a single shift started by a driver (active/completed/abandoned)
 *   trip_stops  — a snapshot taken from stops when the trip opens; notification state
 *
 * A nullable trip_id is added to location_history and notification_logs (old
 * rows stay NULL; new rows always arrive populated).
 */

export const up = (pgm) => {
  // ── trips ──────────────────────────────────────────────────────────────────
  pgm.createTable('trips', {
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
    driver_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    vehicle_id: { type: 'uuid', references: 'vehicles', onDelete: 'SET NULL' },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active', 'completed', 'abandoned')",
    },
    started_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    ended_at: { type: 'timestamptz' },
    last_ping_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  // One active trip per route at a time
  pgm.createIndex('trips', 'route_id', {
    unique: true,
    where: "status = 'active'",
    name: 'trips_route_active_unique',
  })
  pgm.createIndex('trips', ['company_id', 'started_at'], {
    name: 'trips_company_started_idx',
  })
  // The abandoned-trip sweep and location ingest use this partial index
  pgm.createIndex('trips', 'driver_id', {
    where: "status = 'active'",
    name: 'trips_driver_active_idx',
  })
  pgm.createIndex('trips', 'last_ping_at', {
    where: "status = 'active'",
    name: 'trips_active_last_ping_idx',
  })

  // ── trip_stops ─────────────────────────────────────────────────────────────
  pgm.createTable('trip_stops', {
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
    trip_id: {
      type: 'uuid',
      notNull: true,
      references: 'trips',
      onDelete: 'CASCADE',
    },
    stop_id: {
      type: 'uuid',
      notNull: true,
      references: 'stops',
      onDelete: 'RESTRICT',
    },
    sequence: { type: 'integer', notNull: true },
    state: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "state IN ('pending', 'notified', 'passed')",
    },
    notified_at: { type: 'timestamptz' },
    passed_at: { type: 'timestamptz' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.addConstraint('trip_stops', 'trip_stops_trip_stop_unique', {
    unique: ['trip_id', 'stop_id'],
  })
  pgm.createIndex('trip_stops', ['trip_id', 'sequence'], {
    name: 'trip_stops_trip_sequence_idx',
  })

  // ── trip_notifications ─────────────────────────────────────────────────────
  // Per-passenger notification dedup. It used to be a 45-minute Redis NX key;
  // now it is trip-scoped and persistent — even if Redis is flushed there is no
  // burst of duplicate notifications, and a second trip the same day notifies
  // normally with a new trip_id.
  pgm.createTable('trip_notifications', {
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
    trip_id: {
      type: 'uuid',
      notNull: true,
      references: 'trips',
      onDelete: 'CASCADE',
    },
    passenger_id: {
      type: 'uuid',
      notNull: true,
      references: 'passengers',
      onDelete: 'RESTRICT',
    },
    stop_id: {
      type: 'uuid',
      notNull: true,
      references: 'stops',
      onDelete: 'RESTRICT',
    },
    eta_minutes: { type: 'integer', notNull: true },
    enqueued_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.addConstraint('trip_notifications', 'trip_notifications_trip_passenger_unique', {
    unique: ['trip_id', 'passenger_id'],
  })

  // ── backward links ─────────────────────────────────────────────────────────
  pgm.addColumns('location_history', {
    trip_id: { type: 'uuid', references: 'trips', onDelete: 'SET NULL' },
  })
  pgm.addColumns('notification_logs', {
    trip_id: { type: 'uuid', references: 'trips', onDelete: 'SET NULL' },
  })
}

export const down = (pgm) => {
  pgm.dropColumns('notification_logs', ['trip_id'])
  pgm.dropColumns('location_history', ['trip_id'])
  pgm.dropTable('trip_notifications')
  pgm.dropTable('trip_stops')
  pgm.dropTable('trips')
}
