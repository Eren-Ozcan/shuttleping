/**
 * API istemcisi: access token yönetimi + 401'de otomatik refresh.
 *
 * Access token ve kullanıcı bilgisi YALNIZCA bellekte tutulur (D6) —
 * localStorage'a yazılsaydı enjekte edilen herhangi bir script okuyabilirdi.
 * Sayfa yenilendiğinde oturum, HttpOnly refresh cookie'siyle
 * (path=/api/v1/auth, JS erişemez) `ensureSession()` üzerinden yeniden kurulur.
 */
const API = '/api/v1'

let accessToken = null
let currentUser = null
let bootstrapPromise = null

export function getToken() {
  return accessToken
}

export function getUser() {
  return currentUser
}

function setSession(token, user) {
  accessToken = token
  if (user) currentUser = user
}

export function clearSession() {
  accessToken = null
  currentUser = null
  bootstrapPromise = null
}

async function tryRefresh() {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) return false
  const body = await res.json()
  setSession(body.accessToken, body.user)
  return true
}

/**
 * Uygulama açılışında bir kez çağrılır: refresh cookie varsa oturumu kurar.
 * Aynı anda birden fazla çağrı gelirse tek istek paylaşılır.
 * @returns {Promise<object|null>} oturum açık kullanıcı ya da null
 */
export function ensureSession() {
  if (accessToken) return Promise.resolve(currentUser)
  bootstrapPromise ??= tryRefresh()
    .then((ok) => (ok ? currentUser : null))
    .catch(() => null)
  return bootstrapPromise
}

export async function api(path, { method = 'GET', body } = {}) {
  const doFetch = () =>
    fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })

  let res = await doFetch()
  if (res.status === 401 && (await tryRefresh())) {
    res = await doFetch()
  }
  if (res.status === 401) {
    clearSession()
    window.location.href = import.meta.env.BASE_URL + 'login'
    throw new Error('Oturum süresi doldu')
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `İstek başarısız (${res.status})`)
  return data
}

export async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? 'Giriş başarısız')
  setSession(data.accessToken, data.user)
  return data.user
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
  } finally {
    clearSession()
  }
}

/**
 * Canlı harita akışı için tek kullanımlık bilet alır (D2).
 * Access token URL'e girmez; bilet 60 sn geçerlidir ve bir kez kullanılır.
 */
export async function getStreamTicket(routeId) {
  const { ticket } = await api(`/locations/${routeId}/stream-ticket`, { method: 'POST' })
  return ticket
}
