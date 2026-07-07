import { useEffect, useState } from 'react'
import { api } from '../api.js'

const EMPTY_FORM = {
  routeId: '',
  stopId: '',
  fullName: '',
  phone: '',
  telegramChatId: '',
  notificationChannel: 'telegram',
  notifyBeforeMinutes: 10,
}

export default function Passengers() {
  const [passengers, setPassengers] = useState([])
  const [routes, setRoutes] = useState([])
  const [stops, setStops] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState(null)

  async function load() {
    try {
      const [passengerList, routeList] = await Promise.all([
        api('/passengers'),
        api('/routes?active=true'),
      ])
      setPassengers(passengerList)
      setRoutes(routeList)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function selectRoute(routeId) {
    setForm({ ...form, routeId, stopId: '' })
    if (!routeId) return setStops([])
    try {
      const stopList = await api(`/routes/${routeId}/stops`)
      setStops(stopList.filter((s) => s.isActive))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await api('/passengers', {
        method: 'POST',
        body: {
          stopId: form.stopId,
          fullName: form.fullName,
          phone: form.phone || undefined,
          telegramChatId: form.telegramChatId || undefined,
          notificationChannel: form.notificationChannel,
          notifyBeforeMinutes: Number(form.notifyBeforeMinutes),
        },
      })
      setForm({ ...EMPTY_FORM, routeId: form.routeId, stopId: form.stopId })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleActive(passenger) {
    setError(null)
    try {
      await api(`/passengers/${passenger.id}`, {
        method: 'PATCH',
        body: { isActive: !passenger.isActive },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <h1>Yolcular</h1>

      <form className="card form-grid" onSubmit={handleCreate}>
        <select value={form.routeId} onChange={(e) => selectRoute(e.target.value)} required>
          <option value="">Güzergah seçin</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={form.stopId}
          onChange={(e) => setForm({ ...form, stopId: e.target.value })}
          required
          disabled={!form.routeId}
        >
          <option value="">Durak seçin</option>
          {stops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.sequence}. {s.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Ad Soyad"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
        />
        <select
          value={form.notificationChannel}
          onChange={(e) => setForm({ ...form, notificationChannel: e.target.value })}
        >
          <option value="telegram">Telegram</option>
          <option value="sms">SMS</option>
        </select>
        {form.notificationChannel === 'telegram' ? (
          <input
            placeholder="Telegram Chat ID"
            value={form.telegramChatId}
            onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })}
            required
          />
        ) : (
          <input
            placeholder="Telefon (05XX XXX XX XX)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
        )}
        <label className="inline-label">
          Kaç dk önce?
          <input
            type="number"
            min="1"
            max="120"
            value={form.notifyBeforeMinutes}
            onChange={(e) => setForm({ ...form, notifyBeforeMinutes: e.target.value })}
            required
          />
        </label>
        <button className="btn btn-primary">Yolcu Ekle</button>
      </form>

      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>Durak</th>
            <th>Kanal</th>
            <th>İletişim</th>
            <th>Eşik</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {passengers.map((p) => (
            <tr key={p.id} className={p.isActive ? '' : 'row-inactive'}>
              <td>{p.fullName}</td>
              <td>{p.stopName}</td>
              <td>{p.notificationChannel === 'telegram' ? 'Telegram' : 'SMS'}</td>
              <td className="mono">
                {p.notificationChannel === 'telegram'
                  ? (p.telegramChatId ?? '—')
                  : (p.phone ?? '—')}
              </td>
              <td>{p.notifyBeforeMinutes} dk</td>
              <td>
                <span className={`badge ${p.isActive ? 'badge-ok' : 'badge-off'}`}>
                  {p.isActive ? 'Aktif' : 'Pasif'}
                </span>
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => toggleActive(p)}>
                  {p.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                </button>
              </td>
            </tr>
          ))}
          {passengers.length === 0 && (
            <tr>
              <td colSpan="7" className="muted">
                Henüz yolcu yok
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
