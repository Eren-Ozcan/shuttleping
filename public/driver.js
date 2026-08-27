/**
 * ShuttlePing sürücü istemcisi.
 *
 * Ayrı dosya, satır içi script değil (D5): panel ve bu sayfa oturum
 * cookie'sini taşıyan origin'den servis ediliyor ve CSP scriptSrc 'self'
 * satır içi script ile onclick niteliklerini bloklar.
 */
const API = '/api/v1'
const SEND_INTERVAL_MS = 10_000        // en sık 10 sn'de bir gönder
const REFRESH_INTERVAL_MS = 12 * 60_000 // access token 15 dk; 12 dk'da yenile
const HEARTBEAT_MS = 30_000            // 30 sn'de bir canlılık kontrolü
const LOST_AFTER_MS = 90_000          // 90 sn başarısızlık → "bağlantı koptu"
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
async function girisYap() {
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

/** authorization header ekler; 401'de bir kez token yenileyip tekrar dener. */
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

// ── Sefer yaşam döngüsü ─────────────────────────────────────────────────
async function seferiDegistir() {
  if (tripActive) return seferiBitir()

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
    watchId = navigator.geolocation.watchPosition(konumYakala, konumHatasi, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
    })
    lastSuccessAt = Date.now()
    startHeartbeat()
    await requestWakeLock()
    setStatus('Sefer açık — konum bekleniyor…', 'pulse')
  } catch (err) {
    setStatus(err.message, 'err')
  } finally {
    $('toggleBtn').disabled = false
  }
}

async function seferiBitir() {
  $('toggleBtn').disabled = true
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  tripActive = false
  stopHeartbeat()
  releaseWakeLock()
  try {
    await authedFetch('/trips/end', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
  } catch { /* yut — sefer zaten bitiriliyor */ }
  $('toggleBtn').textContent = 'Seferi Başlat'
  $('toggleBtn').className = 'btn-start'
  $('lostBadge').classList.add('hidden')
  setStatus('Sefer bitirildi')
  $('toggleBtn').disabled = false
}

// ── Konum gönderimi + offline buffer ───────────────────────────────────
function readBuffer() {
  try { return JSON.parse(localStorage.getItem(BUFFER_KEY) || '[]') } catch { return [] }
}
function writeBuffer(arr) {
  try { localStorage.setItem(BUFFER_KEY, JSON.stringify(arr.slice(-BUFFER_MAX))) } catch { /* kota dolu */ }
}

async function konumYakala(position) {
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

  const ok = await gonder(fix)
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

/** @returns {Promise<boolean>} gönderim başarılı mı */
async function gonder(body) {
  try {
    const res = await authedFetch('/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      await seferiBitir()
      setStatus('Oturum süresi doldu — tekrar giriş yapın', 'err')
      return false
    }
    if (res.status === 409) {
      // Sunucuda aktif sefer yok — istemci durumunu düzelt
      await seferiBitir()
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
    const ok = await gonder(fix) // recordedAt taşıdığı için backfill olarak işlenir
    if (!ok) break
    buf = buf.slice(1)
    writeBuffer(buf)
  }
}

function konumHatasi(err) {
  setStatus(
    err.code === 1
      ? 'Konum izni reddedildi — tarayıcı ayarlarından izin verin'
      : `Konum hatası: ${err.message}`,
    'err',
  )
}

// ── Heartbeat: uzun süre başarısızlıkta "bağlantı koptu" rozeti ─────────
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

// ── Wake Lock: ekran kilitlenince watchPosition durmasın ───────────────
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
    }
  } catch { /* desteklenmiyor / izin yok */ }
}
function releaseWakeLock() {
  try { wakeLock?.release() } catch { /* yut */ }
  wakeLock = null
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tripActive && !wakeLock) {
    requestWakeLock()
  }
})

// Olay bağlama: onclick nitelikleri CSP tarafından bloklanır
$('loginBtn').addEventListener('click', girisYap)
$('toggleBtn').addEventListener('click', seferiDegistir)
