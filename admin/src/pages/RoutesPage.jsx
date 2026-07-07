import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function RoutesPage() {
  const [routes, setRoutes] = useState([])
  const [drivers, setDrivers] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [selected, setSelected] = useState(null)
  const [stops, setStops] = useState([])
  const [routeName, setRouteName] = useState('')
  const [stopForm, setStopForm] = useState({ name: '', lat: '', lng: '', sequence: '' })
  const [error, setError] = useState(null)

  async function load() {
    try {
      const [routeList, driverList, vehicleList] = await Promise.all([
        api('/routes'),
        api('/users?role=driver&active=true'),
        api('/vehicles?active=true'),
      ])
      setRoutes(routeList)
      setDrivers(driverList)
      setVehicles(vehicleList)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function selectRoute(route) {
    setSelected(route)
    setError(null)
    try {
      setStops(await api(`/routes/${route.id}/stops`))
    } catch (err) {
      setError(err.message)
    }
  }

  async function refreshSelected() {
    const routeList = await api('/routes')
    setRoutes(routeList)
    if (selected) {
      const fresh = routeList.find((r) => r.id === selected.id)
      if (fresh) setSelected(fresh)
      setStops(await api(`/routes/${selected.id}/stops`))
    }
  }

  async function handleCreateRoute(e) {
    e.preventDefault()
    setError(null)
    try {
      await api('/routes', { method: 'POST', body: { name: routeName } })
      setRouteName('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function patchRoute(body) {
    setError(null)
    try {
      await api(`/routes/${selected.id}`, { method: 'PATCH', body })
      await refreshSelected()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAddStop(e) {
    e.preventDefault()
    setError(null)
    try {
      await api(`/routes/${selected.id}/stops`, {
        method: 'POST',
        body: {
          name: stopForm.name,
          lat: Number(stopForm.lat),
          lng: Number(stopForm.lng),
          sequence: Number(stopForm.sequence),
        },
      })
      setStopForm({ name: '', lat: '', lng: '', sequence: '' })
      await refreshSelected()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleStop(stop) {
    setError(null)
    try {
      await api(`/routes/${selected.id}/stops/${stop.id}`, {
        method: 'PATCH',
        body: { isActive: !stop.isActive },
      })
      await refreshSelected()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <h1>Güzergahlar</h1>

      <form className="card form-inline" onSubmit={handleCreateRoute}>
        <input
          placeholder="Güzergah adı (örn. Sabah 1. Hat)"
          value={routeName}
          onChange={(e) => setRouteName(e.target.value)}
          required
        />
        <button className="btn btn-primary">Güzergah Ekle</button>
      </form>

      {error && <div className="error">{error}</div>}

      <div className="split">
        <table className="table">
          <thead>
            <tr>
              <th>Ad</th>
              <th>Sürücü</th>
              <th>Araç</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr
                key={r.id}
                className={`clickable ${selected?.id === r.id ? 'row-selected' : ''} ${r.isActive ? '' : 'row-inactive'}`}
                onClick={() => selectRoute(r)}
              >
                <td>{r.name}</td>
                <td>{r.driverName ?? '—'}</td>
                <td>{r.vehiclePlate ?? '—'}</td>
                <td>
                  <span className={`badge ${r.isActive ? 'badge-ok' : 'badge-off'}`}>
                    {r.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                </td>
              </tr>
            ))}
            {routes.length === 0 && (
              <tr>
                <td colSpan="4" className="muted">
                  Henüz güzergah yok
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {selected && (
          <div className="card detail">
            <h2>{selected.name}</h2>

            <label>
              Sürücü
              <select
                value={selected.driverId ?? ''}
                onChange={(e) => patchRoute({ driverId: e.target.value || null })}
              >
                <option value="">— Atanmadı —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Araç
              <select
                value={selected.vehicleId ?? ''}
                onChange={(e) => patchRoute({ vehicleId: e.target.value || null })}
              >
                <option value="">— Atanmadı —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="btn btn-ghost"
              onClick={() => patchRoute({ isActive: !selected.isActive })}
            >
              {selected.isActive ? 'Güzergahı Pasifleştir' : 'Güzergahı Aktifleştir'}
            </button>

            <h3>Duraklar</h3>
            <form className="form-grid" onSubmit={handleAddStop}>
              <input
                placeholder="Durak adı"
                value={stopForm.name}
                onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })}
                required
              />
              <input
                type="number"
                step="any"
                placeholder="Enlem (lat)"
                value={stopForm.lat}
                onChange={(e) => setStopForm({ ...stopForm, lat: e.target.value })}
                required
              />
              <input
                type="number"
                step="any"
                placeholder="Boylam (lng)"
                value={stopForm.lng}
                onChange={(e) => setStopForm({ ...stopForm, lng: e.target.value })}
                required
              />
              <input
                type="number"
                min="1"
                placeholder="Sıra"
                value={stopForm.sequence}
                onChange={(e) => setStopForm({ ...stopForm, sequence: e.target.value })}
                required
              />
              <button className="btn btn-primary">Durak Ekle</button>
            </form>

            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ad</th>
                  <th>Konum</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => (
                  <tr key={s.id} className={s.isActive ? '' : 'row-inactive'}>
                    <td>{s.sequence}</td>
                    <td>{s.name}</td>
                    <td className="mono">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                    </td>
                    <td>
                      <button className="btn btn-ghost" onClick={() => toggleStop(s)}>
                        {s.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                      </button>
                    </td>
                  </tr>
                ))}
                {stops.length === 0 && (
                  <tr>
                    <td colSpan="4" className="muted">
                      Bu güzergahta durak yok
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
