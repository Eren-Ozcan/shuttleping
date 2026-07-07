/**
 * API istemcisi: access token yönetimi + 401'de otomatik refresh.
 * Refresh token HttpOnly cookie'de (path=/api/v1/auth) — JS erişemez,
 * credentials: 'include' ile taşınır.
 */
const API = '/api/v1'

let accessToken = localStorage.getItem('accessToken')

export function getToken() {
  return accessToken
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user'))
  } catch {
    return null
  }
}

function setSession(token, user) {
  accessToken = token
  localStorage.setItem('accessToken', token)
  if (user) localStorage.setItem('user', JSON.stringify(user))
}

export function clearSession() {
  accessToken = null
  localStorage.removeItem('accessToken')
  localStorage.removeItem('user')
}

async function tryRefresh() {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) return false
  const body = await res.json()
  setSession(body.accessToken)
  return true
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
