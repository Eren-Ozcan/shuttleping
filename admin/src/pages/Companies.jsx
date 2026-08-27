import { useEffect, useState } from 'react'
import { api } from '../api.js'

const EMPTY_ADMIN = { companyId: '', fullName: '', email: '', password: '', phone: '' }

// Kademeli askıya alma: overdue → yönetici girişi ve Google sorgusu kapanır,
// sürücü ve bildirimler çalışır. suspended → her şey durur.
const PAYMENT_LABEL = {
  active: 'Ödeme Güncel',
  overdue: 'Gecikmiş',
  suspended: 'Askıda',
}
const PAYMENT_BADGE = {
  active: 'badge-ok',
  overdue: 'badge-warn',
  suspended: 'badge-off',
}

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [form, setForm] = useState({ name: '', slug: '' })
  const [adminForm, setAdminForm] = useState(EMPTY_ADMIN)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [payments, setPayments] = useState(null)

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

  async function markPaymentStatus(companyId, paymentStatus, extra = {}) {
    setError(null)
    try {
      await api(`/companies/${companyId}/payment-status`, {
        method: 'PATCH',
        body: { paymentStatus, ...extra },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  /** Ödeme alındı: tutar ve not defterle birlikte kaydedilir (C4). */
  async function recordPayment(company) {
    const raw = window.prompt(`${company.name} — alınan tutar (TL, boş bırakılabilir)`)
    if (raw === null) return // iptal
    const amount = raw.trim() === '' ? undefined : Number(raw)
    if (amount !== undefined && !Number.isFinite(amount)) {
      return setError('Geçersiz tutar')
    }
    const note = window.prompt('Not (örn. IBAN havale / elden)') ?? undefined
    await markPaymentStatus(company.id, 'active', { amount, note: note || undefined })
  }

  async function setQuota(company) {
    const raw = window.prompt(
      `${company.name} — azami aktif yolcu sayısı (boş = sınırsız)`,
      company.maxPassengers ?? '',
    )
    if (raw === null) return
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      return setError('Kota pozitif bir tam sayı olmalı')
    }
    setError(null)
    try {
      await api(`/companies/${company.id}`, {
        method: 'PATCH',
        body: { maxPassengers: value },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function showPayments(company) {
    setError(null)
    try {
      const { items } = await api(`/companies/${company.id}/payments`)
      setPayments({ company, items })
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
            <th>Ödeme</th>
            <th>Son Vade</th>
            <th>Yolcu Kotası</th>
            <th></th>
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
              <td>
                <span className={`badge ${PAYMENT_BADGE[c.paymentStatus] ?? 'badge-off'}`}>
                  {PAYMENT_LABEL[c.paymentStatus] ?? c.paymentStatus}
                </span>
              </td>
              <td className="mono">
                {c.nextDueDate ? new Date(c.nextDueDate).toLocaleDateString('tr-TR') : '—'}
              </td>
              <td className="mono">
                <button className="btn btn-ghost" onClick={() => setQuota(c)}>
                  {c.maxPassengers ?? 'sınırsız'}
                </button>
              </td>
              <td className="row-actions">
                {c.paymentStatus !== 'active' && (
                  <button className="btn btn-primary" onClick={() => recordPayment(c)}>
                    Ödeme Alındı
                  </button>
                )}
                {c.paymentStatus === 'active' && (
                  <button className="btn btn-ghost" onClick={() => markPaymentStatus(c.id, 'overdue')}>
                    Gecikti
                  </button>
                )}
                {c.paymentStatus === 'overdue' && (
                  <button
                    className="btn btn-ghost"
                    title="Bildirimler ve konum takibi tamamen durur"
                    onClick={() => markPaymentStatus(c.id, 'suspended')}
                  >
                    Askıya Al
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => showPayments(c)}>
                  Ödemeler
                </button>
              </td>
            </tr>
          ))}
          {companies.length === 0 && (
            <tr>
              <td colSpan="7" className="muted">
                Henüz şirket yok
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {payments && (
        <div className="card">
          <div className="map-toolbar">
            <h3>{payments.company.name} — Ödeme Geçmişi</h3>
            <button className="btn btn-ghost" onClick={() => setPayments(null)}>
              Kapat
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Tutar</th>
                <th>Dönem</th>
                <th>Kaydeden</th>
                <th>Not</th>
              </tr>
            </thead>
            <tbody>
              {payments.items.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{new Date(p.paidAt).toLocaleString('tr-TR')}</td>
                  <td className="mono">
                    {p.amount == null ? '—' : `${Number(p.amount).toLocaleString('tr-TR')} ${p.currency}`}
                  </td>
                  <td className="mono">
                    {p.periodEnd ? new Date(p.periodEnd).toLocaleDateString('tr-TR') : '—'}
                  </td>
                  <td>{p.recordedBy ?? '—'}</td>
                  <td>{p.note ?? '—'}</td>
                </tr>
              ))}
              {payments.items.length === 0 && (
                <tr>
                  <td colSpan="5" className="muted">
                    Kayıt yok
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
