/**
 * Seeds a complete, self-consistent demo tenant for end-to-end testing:
 * company + company_admin + driver + vehicle + route + 8 real Istanbul stops
 * + 1 Telegram passenger.
 *
 * Idempotent: every row has a fixed UUID and is upserted, so running it twice
 * changes nothing but the password/chat id.
 *
 * Usage:
 *   npm run seed:demo
 *   node scripts/seed-demo.js --password <parola> --chat-id <telegramChatId>
 *   node scripts/seed-demo.js --routes 3 --passengers 20   (load test: N routes,
 *     each with its own driver+vehicle+8 stops, N passengers round-robined
 *     across that route's stops, no telegram chat id)
 *
 * Env fallbacks: DEMO_PASSWORD, TELEGRAM_TEST_CHAT_ID
 *
 * Stop geometry matters. The notification fires when the straight-line ETA
 * drops to notify_before_minutes (10). Without a working Google key the ETA
 * falls back to ETA_FALLBACK_SPEED_KMH (25 km/h), so 10 min is ~4.2 km — the
 * passenger stop is deliberately ~6.9 km from the first stop so the trip has a
 * real "not yet / now approaching" transition instead of firing immediately.
 * Extra routes (--routes > 1) reuse the same 8-stop geometry shifted slightly
 * east per route index so they don't overlap on the map.
 */
import bcrypt from 'bcrypt'
import pg from 'pg'
import { config } from 'dotenv'

config()

const ID = {
  company: '00000000-0000-4000-8000-000000000001',
  admin: '00000000-0000-4000-8000-000000000002',
  driver: '00000000-0000-4000-8000-000000000003',
  vehicle: '00000000-0000-4000-8000-000000000004',
  route: '00000000-0000-4000-8000-000000000005',
  passenger: '00000000-0000-4000-8000-000000000020',
  stop: (n) => `00000000-0000-4000-8000-0000000000${String(10 + n).padStart(2, '0')}`,
}

// Route index 1 always keeps the legacy fixed IDs above so single-route usage
// (the default) never changes shape. Route index >= 2 (--routes N load test)
// derives fresh IDs from a numeric slot so they can't collide with route 1.
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const routeId = (i) => (i === 1 ? ID.route : uid(100 + i))
const driverId = (i) => (i === 1 ? ID.driver : uid(200 + i))
const vehicleId = (i) => (i === 1 ? ID.vehicle : uid(300 + i))
const stopId = (i, s) => (i === 1 ? ID.stop(s) : uid(1000 + i * 100 + s))
const passengerId = (i, p) => (i === 1 && p === 1 ? ID.passenger : uid(5000 + i * 100 + p))
const driverEmail = (i) => (i === 1 ? 'driver@demo.local' : `driver${i}@demo.local`)
const routeName = (i) => (i === 1 ? 'Demo Hattı' : `Demo Hattı ${i}`)

const ADMIN_EMAIL = 'admin@demo.local'

// Kadıköy -> Ataşehir corridor, west to east
const STOPS = [
  { name: 'Kadıköy İskele', lat: 40.9903, lng: 29.0245 },
  { name: 'Söğütlüçeşme', lat: 40.9917, lng: 29.04 },
  { name: 'Acıbadem', lat: 40.9945, lng: 29.057 },
  { name: 'Ünalan', lat: 40.997, lng: 29.076 },
  { name: 'Göztepe Köprüsü', lat: 40.988, lng: 29.093 },
  { name: 'Kozyatağı', lat: 40.977, lng: 29.105 },
  { name: 'İçerenköy', lat: 40.97, lng: 29.121 },
  { name: 'Ataşehir Batı', lat: 40.982, lng: 29.13 },
]

// Extra routes (i >= 2) shift the same geometry north so they render as
// parallel corridors on the map instead of overlapping route 1.
const stopsForRoute = (i) => STOPS.map((s) => ({ ...s, lat: s.lat + (i - 1) * 0.01 }))

// The passenger waits here (1-based index into STOPS)
const PASSENGER_STOP_INDEX = 6

const args = process.argv.slice(2)
const argValue = (flag) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

const password = argValue('--password') || process.env.DEMO_PASSWORD || 'demo12345'
const chatId = argValue('--chat-id') || process.env.TELEGRAM_TEST_CHAT_ID || null
const routeCount = Math.max(1, Number(argValue('--routes')) || 1)
const passengersPerRoute = Math.max(1, Number(argValue('--passengers')) || 1)

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL tanımlı değil — .env dosyanı kontrol et')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl })
const client = await pool.connect()

try {
  const passwordHash = await bcrypt.hash(password, 10)

  await client.query('BEGIN')

  // Company — explicitly reset every gate that could silently block the test
  await client.query(
    `INSERT INTO companies (id, name, slug, is_active, payment_status, next_due_date, max_passengers, dry_run)
     VALUES ($1, 'Demo Servis', 'demo', true, 'active', NULL, NULL, false)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           slug = EXCLUDED.slug,
           is_active = true,
           payment_status = 'active',
           next_due_date = NULL,
           max_passengers = NULL,
           dry_run = false`,
    [ID.company],
  )

  await client.query(
    `INSERT INTO users (id, company_id, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, $4, 'company_admin', 'Demo Yönetici', true)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_active = true`,
    [ID.admin, ID.company, ADMIN_EMAIL, passwordHash],
  )

  for (let i = 1; i <= routeCount; i += 1) {
    await client.query(
      `INSERT INTO users (id, company_id, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, $4, 'driver', $5, true)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             full_name = EXCLUDED.full_name,
             is_active = true`,
      [driverId(i), ID.company, driverEmail(i), passwordHash, `Demo Sürücü ${i}`],
    )

    await client.query(
      `INSERT INTO vehicles (id, company_id, plate, name, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO UPDATE
         SET plate = EXCLUDED.plate, name = EXCLUDED.name, is_active = true`,
      [vehicleId(i), ID.company, `34 DEMO ${String(i).padStart(2, '0')}`, `Demo Servis Aracı ${i}`],
    )

    // Driver and vehicle must be assigned here — POST /trips/start looks the
    // driver up through routes.driver_id and 404s otherwise
    await client.query(
      `INSERT INTO routes (id, company_id, name, driver_id, vehicle_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             driver_id = EXCLUDED.driver_id,
             vehicle_id = EXCLUDED.vehicle_id,
             is_active = true`,
      [routeId(i), ID.company, routeName(i), driverId(i), vehicleId(i)],
    )

    const routeStops = stopsForRoute(i)
    for (const [index, stop] of routeStops.entries()) {
      await client.query(
        `INSERT INTO stops (id, company_id, route_id, name, lat, lng, sequence, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               lat = EXCLUDED.lat,
               lng = EXCLUDED.lng,
               sequence = EXCLUDED.sequence,
               is_active = true`,
        [stopId(i, index + 1), ID.company, routeId(i), stop.name, stop.lat, stop.lng, index + 1],
      )
    }

    for (let p = 1; p <= passengersPerRoute; p += 1) {
      // Single passenger keeps the deliberate ~6.9 km "not yet / now
      // approaching" placement; a load-test batch round-robins the stops.
      const stopIndex =
        passengersPerRoute === 1 ? PASSENGER_STOP_INDEX : ((p - 1) % routeStops.length) + 1
      const isFlagship = i === 1 && p === 1
      await client.query(
        `INSERT INTO passengers (id, company_id, stop_id, full_name, phone, telegram_chat_id,
                                 notification_channel, notify_before_minutes, is_active)
         VALUES ($1, $2, $3, $4, NULL, $5, 'telegram', 10, true)
         ON CONFLICT (id) DO UPDATE
           SET stop_id = EXCLUDED.stop_id,
               telegram_chat_id = EXCLUDED.telegram_chat_id,
               notification_channel = 'telegram',
               notify_before_minutes = 10,
               is_active = true`,
        [
          passengerId(i, p),
          ID.company,
          stopId(i, stopIndex),
          `Demo Yolcu ${i}-${p}`,
          isFlagship ? chatId : null,
        ],
      )
    }
  }

  await client.query('COMMIT')

  console.log('Demo veri hazır.\n')
  console.log(`  Şirket        : Demo Servis (${ID.company})`)
  console.log(`  Güzergah      : ${routeCount} adet, ${STOPS.length} durak/güzergah`)
  console.log(`  Yolcu         : güzergah başına ${passengersPerRoute}`)
  console.log(`  Panel girişi  : ${ADMIN_EMAIL} / ${password}`)
  console.log(`  Sürücü girişi : ${driverEmail(1)} / ${password}${routeCount > 1 ? ` (…${driverEmail(routeCount)})` : ''}`)
  if (routeCount === 1 && passengersPerRoute === 1) {
    const passengerStop = STOPS[PASSENGER_STOP_INDEX - 1]
    console.log(`  Yolcu durağı  : ${PASSENGER_STOP_INDEX}. ${passengerStop.name} (eşik 10 dk)`)
  }
  console.log('')
  console.log('  Sürücü sayfası: <adres>/driver.html   (geolocation için HTTPS şart)')
  console.log('  Sanal sürüş   : npm run demo:drive (--route-index N ile çoklu güzergah)')

  if (!chatId) {
    console.log('')
    console.log('  UYARI: Telegram chat ID verilmedi — bildirim')
    console.log('  "missing_telegram_chat_id" ile başarısız olur.')
    console.log('  Almak için: npm run telegram:chat-id')
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Seed başarısız:', err.message)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
