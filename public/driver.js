/**
 * ShuttlePing driver client.
 *
 * A separate file, not an inline script (D5): the panel and this page are
 * served from the origin that carries the session cookie, and CSP scriptSrc
 * 'self' blocks inline scripts and onclick attributes.
 */
const API = '/api/v1'
const SEND_INTERVAL_MS = 10_000        // send at most once every 10s
const REFRESH_INTERVAL_MS = 12 * 60_000 // access token is 15 min; refresh at 12
const HEARTBEAT_MS = 30_000            // liveness check every 30s
const LOST_AFTER_MS = 90_000          // 90s of failure -> "connection lost"
const BUFFER_KEY = 'sp_driver_buffer'
const BUFFER_MAX = 200

let accessToken = null
let watchId = null
let tripActive = false
let lastSentAt = 0
let lastSuccessAt = 0
let wakeLock = null
let refreshTimer = null
let heartbeatTimer = null

const $ = (id) => document.getElementById(id)
const setStatus = (text, cls = '') => {
  const el = $('status')
  el.textContent = text
  el.className = 'status ' + cls
}

// ── Auth ────────────────────────────────────────────────────────────────
async function login() {
  setStatus('Giriş yapılıyor…')
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Giriş başarısız')
    if (data.user.role !== 'driver') throw new Error('Bu sayfa sadece sürücüler içindir')

    accessToken = data.accessToken
    $('loginForm').classList.add('hidden')
    $('trackPanel').classList.remove('hidden')
    $('driverName').textContent = data.user.fullName
    setStatus('Hazır — seferi başlatabilirsiniz')
    startRefreshTimer()
  } catch (err) {
    setStatus(err.message, 'err')
  }
}

async function refreshToken() {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return false
    const data = await res.json()
    accessToken = data.accessToken
    return true
  } catch {
    return false
  }
}

function startRefreshTimer() {
  clearInterval(refreshTimer)
  refreshTimer = setInterval(refreshToken, REFRESH_INTERVAL_MS)
}

/** Adds the authorization header; on a 401, refreshes the token once and retries. */
async function authedFetch(path, opts = {}, retried = false) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      authorization: `Bearer ${accessToken}`,
    },
  })
  if (res.status === 401 && !retried) {
    if (await refreshToken()) return authedFetch(path, opts, true)
  }
  return res
}

// ── Trip lifecycle ─────────────────────────────────────────────────────
async function toggleTrip() {
  if (tripActive) return endTrip()

  if (!navigator.geolocation) {
    return setStatus('Tarayıcınız konum servisini desteklemiyor', 'err')
  }
  $('toggleBtn').disabled = true
  setStatus('Sefer başlatılıyor…')
  try {
    const res = await authedFetch('/trips/start', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || `Hata ${res.status}`)

    tripActive = true
    $('toggleBtn').textContent = 'Seferi Bitir'
    $('toggleBtn').className = 'btn-stop'
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
    })
    lastSuccessAt = Date.now()
    startHeartbeat()
    await requestWakeLock()
    // Wake Lock cannot survive the hardware power button — the browser
    // suspends watchPosition the moment the screen locks, whatever caused
    // it (see PILOT-READINESS.md J1). The only real mitigation is asking
    // the driver not to lock the screen.
    $('lockWarning').classList.remove('hidden')
    setStatus('Sefer açık — konum bekleniyor…', 'pulse')
  } catch (err) {
    setStatus(err.message, 'err')
  } finally {
    $('toggleBtn').disabled = false
  }
}

async function endTrip() {
  $('toggleBtn').disabled = true
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  tripActive = false
  stopHeartbeat()
  releaseWakeLock()
  $('lockWarning').classList.add('hidden')
  try {
    await authedFetch('/trips/end', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
  } catch { /* swallow — the trip is being ended anyway */ }
  $('toggleBtn').textContent = 'Seferi Başlat'
  $('toggleBtn').className = 'btn-start'
  $('lostBadge').classList.add('hidden')
  setStatus('Sefer bitirildi')
  $('toggleBtn').disabled = false
}

// ── Location send + offline buffer ─────────────────────────────────────
function readBuffer() {
  try { return JSON.parse(localStorage.getItem(BUFFER_KEY) || '[]') } catch { return [] }
}
function writeBuffer(arr) {
  try { localStorage.setItem(BUFFER_KEY, JSON.stringify(arr.slice(-BUFFER_MAX))) } catch { /* quota full */ }
}

async function onPosition(position) {
  if (!tripActive) return
  const now = Date.now()
  if (now - lastSentAt < SEND_INTERVAL_MS) return
  lastSentAt = now

  const { latitude, longitude, heading, speed } = position.coords
  const fix = {
    lat: latitude,
    lng: longitude,
    heading: heading == null || Number.isNaN(heading) ? undefined : heading,
    speed: speed == null || Number.isNaN(speed) ? undefined : speed,
  }

  const ok = await sendFix(fix)
  if (ok) {
    lastSuccessAt = Date.now()
    $('lostBadge').classList.add('hidden')
    setStatus(`Canlı 🟢 son gönderim ${new Date().toLocaleTimeString('tr-TR')}`, 'pulse')
    await flushBuffer()
  } else {
    const buf = readBuffer()
    buf.push({ ...fix, recordedAt: new Date().toISOString() })
    writeBuffer(buf)
    setStatus(`Sinyal yok — ${readBuffer().length} konum tamponda`, 'warn')
  }
}

/** @returns {Promise<boolean>} whether the send succeeded */
async function sendFix(body) {
  try {
    const res = await authedFetch('/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      await endTrip()
      setStatus('Oturum süresi doldu — tekrar giriş yapın', 'err')
      return false
    }
    if (res.status === 409) {
      // No active trip on the server — fix the client state
      await endTrip()
      setStatus('Sunucuda aktif sefer yok — seferi yeniden başlatın', 'err')
      return false
    }
    return res.ok
  } catch {
    return false
  }
}

async function flushBuffer() {
  let buf = readBuffer()
  while (buf.length) {
    const fix = buf[0]
    const ok = await sendFix(fix) // carries recordedAt, so it is processed as a backfill
    if (!ok) break
    buf = buf.slice(1)
    writeBuffer(buf)
  }
}

function onPositionError(err) {
  setStatus(
    err.code === 1
      ? 'Konum izni reddedildi — tarayıcı ayarlarından izin verin'
      : `Konum hatası: ${err.message}`,
    'err',
  )
}

// ── Heartbeat: show a "connection lost" badge after a long failure ─────
function startHeartbeat() {
  clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    if (!tripActive) return
    if (Date.now() - lastSuccessAt > LOST_AFTER_MS) {
      $('lostBadge').classList.remove('hidden')
    }
  }, HEARTBEAT_MS)
}
function stopHeartbeat() { clearInterval(heartbeatTimer) }

// ── Wake Lock: prevents auto-sleep while the tab is foreground and the ────
// driver isn't touching the screen. It does NOT survive a hardware power-
// button lock — the browser releases it and suspends watchPosition the
// moment the screen locks, whatever caused it (PILOT-READINESS.md J1,
// tested 2026-09-04). Kept because it still helps the common "phone dims
// itself" case; the lock case is handled by the on-screen warning instead.
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
    }
  } catch { /* unsupported / no permission */ }
}
function releaseWakeLock() {
  try { wakeLock?.release() } catch { /* swallow */ }
  wakeLock = null
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tripActive && !wakeLock) {
    requestWakeLock()
  }
})

// Event binding: onclick attributes are blocked by CSP
$('loginBtn').addEventListener('click', login)
$('toggleBtn').addEventListener('click', toggleTrip)
