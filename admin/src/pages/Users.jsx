import { useEffect, useState } from 'react'
import { api } from '../api.js'

const ROLE_LABELS = { company_admin: 'Yönetici', driver: 'Sürücü' }

const EMPTY_FORM = {
  fullName: '',
  email: '',
  password: '',
  phone: '',
  role: 'driver',
}

export default function Users() {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState(null)

  async function load() {
    try {
      setUsers(await api('/users'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await api('/users', {
        method: 'POST',
        body: {
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          role: form.role,
          phone: form.phone || undefined,
        },
      })
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleActive(user) {
    setError(null)
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: { isActive: !user.isActive },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <h1>Kullanıcılar</h1>

      <form className="card form-grid" onSubmit={handleCreate}>
        <input
          placeholder="Ad Soyad"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
        />
        <input
          type="email"
          placeholder="E-posta"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          type="password"
          placeholder="Şifre (en az 8 karakter)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          minLength={8}
          required
        />
        <input
          placeholder="Telefon (opsiyonel)"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="driver">Sürücü</option>
          <option value="company_admin">Yönetici</option>
        </select>
        <button className="btn btn-primary">Kullanıcı Ekle</button>
      </form>

      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>E-posta</th>
            <th>Rol</th>
            <th>Telefon</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.isActive ? '' : 'row-inactive'}>
              <td>{u.fullName}</td>
              <td>{u.email}</td>
              <td>{ROLE_LABELS[u.role] ?? u.role}</td>
              <td>{u.phone ?? '—'}</td>
              <td>
                <span className={`badge ${u.isActive ? 'badge-ok' : 'badge-off'}`}>
                  {u.isActive ? 'Aktif' : 'Pasif'}
                </span>
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => toggleActive(u)}>
                  {u.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan="6" className="muted">
                Henüz kullanıcı yok
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
