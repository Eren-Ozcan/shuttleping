import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Notifications() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState(null)

  async function load(statusFilter = status) {
    try {
      const query = statusFilter ? `?status=${statusFilter}` : ''
      const data = await api(`/history/notifications${query}`)
      setItems(data.items)
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
      <h1>Bildirim Geçmişi</h1>

      <div className="map-toolbar">
        <select value={status} onChange={(e) => changeFilter(e.target.value)}>
          <option value="">Tümü</option>
          <option value="sent">Gönderilen</option>
          <option value="failed">Başarısız</option>
        </select>
        <button className="btn btn-ghost" onClick={() => load()}>
          Yenile
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Yolcu</th>
            <th>Kanal</th>
            <th>Durum</th>
            <th>Mesaj</th>
          </tr>
        </thead>
        <tbody>
          {items.map((n) => (
            <tr key={n.id}>
              <td className="mono">{new Date(n.created_at).toLocaleString('tr-TR')}</td>
              <td>{n.passenger_name}</td>
              <td>{n.channel === 'telegram' ? 'Telegram' : 'SMS'}</td>
              <td>
                <span className={`badge ${n.status === 'sent' ? 'badge-ok' : 'badge-off'}`}>
                  {n.status === 'sent' ? 'Gönderildi' : `Başarısız${n.error ? ` (${n.error})` : ''}`}
                </span>
              </td>
              <td className="cell-message">{n.message}</td>
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
    </div>
  )
}
