import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api, getToken } from '../api.js'

export default function LiveMap() {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const busMarker = useRef(null)
  const stopLayer = useRef(null)
  const eventSource = useRef(null)

  const [routes, setRoutes] = useState([])
  const [routeId, setRouteId] = useState('')
  const [eta, setEta] = useState(null)
  const [status, setStatus] = useState('Güzergah seçin')
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/routes?active=true').then(setRoutes).catch((err) => setError(err.message))
  }, [])

  // Haritayı bir kez kur
  useEffect(() => {
    if (mapInstance.current) return
    const map = L.map(mapRef.current).setView([41.0082, 28.9784], 11) // İstanbul
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map)
    stopLayer.current = L.layerGroup().addTo(map)
    mapInstance.current = map

    return () => {
      eventSource.current?.close()
      map.remove()
      mapInstance.current = null
    }
  }, [])

  async function watchRoute(id) {
    setRouteId(id)
    setEta(null)
    setError(null)
    eventSource.current?.close()
    busMarker.current?.remove()
    busMarker.current = null
    stopLayer.current.clearLayers()
    if (!id) return setStatus('Güzergah seçin')

    // Durakları çiz
    try {
      const stops = (await api(`/routes/${id}/stops`)).filter((s) => s.isActive)
      const points = stops.map((s) => [s.lat, s.lng])
      for (const stop of stops) {
        L.circleMarker([stop.lat, stop.lng], {
          radius: 7,
          color: '#1d4ed8',
          fillColor: '#3b82f6',
          fillOpacity: 0.9,
        })
          .bindPopup(`${stop.sequence}. ${stop.name}`)
          .addTo(stopLayer.current)
      }
      if (points.length) {
        L.polyline(points, { color: '#93c5fd', dashArray: '6 6' }).addTo(stopLayer.current)
        mapInstance.current.fitBounds(L.latLngBounds(points).pad(0.3))
      }
    } catch (err) {
      return setError(err.message)
    }

    // SSE akışına bağlan
    setStatus('Araç konumu bekleniyor…')
    const es = new EventSource(`/api/v1/locations/${id}/stream?token=${getToken()}`)
    eventSource.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.location) {
        const { lat, lng } = data.location
        if (!busMarker.current) {
          busMarker.current = L.circleMarker([lat, lng], {
            radius: 11,
            color: '#b45309',
            fillColor: '#f59e0b',
            fillOpacity: 1,
          })
            .bindTooltip('🚌 Servis', { permanent: true, direction: 'top', offset: [0, -12] })
            .addTo(mapInstance.current)
        } else {
          busMarker.current.setLatLng([lat, lng])
        }
        setStatus(`Canlı — son sinyal ${new Date(data.location.ts).toLocaleTimeString('tr-TR')}`)
      } else {
        setStatus('Araç çevrimdışı (5 dk içinde sinyal yok)')
      }
      setEta(data.eta)
    }
    es.onerror = () => setStatus('Bağlantı koptu — yeniden deneniyor…')
  }

  return (
    <div className="page page-map">
      <h1>Canlı Harita</h1>

      <div className="map-toolbar">
        <select value={routeId} onChange={(e) => watchRoute(e.target.value)}>
          <option value="">Güzergah seçin</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} {r.vehiclePlate ? `(${r.vehiclePlate})` : ''}
            </option>
          ))}
        </select>
        <span className="muted">{status}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="map-wrap">
        <div ref={mapRef} className="map" />
        {eta?.stops?.length > 0 && (
          <div className="eta-panel">
            <h3>Tahmini Varış</h3>
            {eta.stops.map((s) => (
              <div key={s.stopId} className="eta-row">
                <span>
                  {s.sequence}. {s.name}
                </span>
                <strong>
                  {s.etaSeconds == null ? '—' : `${Math.max(Math.round(s.etaSeconds / 60), 1)} dk`}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
