/**
 * Araç konumundan duraklara tahmini varış süresi (saniye).
 *
 * Google Routes API `computeRouteMatrix` kullanılır (legacy Distance Matrix
 * API'nin halefi). Anahtar yoksa, durak çok uzaksa, günlük bütçe dolduysa
 * veya istek başarısız olursa kuş uçuşu mesafe + sabit ortalama hızla kaba
 * tahmin yapılır.
 *
 * Maliyet kontrolü (Faz B):
 *   - Uzak duraklar (ETA > ETA_GOOGLE_MAX_MINUTES veya mesafe > eşik) Google'a
 *     hiç sorulmaz — o mesafede dakika hassasiyeti zaten anlamsız
 *   - Yakın duraklar TRAFFIC_AWARE (Pro SKU), orta mesafedekiler
 *     TRAFFIC_UNAWARE (Essentials SKU — yarı fiyat) ile sorulur
 *   - Günlük element sayacı bütçeyi aşarsa tamamen haversine'e düşülür
 *   - Bir chunk patlarsa sadece o chunk fallback'e düşer, diğerleri korunur
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

const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
// 1 origin × N destination = N element. TRAFFIC_AWARE limiti 625 element,
// pratikte yakın pencerede birkaç durak olur; 25 güvenli ve yeterli.
const MAX_DESTINATIONS_PER_REQUEST = 25
const FIELD_MASK = 'originIndex,destinationIndex,duration,condition'

/** Günlük element sayacı anahtarı — UTC gün sınırı yeterli. */
export const budgetKey = (date = new Date()) =>
  `gmaps:elements:${date.toISOString().slice(0, 10)}`

const waypoint = (p) => ({
  waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
})

/** Routes API "160s" biçimindeki süreyi saniyeye çevirir. */
function parseDuration(value) {
  if (typeof value !== 'string') return null
  const seconds = Number.parseFloat(value.replace(/s$/, ''))
  return Number.isFinite(seconds) ? Math.round(seconds) : null
}

/**
 * Tek bir computeRouteMatrix isteği. Sonuç, destinations dizisiyle aynı
 * sıradaki saniye dizisidir; hesaplanamayan durak için null.
 * @throws istek başarısız olursa (çağıran chunk bazında fallback yapar)
 */
async function routeMatrixSeconds(origin, destinations, { trafficAware }) {
  const res = await fetch(MATRIX_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GOOGLE_MAPS_API_KEY,
      'x-goog-fieldmask': FIELD_MASK,
    },
    body: JSON.stringify({
      origins: [waypoint(origin)],
      destinations: destinations.map(waypoint),
      travelMode: 'DRIVE',
      routingPreference: trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      languageCode: 'tr',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`Routes API HTTP ${res.status}`)
  const body = await res.json()
  if (!Array.isArray(body)) throw new Error('Routes API beklenmeyen yanıt biçimi')

  const seconds = new Array(destinations.length).fill(null)
  for (const element of body) {
    const index = element?.destinationIndex
    if (!Number.isInteger(index) || index < 0 || index >= seconds.length) continue
    if (element.condition !== 'ROUTE_EXISTS') continue
    seconds[index] = parseDuration(element.duration)
  }
  return seconds
}

/**
 * Bir grup durağı chunk'layarak sorar. Patlayan chunk sessizce haversine'e
 * düşer — sağlam chunk'ların sonucu korunur (B7).
 * @returns {Promise<{seconds:Array<number|null>, googleCount:number}>}
 */
async function queryGroup(origin, group, { trafficAware }) {
  const seconds = new Array(group.length).fill(null)
  let googleCount = 0

  for (let i = 0; i < group.length; i += MAX_DESTINATIONS_PER_REQUEST) {
    const chunk = group.slice(i, i + MAX_DESTINATIONS_PER_REQUEST)
    try {
      const chunkSeconds = await routeMatrixSeconds(origin, chunk, { trafficAware })
      for (let j = 0; j < chunk.length; j++) {
        if (chunkSeconds[j] != null) {
          seconds[i + j] = chunkSeconds[j]
          googleCount++
        }
      }
    } catch (err) {
      logger.warn(
        { err, trafficAware, chunkSize: chunk.length },
        'Routes API chunk başarısız — bu chunk haversine\'e düşüyor',
      )
    }
  }
  return { seconds, googleCount }
}

/**
 * Günlük element bütçesini kontrol eder ve kullanımı sayar.
 * Bütçe aşılırsa false döner; çağıran tamamen haversine'e düşer.
 */
async function reserveBudget(redis, elements) {
  if (!redis || !env.GOOGLE_DAILY_ELEMENT_BUDGET) return true
  const key = budgetKey()
  const used = await redis.incrby(key, elements)
  // Sayaç günlük; ilk artışta 2 günlük TTL ver (gün sınırında kayıp olmasın)
  if (used === elements) await redis.expire(key, 172_800)

  if (used > env.GOOGLE_DAILY_ELEMENT_BUDGET) {
    logger.error(
      { used, budget: env.GOOGLE_DAILY_ELEMENT_BUDGET },
      'Google Maps günlük element bütçesi aşıldı — haversine fallback devrede',
    )
    return false
  }
  return true
}

/**
 * @param {{lat:number,lng:number}} origin — aracın son konumu
 * @param {Array<{lat:number,lng:number}>} destinations — duraklar (sıra korunur)
 * @param {{redis?:object}} [opts] — bütçe sayacı için Redis (yoksa sayaç atlanır)
 * @returns {Promise<{seconds:Array<number|null>, source:'google'|'haversine'|'mixed', elements:number}>}
 */
export async function getEtaSeconds(origin, destinations, { redis } = {}) {
  if (!destinations.length) return { seconds: [], source: 'haversine', elements: 0 }

  const haversine = fallbackEtaSeconds(origin, destinations)
  const result = { seconds: [...haversine], source: 'haversine', elements: 0 }
  if (!env.GOOGLE_MAPS_API_KEY) return result

  // Kaba tahmine göre grupla: uzak → Google'a hiç sorma, yakın → trafikli,
  // orta → trafiksiz (yarı fiyat)
  const maxSeconds = env.ETA_GOOGLE_MAX_MINUTES * 60
  const trafficSeconds = env.ETA_TRAFFIC_AWARE_MINUTES * 60
  const maxMeters = env.ETA_GOOGLE_MAX_DISTANCE_KM * 1000

  const near = [] // { index, lat, lng }
  const mid = []
  for (let i = 0; i < destinations.length; i++) {
    const tooFar =
      haversine[i] > maxSeconds || haversineMeters(origin, destinations[i]) > maxMeters
    if (tooFar) continue
    ;(haversine[i] <= trafficSeconds ? near : mid).push({ index: i, ...destinations[i] })
  }

  const wanted = near.length + mid.length
  if (!wanted) return result
  if (!(await reserveBudget(redis, wanted))) return result

  const groups = [
    { list: near, trafficAware: true },
    { list: mid, trafficAware: false },
  ]
  for (const { list, trafficAware } of groups) {
    if (!list.length) continue
    const { seconds, googleCount } = await queryGroup(origin, list, { trafficAware })
    for (let i = 0; i < list.length; i++) {
      if (seconds[i] != null) result.seconds[list[i].index] = seconds[i]
    }
    result.elements += googleCount
  }

  if (result.elements === destinations.length) result.source = 'google'
  else if (result.elements > 0) result.source = 'mixed'
  return result
}
