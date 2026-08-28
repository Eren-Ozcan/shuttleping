/**
 * Estimated time of arrival (seconds) from a vehicle position to the stops.
 *
 * Uses the Google Routes API `computeRouteMatrix` (successor to the legacy
 * Distance Matrix API). Without a key, or if a stop is too far, the daily
 * budget is spent, or the request fails, a rough estimate is made from
 * straight-line distance + a fixed average speed.
 *
 * Cost control (Phase B):
 *   - Far stops (ETA > ETA_GOOGLE_MAX_MINUTES or distance > threshold) are
 *     never queried against Google — minute-level precision is meaningless there
 *   - Near stops are queried TRAFFIC_AWARE (Pro SKU), mid-range ones
 *     TRAFFIC_UNAWARE (Essentials SKU — half price)
 *   - If the daily element counter exceeds the budget, fall back entirely to haversine
 *   - If one chunk fails, only that chunk falls back — the others are kept
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

/** Straight-line distance / average speed — rough estimate without a Google key. */
export function fallbackEtaSeconds(origin, destinations, speedKmh = env.ETA_FALLBACK_SPEED_KMH) {
  const metersPerSecond = (speedKmh * 1000) / 3600
  return destinations.map((d) =>
    Math.round(haversineMeters(origin, d) / metersPerSecond),
  )
}

const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
// 1 origin x N destination = N elements. The TRAFFIC_AWARE limit is 625
// elements; in practice a near window has a handful of stops; 25 is safe and enough.
const MAX_DESTINATIONS_PER_REQUEST = 25
const FIELD_MASK = 'originIndex,destinationIndex,duration,condition'

/** Daily element counter key — a UTC day boundary is good enough. */
export const budgetKey = (date = new Date()) =>
  `gmaps:elements:${date.toISOString().slice(0, 10)}`

const waypoint = (p) => ({
  waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
})

/** Converts a Routes API duration like "160s" into seconds. */
function parseDuration(value) {
  if (typeof value !== 'string') return null
  const seconds = Number.parseFloat(value.replace(/s$/, ''))
  return Number.isFinite(seconds) ? Math.round(seconds) : null
}

/**
 * A single computeRouteMatrix request. The result is an array of seconds in
 * the same order as destinations; null for a stop that could not be computed.
 * @throws if the request fails (the caller does per-chunk fallback)
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
  if (!Array.isArray(body)) throw new Error('Routes API unexpected response shape')

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
 * Queries a group of stops in chunks. A failing chunk silently falls back to
 * haversine — the results of the healthy chunks are kept (B7).
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
        'Routes API chunk failed — this chunk falls back to haversine',
      )
    }
  }
  return { seconds, googleCount }
}

/**
 * Checks the daily element budget and counts usage.
 * Returns false if the budget is exceeded; the caller falls back entirely to haversine.
 */
async function reserveBudget(redis, elements) {
  if (!redis || !env.GOOGLE_DAILY_ELEMENT_BUDGET) return true
  const key = budgetKey()
  const used = await redis.incrby(key, elements)
  // The counter is daily; on the first increment give it a 2-day TTL (no loss at the day boundary)
  if (used === elements) await redis.expire(key, 172_800)

  if (used > env.GOOGLE_DAILY_ELEMENT_BUDGET) {
    logger.error(
      { used, budget: env.GOOGLE_DAILY_ELEMENT_BUDGET },
      'Google Maps daily element budget exceeded — haversine fallback active',
    )
    return false
  }
  return true
}

/**
 * @param {{lat:number,lng:number}} origin — the vehicle's last position
 * @param {Array<{lat:number,lng:number}>} destinations — stops (order preserved)
 * @param {{redis?:object}} [opts] — Redis for the budget counter (skipped if absent)
 * @returns {Promise<{seconds:Array<number|null>, source:'google'|'haversine'|'mixed', elements:number}>}
 */
export async function getEtaSeconds(origin, destinations, { redis } = {}) {
  if (!destinations.length) return { seconds: [], source: 'haversine', elements: 0 }

  const haversine = fallbackEtaSeconds(origin, destinations)
  const result = { seconds: [...haversine], source: 'haversine', elements: 0 }
  if (!env.GOOGLE_MAPS_API_KEY) return result

  // Group by the rough estimate: far -> do not query Google, near -> traffic-aware,
  // mid -> traffic-unaware (half price)
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
