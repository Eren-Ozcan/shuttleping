/**
 * Faz E1/E13 — tenant bütünlüğü ve index temizliği.
 *
 * 002'nin başlığı company_id'nin "izolasyon sorguları için denormalize"
 * edildiğini söylüyor, ama tutarlılığını hiçbir şey zorlamıyordu: çocuk
 * tablolar hem company_id hem üst FK taşıyor, FK'lar yalnızca (id)'ye
 * bakıyordu. Yanlış company_id yazan tek bir bug, satırı sessizce başka
 * kiracıya görünür kılardı ve history sorgusundaki join'in ikinci bir
 * savunması yoktu.
 *
 * Çözüm: üst tablolarda (id, company_id) UNIQUE + çocuklarda bileşik FK.
 * Artık uyuşmayan bir company_id veritabanı seviyesinde reddedilir.
 *
 * Ayrıca index bakımı:
 *   - UNIQUE kısıtın zaten kapsadığı tekrar eden index'ler kaldırılır
 *     (users.email, refresh_tokens.token_hash) — iki yazma-yoğun aramada
 *     bedava maliyet
 *   - vehicles.company_id, (company_id, plate) UNIQUE'inin soldan öneki
 *   - location_history.company_id tek başına hiçbir sorguda kullanılmıyor
 *     (okuma yolu her zaman route_id + company_id filtreliyor)
 *   - eksik olanlar eklenir: routes.vehicle_id (ON DELETE SET NULL seq scan
 *     yapıyordu), notification_logs (company_id, created_at DESC),
 *     users (company_id, role), passengers (company_id, stop_id)
 */

export const up = (pgm) => {
  // ── Bileşik FK için gereken UNIQUE anahtarlar ──────────────────────────────
  pgm.addConstraint('companies', 'companies_id_unique', { unique: ['id'] })
  pgm.addConstraint('routes', 'routes_id_company_unique', { unique: ['id', 'company_id'] })
  pgm.addConstraint('stops', 'stops_id_company_unique', { unique: ['id', 'company_id'] })
  pgm.addConstraint('passengers', 'passengers_id_company_unique', {
    unique: ['id', 'company_id'],
  })
  pgm.addConstraint('trips', 'trips_id_company_unique', { unique: ['id', 'company_id'] })

  // ── Çocuk tablolarda bileşik FK ────────────────────────────────────────────
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

  // ── Tekrar eden / kullanılmayan index'ler ──────────────────────────────────
  pgm.dropIndex('users', 'email') // email zaten UNIQUE
  pgm.dropIndex('refresh_tokens', 'token_hash') // token_hash zaten UNIQUE
  pgm.dropIndex('vehicles', 'company_id') // (company_id, plate) UNIQUE kapsıyor
  pgm.dropIndex('location_history', 'company_id') // düşük kardinalite, kullanılmıyor

  // ── Eksik index'ler ────────────────────────────────────────────────────────
  pgm.createIndex('routes', 'vehicle_id', { name: 'routes_vehicle_idx' })
  pgm.createIndex('users', ['company_id', 'role'], { name: 'users_company_role_idx' })
  pgm.createIndex('passengers', ['company_id', 'stop_id'], {
    name: 'passengers_company_stop_idx',
  })
  // Denetim listesi: company_id filtresi + created_at DESC sıralama
  pgm.createIndex('notification_logs', [{ name: 'company_id' }, { name: 'created_at', sort: 'DESC' }], {
    name: 'notification_logs_company_created_idx',
  })
  // Saklama süresi temizliği bu index'i kullanır
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
