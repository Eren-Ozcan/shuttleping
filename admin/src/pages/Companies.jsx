import { useEffect, useState } from 'react'
import { api } from '../api.js'

const EMPTY_ADMIN = { companyId: '', fullName: '', email: '', password: '', phone: '' }

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState({ name: '', slug: '' })
  const [adminForm, setAdminForm] = useState(EMPTY_ADMIN)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  async function load() {
    try {
      setCompanies(await api('/companies'))
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
      await api('/companies', { method: 'POST', body: form })
      setForm({ name: '', slug: '' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <h1>Şirketler</h1>

      <form className="card form-inline" onSubmit={handleCreate}>
        <input
          placeholder="Şirket adı"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          placeholder="slug (örn. acme-tekstil)"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          pattern="[a-z0-9-]+"
          title="Küçük harf, rakam ve tire"
          required
        />
        <button className="btn btn-primary">Şirket Ekle</button>
      </form>

      <div className="card">
        <h3 style={{ marginBottom: '0.6rem' }}>Şirket Yöneticisi Ekle</h3>
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            setNotice(null)
            try {
              await api(`/companies/${adminForm.companyId}/admins`, {
                method: 'POST',
                body: {
                  fullName: adminForm.fullName,
                  email: adminForm.email,
                  password: adminForm.password,
                  phone: adminForm.phone || undefined,
                },
              })
              setNotice(`${adminForm.email} yöneticisi oluşturuldu`)
              setAdminForm(EMPTY_ADMIN)
            } catch (err) {
              setError(err.message)
            }
          }}
        >
          <select
            value={adminForm.companyId}
            onChange={(e) => setAdminForm({ ...adminForm, companyId: e.target.value })}
            required
          >
            <option value="">Şirket seçin</option>
            {companies
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <input
            placeholder="Ad Soyad"
            value={adminForm.fullName}
            onChange={(e) => setAdminForm({ ...adminForm, fullName: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="E-posta"
            value={adminForm.email}
            onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Şifre (en az 8 karakter)"
            value={adminForm.password}
            onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
            minLength={8}
            required
          />
          <input
            placeholder="Telefon (opsiyonel)"
            value={adminForm.phone}
            onChange={(e) => setAdminForm({ ...adminForm, phone: e.target.value })}
          />
          <button className="btn btn-primary">Yönetici Oluştur</button>
        </form>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>Slug</th>
            <th>Durum</th>
            <th>Kayıt</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id} className={c.isActive ? '' : 'row-inactive'}>
              <td>{c.name}</td>
              <td className="mono">{c.slug}</td>
              <td>
                <span className={`badge ${c.isActive ? 'badge-ok' : 'badge-off'}`}>
                  {c.isActive ? 'Aktif' : 'Pasif'}
                </span>
              </td>
              <td className="mono">{new Date(c.createdAt).toLocaleDateString('tr-TR')}</td>
            </tr>
          ))}
          {companies.length === 0 && (
            <tr>
              <td colSpan="4" className="muted">
                Henüz şirket yok
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
