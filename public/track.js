// Public passenger tracking page — no login, driven by the ?t= token from the
// notification link (src/routes/v1/track/index.js).
const POLL_INTERVAL_MS = 20_000

const companyEl = document.getElementById('company')
const stopEl = document.getElementById('stop')
const etaEl = document.getElementById('eta')
const noteEl = document.getElementById('note')

const token = new URLSearchParams(location.search).get('t')

function render({ companyName, stopName, status, etaMinutes, updatedAt }) {
  companyEl.textContent = companyName ?? ''
  stopEl.textContent = stopName ? `"${stopName}" durağı` : ''

  if (status === 'passed' || status === 'notified') {
    if (etaMinutes === 0) {
      etaEl.textContent = 'Vardı'
      etaEl.classList.add('arrived')
    } else if (etaMinutes != null) {
      etaEl.textContent = `${etaMinutes} dk`
      etaEl.classList.remove('arrived')
    }
  } else if (etaMinutes != null) {
    etaEl.textContent = `${etaMinutes} dk`
    etaEl.classList.remove('arrived')
  } else {
    etaEl.textContent = '—'
  }

  noteEl.textContent = updatedAt
    ? `Son güncelleme: ${new Date(updatedAt).toLocaleTimeString('tr-TR')}`
    : 'Servis henüz yolda değil'
  noteEl.classList.remove('err')
}

async function poll() {
  try {
    const res = await fetch(`/api/v1/track/${token}`)
    if (res.status === 404) {
      etaEl.textContent = '—'
      noteEl.textContent = 'Bu takip bağlantısının süresi doldu'
      noteEl.classList.add('err')
      return
    }
    if (!res.ok) throw new Error(String(res.status))
    render(await res.json())
  } catch {
    noteEl.textContent = 'Bağlantı hatası, yeniden deneniyor...'
    noteEl.classList.add('err')
  }
}

if (!token) {
  noteEl.textContent = 'Geçersiz takip bağlantısı'
  noteEl.classList.add('err')
} else {
  poll()
  setInterval(poll, POLL_INTERVAL_MS)
}
