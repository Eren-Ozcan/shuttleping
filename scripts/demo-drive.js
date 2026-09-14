/**
 * Virtual driver — walks the demo route and posts locations over the real HTTP
 * API, so the whole chain (location ingest -> ETA worker -> notification
 * worker -> Telegram) can be verified without a phone.
 *
 * Usage:
 *   npm run demo:drive
 *   node scripts/demo-drive.js --base https://<domain> --speed 6 --stop-at 5
 *
 * Options:
 *   --base <url>          API base, default http://localhost:3000
 *   --speed <n>           time compression: n simulated seconds per real second (default 6)
 *   --kmh <n>             simulated ground speed (default 40)
 *   --stop-at <n>         park at the n-th stop and leave the trip open
 *   --no-end              do not end the trip when the route is finished
 *   --password <p>        demo password (default DEMO_PASSWORD env or demo12345)
 *   --route-index <n>     1-based index into the active routes list (default 1) —
 *                         pair with `seed-demo.js --routes N` to drive route N;
 *                         its driver login is driver@demo.local for index 1,
 *                         driverN@demo.local for index >= 2
 *
 * The send interval is fixed at 10 s because RATE_LIMIT_LOCATION_MAX is 12
 * requests per minute; going faster gets the driver 429'd. Distance covered
 * per tick is controlled with --speed instead.
 */
import { config } from 'dotenv'

config()

const SEND_INTERVAL_MS = 10_000
const ADMIN_EMAIL = 'admin@demo.local'
const EARTH_RADIUS_M = 6_371_000

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : fallback
}

const base = (argValue('--base', 'http://localhost:3000') || '').replace(/\/$/, '')
const speed = Number(argValue('--speed', '6'))
const kmh = Number(argValue('--kmh', '40'))
const stopAt = argValue('--stop-at') ? Number(argValue('--stop-at')) : null
const endTrip = !args.includes('--no-end')
const password = argValue('--password', process.env.DEMO_PASSWORD || 'demo12345')
const routeIndex = Math.max(1, Number(argValue('--route-index', '1')) || 1)
const DRIVER_EMAIL = routeIndex === 1 ? 'driver@demo.local' : `driver${routeIndex}@demo.local`
// Must mirror seed-demo.js's routeId(i) exactly — /routes lists newest-first
// (created_at DESC), so index-into-array is unreliable once --routes > 1.
const EXPECTED_ROUTE_ID =
  routeIndex === 1
    ? '00000000-0000-4000-8000-000000000005'
    : `00000000-0000-4000-8000-${String(100 + routeIndex).padStart(12, '0')}`

if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(kmh) || kmh <= 0) {
  console.error('--speed ve --kmh pozitif sayı olmalı')
  process.exit(1)
}

const toRad = (deg) => (deg * Math.PI) / 180

const haversine = (a, b) => {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

// Linear interpolation is good enough at city scale (< 20 km segments)
const interpolate = (a, b, ratio) => ({
  lat: a.lat + (b.lat - a.lat) * ratio,
  lng: a.lng + (b.lng - a.lng) * ratio,
})

const bearing = (a, b) => {
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180) / Math.PI
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }

  if (!res.ok) {
    const message = payload?.message || payload?.error || res.statusText
    throw new Error(`${method} ${path} → ${res.status} ${message}`)
  }
  return payload
}

const login = async (email) => {
  const data = await call('/auth/login', { method: 'POST', body: { email, password } })
  return data.accessToken
}

let driverToken = null

const shutdown = async () => {
  if (driverToken && endTrip) {
    await call('/trips/end', { method: 'POST', token: driverToken, body: {} }).catch(() => {})
  }
}

process.on('SIGINT', async () => {
  console.log('\nDurduruluyor…')
  await shutdown()
  process.exit(0)
})

try {
  // The driver role cannot read routes/stops, so the geometry comes from the
  // company admin
  const adminToken = await login(ADMIN_EMAIL)
  const routes = await call('/routes?active=true', { token: adminToken })
  const route = routes.find((r) => r.id === EXPECTED_ROUTE_ID)

  if (!route) {
    console.error(
      routes.length
        ? `--route-index ${routeIndex} yok — önce npm run seed:demo -- --routes ${routeIndex} çalıştır`
        : 'Aktif güzergah bulunamadı — önce npm run seed:demo çalıştır',
    )
    process.exit(1)
  }

  const stopsResponse = await call(`/routes/${route.id}/stops`, { token: adminToken })
  const stops = stopsResponse
    .filter((s) => s.isActive !== false)
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }))

  if (stops.length < 2) {
    console.error('Güzergahta en az 2 aktif durak olmalı')
    process.exit(1)
  }

  driverToken = await login(DRIVER_EMAIL)
  const trip = await call('/trips/start', { method: 'POST', token: driverToken, body: {} })
  console.log(`Sefer başladı: ${trip.id}`)
  console.log(`Güzergah: ${route.name} — ${stops.length} durak`)
  console.log(`Hız: ${kmh} km/sa, zaman sıkıştırma ×${speed}\n`)

  const metersPerTick = ((kmh * 1000) / 3600) * (SEND_INTERVAL_MS / 1000) * speed
  const lastIndex = stopAt ? Math.min(stopAt, stops.length) - 1 : stops.length - 1

  let segment = 0
  let position = { ...stops[0] }

  while (segment < lastIndex) {
    const target = stops[segment + 1]
    const remaining = haversine(position, target)

    if (remaining <= metersPerTick) {
      position = { lat: target.lat, lng: target.lng }
      segment += 1
    } else {
      position = interpolate(position, target, metersPerTick / remaining)
    }

    await call('/locations', {
      method: 'POST',
      token: driverToken,
      body: {
        lat: Number(position.lat.toFixed(6)),
        lng: Number(position.lng.toFixed(6)),
        heading: Number(bearing(position, target).toFixed(1)),
        speed: Number(((kmh * 1000) / 3600).toFixed(2)),
      },
    })

    const next = stops[Math.min(segment + 1, stops.length - 1)]
    console.log(
      `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} — sıradaki: ${next.name} (${(haversine(position, next) / 1000).toFixed(2)} km)`,
    )

    if (segment < lastIndex) await sleep(SEND_INTERVAL_MS)
  }

  if (stopAt) {
    console.log(`\n${stops[lastIndex].name} durağında bekleniyor. Sefer açık bırakıldı.`)
  } else if (endTrip) {
    await call('/trips/end', { method: 'POST', token: driverToken, body: {} })
    console.log('\nSefer bitti.')
  }

  console.log('Bildirimi kontrol et: SELECT status, error FROM notification_logs ORDER BY created_at DESC LIMIT 5;')
} catch (err) {
  console.error('Sanal sürüş başarısız:', err.message)
  await shutdown()
  process.exit(1)
}
