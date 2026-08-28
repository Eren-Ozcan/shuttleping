/**
 * Phase E1/E13 — tenant integrity and index cleanup.
 *
 * The 002 header says company_id is "denormalized for isolation queries", but
 * nothing enforced its consistency: child tables carry both company_id and the
 * parent FK, and the FKs only referenced (id). A single bug writing the wrong
 * company_id would silently make a row visible to another tenant, and the join
 * in the history query had no second line of defense.
 *
 * Fix: (id, company_id) UNIQUE on the parent tables + a composite FK on the
 * children. A mismatched company_id is now rejected at the database level.
 *
 * Also index maintenance:
 *   - drop redundant indexes already covered by a UNIQUE constraint
 *     (users.email, refresh_tokens.token_hash) — free cost on two write-heavy lookups
 *   - vehicles.company_id is a left prefix of the (company_id, plate) UNIQUE
 *   - location_history.company_id alone is used by no query
 *     (the read path always filters route_id + company_id)
 *   - add the missing ones: routes.vehicle_id (ON DELETE SET NULL was doing a
 *     seq scan), notification_logs (company_id, created_at DESC),
 *     users (company_id, role), passengers (company_id, stop_id)
 */

export const up = (pgm) => {
  // ── UNIQUE keys required for the composite FKs ─────────────────────────────
  pgm.addConstraint('companies', 'companies_id_unique', { unique: ['id'] })
  pgm.addConstraint('routes', 'routes_id_company_unique', { unique: ['id', 'company_id'] })
  pgm.addConstraint('stops', 'stops_id_company_unique', { unique: ['id', 'company_id'] })
  pgm.addConstraint('passengers', 'passengers_id_company_unique', {
    unique: ['id', 'company_id'],
  })
  pgm.addConstraint('trips', 'trips_id_company_unique', { unique: ['id', 'company_id'] })

  // ── Composite FK on the child tables ──────────────────────────────────────
  pgm.addConstraint('stops', 'stops_route_company_fk', {
    foreignKeys: {
      columns: ['route_id', 'company_id'],
      references: 'routes(id, company_id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('passengers', 'passengers_stop_company_fk', {
    foreignKeys: {
      columns: ['stop_id', 'company_id'],
      references: 'stops(id, company_id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('location_history', 'location_history_route_company_fk', {
    foreignKeys: {
      columns: ['route_id', 'company_id'],
      references: 'routes(id, company_id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('notification_logs', 'notification_logs_passenger_company_fk', {
    foreignKeys: {
      columns: ['passenger_id', 'company_id'],
      references: 'passengers(id, company_id)',
      onDelete: 'RESTRICT',
    },
  })
  pgm.addConstraint('trip_stops', 'trip_stops_trip_company_fk', {
    foreignKeys: {
      columns: ['trip_id', 'company_id'],
      references: 'trips(id, company_id)',
      onDelete: 'CASCADE',
    },
  })
  pgm.addConstraint('trip_notifications', 'trip_notifications_trip_company_fk', {
    foreignKeys: {
      columns: ['trip_id', 'company_id'],
      references: 'trips(id, company_id)',
      onDelete: 'CASCADE',
    },
  })

  // ── Redundant / unused indexes ────────────────────────────────────────────
  pgm.dropIndex('users', 'email') // email is already UNIQUE
  pgm.dropIndex('refresh_tokens', 'token_hash') // token_hash is already UNIQUE
  pgm.dropIndex('vehicles', 'company_id') // covered by the (company_id, plate) UNIQUE
  pgm.dropIndex('location_history', 'company_id') // low cardinality, unused

  // ── Missing indexes ──────────────────────────────────────────────────────
  pgm.createIndex('routes', 'vehicle_id', { name: 'routes_vehicle_idx' })
  pgm.createIndex('users', ['company_id', 'role'], { name: 'users_company_role_idx' })
  pgm.createIndex('passengers', ['company_id', 'stop_id'], {
    name: 'passengers_company_stop_idx',
  })
  // Audit list: company_id filter + created_at DESC ordering
  pgm.createIndex('notification_logs', [{ name: 'company_id' }, { name: 'created_at', sort: 'DESC' }], {
    name: 'notification_logs_company_created_idx',
  })
  // The retention cleanup uses this index
  pgm.createIndex('location_history', 'recorded_at', {
    name: 'location_history_recorded_idx',
  })
}

export const down = (pgm) => {
  pgm.dropIndex('location_history', 'recorded_at', { name: 'location_history_recorded_idx' })
  pgm.dropIndex('notification_logs', ['company_id', 'created_at'], {
    name: 'notification_logs_company_created_idx',
  })
  pgm.dropIndex('passengers', ['company_id', 'stop_id'], { name: 'passengers_company_stop_idx' })
  pgm.dropIndex('users', ['company_id', 'role'], { name: 'users_company_role_idx' })
  pgm.dropIndex('routes', 'vehicle_id', { name: 'routes_vehicle_idx' })

  pgm.createIndex('location_history', 'company_id')
  pgm.createIndex('vehicles', 'company_id')
  pgm.createIndex('refresh_tokens', 'token_hash')
  pgm.createIndex('users', 'email')

  pgm.dropConstraint('trip_notifications', 'trip_notifications_trip_company_fk')
  pgm.dropConstraint('trip_stops', 'trip_stops_trip_company_fk')
  pgm.dropConstraint('notification_logs', 'notification_logs_passenger_company_fk')
  pgm.dropConstraint('location_history', 'location_history_route_company_fk')
  pgm.dropConstraint('passengers', 'passengers_stop_company_fk')
  pgm.dropConstraint('stops', 'stops_route_company_fk')

  pgm.dropConstraint('trips', 'trips_id_company_unique')
  pgm.dropConstraint('passengers', 'passengers_id_company_unique')
  pgm.dropConstraint('stops', 'stops_id_company_unique')
  pgm.dropConstraint('routes', 'routes_id_company_unique')
  pgm.dropConstraint('companies', 'companies_id_unique')
}
