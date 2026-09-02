/**
 * Drives the REAL driver.html client running in Chrome on a USB-connected
 * Android phone, by feeding it simulated GPS through the DevTools protocol
 * (Emulation.setGeolocationOverride). No mock-location app, no Play Store
 * account, no fake-GPS permissions needed.
 *
 * Unlike scripts/demo-drive.js (which talks to the API directly), this
 * exercises the actual client: login, refresh loop, watchPosition, wake lock,
 * offline buffer and the 10 s send throttle.
 *
 * Prerequisites:
 *   1. Phone: Developer options -> USB debugging on, cable plugged in
 *   2. adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   3. Chrome on the phone open on <base>/driver.html (HTTPS — geolocation
 *      and wake lock are secure-context only)
 *
 * Usage:
 *   node scripts/drive-phone.js --base https://<domain>
 *   node scripts/drive-phone.js --base https://<domain> --speed 8 --stop-at 6
 */
import { config } from 'dotenv'

config()

const STEP_MS = 12_000 // > driver.js SEND_INTERVAL_MS (10 s) so every step is sent
const ADMIN_EMAIL = 'admin@demo.local'
const DRIVER_EMAIL = 'driver@demo.local'
const DEVTOOLS = 'http://localhost:9222'
const EARTH_RADIUS_M = 6_371_000

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : fallback
}

const base = (argValue('--base') || '').replace(/\/$/, '')
const speed = Number(argValue('--speed', '6'))
const kmh = Number(argValue('--kmh', '40'))
const stopAt = argValue('--stop-at') ? Number(argValue('--stop-at')) : null
const password = argValue('--password', process.env.DEMO_PASSWORD || 'demo12345')

if (!base) {
  console.error('--base zorunlu, örn: --base https://xxx.trycloudflare.com')
  process.exit(1)
}

const toRad = (deg) => (deg * Math.PI) / 180

const haversine = (a, b) => {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

const interpolate = (a, b, ratio) => ({
  lat: a.lat + (b.lat - a.lat) * ratio,
  lng: a.lng + (b.lng - a.lng) * ratio,
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── DevTools connection ──────────────────────────────────────────────────────

const targets = await fetch(`${DEVTOOLS}/json/list`)
  .then((r) => r.json())
  .catch(() => {
    console.error(
      `${DEVTOOLS} açılamadı. Önce: adb forward tcp:9222 localabstract:chrome_devtools_remote`,
    )
    process.exit(1)
  })

const target = targets.find((t) => t.type === 'page' && t.url.includes('/driver.html'))
if (!target) {
  console.error('Telefonda driver.html açık bir sekme yok. Sayfayı aç ve tekrar dene.')
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const resolver = pending.get(message.id)
  if (resolver) {
    pending.delete(message.id)
    resolver(message)
  }
})

const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, (message) =>
      message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result),
    )
    socket.send(JSON.stringify({ id, method, params }))
  })

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('DevTools soketi açılamadı')), {
    once: true,
  })
})

/** Runs JS in the page and returns its value. */
const evaluate = async (expression) => {
  const result = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'sayfa hatası')
  }
  return result.result.value
}

const setPosition = (lat, lng) =>
  cdp('Emulation.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 10 })

// ── Route geometry (read through the admin API, same source as the panel) ────

const api = async (path, token) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

const loginRes = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password }),
})
if (!loginRes.ok) {
  console.error(`Panel girişi başarısız (${loginRes.status}) — seed:demo çalıştı mı?`)
  process.exit(1)
}
const adminToken = (await loginRes.json()).accessToken

const routes = await api('/routes?active=true', adminToken)
if (!routes[0]) {
  console.error('Aktif güzergah yok — önce npm run seed:demo')
  process.exit(1)
}

const stops = (await api(`/routes/${routes[0].id}/stops`, adminToken))
  .filter((s) => s.isActive !== false)
  .sort((a, b) => a.sequence - b.sequence)
  .map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }))

// ── Drive ────────────────────────────────────────────────────────────────────

try {
  await cdp('Runtime.enable')
  // Android Chrome has no browser-context management, so the site permission
  // cannot be pre-granted here — the prompt has to be accepted on the phone
  // once (adb shell input tap, or by hand). Desktop Chrome accepts this.
  await cdp('Browser.grantPermissions', { origin: base, permissions: ['geolocation'] }).catch(
    (err) => console.log(`Konum izni önceden verilemedi (${err.message}) — telefondan onayla`),
  )
  await setPosition(stops[0].lat, stops[0].lng)

  const loggedIn = await evaluate(`!document.getElementById('trackPanel').classList.contains('hidden')`)

  if (!loggedIn) {
    await evaluate(`
      (() => {
        const set = (id, value) => {
          const el = document.getElementById(id)
          el.value = value
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        set('email', ${JSON.stringify(DRIVER_EMAIL)})
        set('password', ${JSON.stringify(password)})
        document.getElementById('loginBtn').click()
      })()
    `)
    await sleep(3000)
  }

  const status = await evaluate(`document.getElementById('status').textContent`)
  const panelVisible = await evaluate(
    `!document.getElementById('trackPanel').classList.contains('hidden')`,
  )
  if (!panelVisible) {
    console.error(`Sürücü girişi başarısız. Sayfadaki durum: "${status}"`)
    process.exit(1)
  }

  const broadcasting = await evaluate(
    `document.getElementById('toggleBtn').textContent.includes('Bitir')`,
  )
  if (!broadcasting) {
    await evaluate(`document.getElementById('toggleBtn').click()`)
    await sleep(3000)
  }

  console.log(`Yayın başladı — ${stops.length} durak, ${kmh} km/sa, zaman sıkıştırma ×${speed}\n`)

  const metersPerStep = ((kmh * 1000) / 3600) * (STEP_MS / 1000) * speed
  const lastIndex = stopAt ? Math.min(stopAt, stops.length) - 1 : stops.length - 1

  let segment = 0
  let position = { lat: stops[0].lat, lng: stops[0].lng }

  while (segment < lastIndex) {
    const target = stops[segment + 1]
    const remaining = haversine(position, target)

    if (remaining <= metersPerStep) {
      position = { lat: target.lat, lng: target.lng }
      segment += 1
    } else {
      position = interpolate(position, target, metersPerStep / remaining)
    }

    await setPosition(position.lat, position.lng)
    await sleep(STEP_MS)

    const next = stops[Math.min(segment + 1, stops.length - 1)]
    const pageStatus = await evaluate(`document.getElementById('status').textContent`)
    console.log(
      `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} — ${next.name} ${(haversine(position, next) / 1000).toFixed(2)} km — telefon: ${pageStatus}`,
    )
  }

  if (stopAt) {
    console.log(`\n${stops[lastIndex].name} durağında bekleniyor. Sefer açık.`)
  } else {
    await evaluate(`document.getElementById('toggleBtn').click()`)
    console.log('\nSefer bitirildi.')
  }
} catch (err) {
  console.error('Telefon sürüşü başarısız:', err.message)
  process.exitCode = 1
} finally {
  socket.close()
}
