import { useEffect, useState } from 'react'
import { api } from '../api.js'

const STATUS_LABEL = {
  active: 'Devam ediyor',
  completed: 'Tamamlandı',
  abandoned: 'Terk edildi',
}
const STOP_STATE_LABEL = {
  pending: 'Bekliyor',
  notified: 'Bildirildi',
  passed: 'Geçildi',
}

export default function Trips() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  async function load(statusFilter = status) {
    setError(null)
    try {
      const query = statusFilter ? `?status=${statusFilter}` : ''
      const data = await api(`/trips${query}`)
      setItems(data.items)
    } catch (err) {
      setError(err.message)
    }
  }

  async function openDetail(id) {
    setError(null)
    try {
      setSelected(await api(`/trips/${id}`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function changeFilter(value) {
    setStatus(value)
    load(value)
  }

  return (
    <div className="page">
      <h1>Sefer Geçmişi</h1>

      <div className="map-toolbar">
        <select value={status} onChange={(e) => changeFilter(e.target.value)}>
          <option value="">Tümü</option>
          <option value="active">Devam eden</option>
          <option value="completed">Tamamlanan</option>
          <option value="abandoned">Terk edilen</option>
        </select>
        <button className="btn btn-ghost" onClick={() => load()}>
          Yenile
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Başlangıç</th>
            <th>Güzergah</th>
            <th>Bitiş</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td className="mono">{new Date(t.startedAt).toLocaleString('tr-TR')}</td>
              <td>{t.routeName}</td>
              <td className="mono">
                {t.endedAt ? new Date(t.endedAt).toLocaleString('tr-TR') : '—'}
              </td>
              <td>
                <span
                  className={`badge ${
                    t.status === 'completed'
                      ? 'badge-ok'
                      : t.status === 'active'
                        ? 'badge-on'
                        : 'badge-off'
                  }`}
                >
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => openDetail(t.id)}>
                  Detay
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan="5" className="muted">
                Kayıt yok
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selected && (
        <div className="panel">
          <div className="map-toolbar">
            <h2>{selected.routeName}</h2>
            <button className="btn btn-ghost" onClick={() => setSelected(null)}>
              Kapat
            </button>
          </div>
          <p className="muted">
            {new Date(selected.startedAt).toLocaleString('tr-TR')} —{' '}
            {selected.endedAt
              ? new Date(selected.endedAt).toLocaleString('tr-TR')
              : 'devam ediyor'}
            {' · '}
            Bildirim: {selected.notifications.sent} gönderildi,{' '}
            {selected.notifications.failed} başarısız
          </p>

          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Durak</th>
                <th>Durum</th>
                <th>Bildirim</th>
                <th>Geçiş</th>
              </tr>
            </thead>
            <tbody>
              {selected.stops.map((s) => (
                <tr key={s.stopId}>
                  <td className="mono">{s.sequence}</td>
                  <td>{s.name}</td>
                  <td>{STOP_STATE_LABEL[s.state] ?? s.state}</td>
                  <td className="mono">
                    {s.notifiedAt ? new Date(s.notifiedAt).toLocaleTimeString('tr-TR') : '—'}
                  </td>
                  <td className="mono">
                    {s.passedAt ? new Date(s.passedAt).toLocaleTimeString('tr-TR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
