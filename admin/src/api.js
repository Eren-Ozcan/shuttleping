/**
 * API client: access token management + automatic refresh on a 401.
 *
 * The access token and user info are held ONLY in memory (D6) — if written to
 * localStorage any injected script could read them. On a page reload the
 * session is re-established from the HttpOnly refresh cookie
 * (path=/api/v1/auth, not reachable from JS) via `ensureSession()`.
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
 * Called once at app startup: establishes the session if a refresh cookie exists.
 * If several calls come in at once, a single request is shared.
 * @returns {Promise<object|null>} the logged-in user or null
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
 * Gets a single-use ticket for the live map stream (D2).
 * The access token never enters the URL; the ticket is valid for 60s and used once.
 */
export async function getStreamTicket(routeId) {
  const { ticket } = await api(`/locations/${routeId}/stream-ticket`, { method: 'POST' })
  return ticket
}
