/**
 * Araç konumundan duraklara tahmini varış süresi (saniye).
 *
 * GOOGLE_MAPS_API_KEY tanımlıysa Distance Matrix (trafik dahil) kullanılır;
 * anahtar yoksa veya istek başarısız olursa kuş uçuşu mesafe + sabit ortalama
 * hızla kaba tahmin yapılır — geliştirme/test anahtarsız çalışabilsin diye.
 */
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'

const EARTH_RADIUS_M = 6_371_000

/** @param {{lat:number,lng:number}} a @param {{lat:number,lng:number}} b */
export function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Kuş uçuşu mesafe / ortalama hız — Google anahtarı yokken kaba tahmin. */
export function fallbackEtaSeconds(origin, destinations, speedKmh = env.ETA_FALLBACK_SPEED_KMH) {
  const metersPerSecond = (speedKmh * 1000) / 3600
  return destinations.map((d) =>
    Math.round(haversineMeters(origin, d) / metersPerSecond),
  )
}

const MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json'
const MAX_DESTINATIONS_PER_REQUEST = 25 // Distance Matrix API sınırı

async function googleEtaSeconds(origin, destinations) {
  const results = []
  for (let i = 0; i < destinations.length; i += MAX_DESTINATIONS_PER_REQUEST) {
    const chunk = destinations.slice(i, i + MAX_DESTINATIONS_PER_REQUEST)
    const params = new URLSearchParams({
      origins: `${origin.lat},${origin.lng}`,
      destinations: chunk.map((d) => `${d.lat},${d.lng}`).join('|'),
      departure_time: 'now',
      language: 'tr',
      key: env.GOOGLE_MAPS_API_KEY,
    })
    const res = await fetch(`${MATRIX_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Distance Matrix HTTP ${res.status}`)
    const body = await res.json()
    if (body.status !== 'OK') throw new Error(`Distance Matrix: ${body.status}`)

    for (const element of body.rows[0].elements) {
      results.push(
        element.status === 'OK'
          ? (element.duration_in_traffic?.value ?? element.duration.value)
          : null,
      )
    }
  }
  return results
}

/**
 * @param {{lat:number,lng:number}} origin — aracın son konumu
 * @param {Array<{lat:number,lng:number}>} destinations — duraklar (sıra korunur)
 * @returns {Promise<Array<number|null>>} durak başına saniye; hesaplanamayan null
 */
export async function getEtaSeconds(origin, destinations) {
  if (!destinations.length) return []
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      return await googleEtaSeconds(origin, destinations)
    } catch (err) {
      logger.warn({ err }, 'Distance Matrix başarısız — haversine fallback kullanılıyor')
    }
  }
  return fallbackEtaSeconds(origin, destinations)
}
