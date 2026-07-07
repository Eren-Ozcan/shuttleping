import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([])
  const [form, setForm] = useState({ plate: '', name: '' })
  const [error, setError] = useState(null)

  async function load() {
    try {
      setVehicles(await api('/vehicles'))
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
      await api('/vehicles', {
        method: 'POST',
        body: { plate: form.plate, name: form.name || undefined },
      })
      setForm({ plate: '', name: '' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleActive(vehicle) {
    setError(null)
    try {
      await api(`/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        body: { isActive: !vehicle.isActive },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <h1>Araçlar</h1>

      <form className="card form-inline" onSubmit={handleCreate}>
        <input
          placeholder="Plaka (örn. 34 ABC 123)"
          value={form.plate}
          onChange={(e) => setForm({ ...form, plate: e.target.value })}
          required
        />
        <input
          placeholder="Araç adı (opsiyonel)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <button className="btn btn-primary">Araç Ekle</button>
      </form>

      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Plaka</th>
            <th>Ad</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.id} className={v.isActive ? '' : 'row-inactive'}>
              <td>{v.plate}</td>
              <td>{v.name ?? '—'}</td>
              <td>
                <span className={`badge ${v.isActive ? 'badge-ok' : 'badge-off'}`}>
                  {v.isActive ? 'Aktif' : 'Pasif'}
                </span>
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => toggleActive(v)}>
                  {v.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                </button>
              </td>
            </tr>
          ))}
          {vehicles.length === 0 && (
            <tr>
              <td colSpan="4" className="muted">
                Henüz araç yok
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
