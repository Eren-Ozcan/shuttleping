// Dev-only test cockpit (T0.5). Reuses the existing admin-authenticated
// endpoints — no dedicated debug API. Not linked from anywhere, not part of
// the pilot demo; open it by hand when a "why didn't the notification fire"
// question needs an answer without grepping logs.
const POLL_INTERVAL_MS = 5_000

const emailEl = document.getElementById('email')
const passwordEl = document.getElementById('password')
const routeIdEl = document.getElementById('routeId')
const startBtn = document.getElementById('startBtn')
const loginStatusEl = document.getElementById('loginStatus')
const locationEl = document.getElementById('location')
const etaRowsEl = document.getElementById('etaRows')
const queuesEl = document.getElementById('queues')
const notifRowsEl = document.getElementById('notifRows')

let accessToken = null
let pollTimer = null

async function login() {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailEl.value, password: passwordEl.value }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? String(res.status))
  const data = await res.json()
  if (data.user.role !== 'company_admin') {
    throw new Error('Bu kokpit yalnızca company_admin ile çalışır')
  }
  accessToken = data.accessToken
}

async function authedGet(path) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${accessToken}` } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

function renderLocation(loc) {
  if (!loc) {
    locationEl.textContent = 'Konum yok (çevrimdışı ya da TTL doldu)'
    return
  }
  const ageSeconds = Math.round((Date.now() - loc.ts) / 1000)
  locationEl.textContent =
    `lat: ${loc.lat}, lng: ${loc.lng}\n` +
    `hız: ${loc.speed ?? '—'}, yön: ${loc.heading ?? '—'}\n` +
    `yaş: ${ageSeconds} sn ${ageSeconds > 90 ? '(bağlantı koptu olabilir)' : ''}`
}

function renderEta(eta) {
  etaRowsEl.innerHTML = ''
  if (!eta?.stops?.length) {
    etaRowsEl.innerHTML = '<tr><td colspan="3" class="muted">ETA henüz hesaplanmadı</td></tr>'
    return
  }
  for (const stop of eta.stops) {
    const tr = document.createElement('tr')
    const cls = stop.state === 'notified' ? 'ok' : stop.state === 'passed' ? 'muted' : 'warn'
    tr.innerHTML =
      `<td>${stop.name}</td>` +
      `<td class="${cls}">${stop.state}</td>` +
      `<td>${stop.etaSeconds != null ? Math.round(stop.etaSeconds / 60) + ' dk' : '—'}</td>`
    etaRowsEl.appendChild(tr)
  }
}

function renderQueues(health) {
  queuesEl.textContent = health?.queues
    ? JSON.stringify(health.queues, null, 2)
    : 'Kuyruk verisi yok (worker bu ortamda çalışmıyor olabilir)'
}

function renderNotifications(items) {
  notifRowsEl.innerHTML = ''
  if (!items?.length) {
    notifRowsEl.innerHTML = '<tr><td colspan="5" class="muted">Kayıt yok</td></tr>'
    return
  }
  for (const n of items) {
    const tr = document.createElement('tr')
    const cls = n.status === 'sent' ? 'ok' : n.status === 'failed' ? 'err' : 'warn'
    tr.innerHTML =
      `<td>${n.passenger_name}</td><td>${n.channel}</td>` +
      `<td class="${cls}">${n.status}</td><td>${n.error ?? '—'}</td>` +
      `<td>${new Date(n.created_at).toLocaleTimeString('tr-TR')}</td>`
    notifRowsEl.appendChild(tr)
  }
}

async function poll() {
  const routeId = routeIdEl.value.trim()
  if (!routeId) return
  try {
    const [location, eta, health, notifications] = await Promise.all([
      authedGet(`/api/v1/locations/${routeId}`),
      authedGet(`/api/v1/locations/${routeId}/eta`),
      fetch('/health/deep').then((r) => r.json()),
      authedGet('/api/v1/history/notifications?limit=20'),
    ])
    renderLocation(location)
    renderEta(eta)
    renderQueues(health)
    renderNotifications(notifications?.items)
    loginStatusEl.textContent = `Bağlı — son güncelleme ${new Date().toLocaleTimeString('tr-TR')}`
    loginStatusEl.className = 'ok'
  } catch (err) {
    loginStatusEl.textContent = `Hata: ${err.message}`
    loginStatusEl.className = 'err'
  }
}

startBtn.addEventListener('click', async () => {
  clearInterval(pollTimer)
  loginStatusEl.textContent = 'Giriş yapılıyor...'
  loginStatusEl.className = 'muted'
  try {
    await login()
    loginStatusEl.textContent = 'Giriş başarılı, izleniyor...'
    loginStatusEl.className = 'ok'
    poll()
    pollTimer = setInterval(poll, POLL_INTERVAL_MS)
  } catch (err) {
    loginStatusEl.textContent = `Giriş hatası: ${err.message}`
    loginStatusEl.className = 'err'
  }
})
