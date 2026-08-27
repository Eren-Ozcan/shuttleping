/**
 * Faz A — sefer (trip) modeli.
 *
 * Önceki tasarımda "sefer" kavramı yoktu: routes.is_active hem soft-delete
 * hem "araç şu an yolda" anlamına geliyordu, tekrar-bildirim koruması ise
 * 45 dk'lık Redis dedup TTL'ine bırakılmıştı. Artık her vardiya bir trips
 * satırıdır; durak bazlı bildirim durumu trip_stops.state'te tutulur.
 *
 *   trips       — sürücünün başlattığı tek bir vardiya (active/completed/abandoned)
 *   trip_stops  — sefer açılırken stops'tan alınan snapshot; bildirim durumu
 *
 * location_history ve notification_logs'a nullable trip_id eklenir (eski
 * kayıtlar NULL kalır; yeni kayıtlar her zaman dolu gelir).
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

  // Güzergah başına aynı anda tek aktif sefer
  pgm.createIndex('trips', 'route_id', {
    unique: true,
    where: "status = 'active'",
    name: 'trips_route_active_unique',
  })
  pgm.createIndex('trips', ['company_id', 'started_at'], {
    name: 'trips_company_started_idx',
  })
  // Abandoned-toplayıcı ve konum ingest bu partial index'i kullanır
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
  // Yolcu bazlı bildirim dedup'ı. Eskiden 45 dk'lık Redis NX anahtarıydı;
  // artık sefere bağlı ve kalıcı — Redis flush edilse bile mükerrer bildirim
  // patlaması olmaz, aynı gün ikinci sefer yeni trip_id ile normal bildirir.
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

  // ── geriye dönük bağlar ────────────────────────────────────────────────────
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
