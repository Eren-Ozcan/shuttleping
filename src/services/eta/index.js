/**
 * ETA motoru çekirdeği (Faz 3).
 *
 * Akış: konum ingest → eta kuyruğu → computeEtaForRoute
 *   1. Aracın son konumu Redis'ten okunur (yoksa iş atlanır)
 *   2. Güzergahın aktif duraklarına ETA hesaplanır (Distance Matrix / fallback)
 *   3. Sonuç Redis'e yazılır (Faz 6 canlı harita/SSE bunu okuyacak)
 *   4. ETA'sı eşiğin altına inen yolcular için bildirim job'ı kuyruğa atılır
 *      — dedup anahtarı sayesinde aynı yaklaşma için tek bildirim gider
 *
 * Bağımlılıklar parametreyle enjekte edilir; testler sahte getEta /
 * enqueueNotification geçirir, worker gerçeklerini kullanır.
 */
import { env } from '../../config/env.js'
import { getEtaSeconds } from './distance.js'
import { enqueueNotificationJob } from '../../queues/index.js'

export const locationKey = (companyId, routeId) => `loc:${companyId}:${routeId}`
export const etaKey = (companyId, routeId) => `eta:${companyId}:${routeId}`
const dedupKey = (routeId, stopId, passengerId) =>
  `notified:${routeId}:${stopId}:${passengerId}`

// ETA sonucu da konum gibi bayatlayınca silinsin
const ETA_TTL_SECONDS = 300

export async function computeEtaForRoute(
  {
    db,
    redis,
    getEta = getEtaSeconds,
    enqueueNotification = enqueueNotificationJob,
    dedupTtlSeconds = env.ETA_DEDUP_TTL_SECONDS,
  },
  { companyId, routeId },
) {
  const rawLocation = await redis.get(locationKey(companyId, routeId))
  if (!rawLocation) return { skipped: 'no_location' }
  const location = JSON.parse(rawLocation)

  const { rows: stops } = await db.query(
    `SELECT id, name, lat, lng, sequence FROM stops
     WHERE route_id = $1 AND company_id = $2 AND is_active = true
     ORDER BY sequence`,
    [routeId, companyId],
  )
  if (!stops.length) return { skipped: 'no_stops' }

  const etaSeconds = await getEta({ lat: location.lat, lng: location.lng }, stops)

  await redis.set(
    etaKey(companyId, routeId),
    JSON.stringify({
      ts: Date.now(),
      stops: stops.map((stop, i) => ({
        stopId: stop.id,
        name: stop.name,
        sequence: stop.sequence,
        etaSeconds: etaSeconds[i] ?? null,
      })),
    }),
    'EX',
    ETA_TTL_SECONDS,
  )

  const { rows: passengers } = await db.query(
    `SELECT p.id, p.stop_id, p.notify_before_minutes, s.name AS stop_name
     FROM passengers p
     JOIN stops s ON s.id = p.stop_id
     WHERE p.stop_id = ANY($1) AND p.is_active = true`,
    [stops.map((s) => s.id)],
  )

  let notified = 0
  for (const passenger of passengers) {
    const stopIndex = stops.findIndex((s) => s.id === passenger.stop_id)
    const seconds = etaSeconds[stopIndex]
    if (seconds == null) continue

    const etaMinutes = Math.max(Math.round(seconds / 60), 1)
    if (etaMinutes > passenger.notify_before_minutes) continue

    // SET NX: anahtar zaten varsa bu yaklaşma için bildirim gönderilmiş demektir
    const isFirst = await redis.set(
      dedupKey(routeId, passenger.stop_id, passenger.id),
      '1',
      'EX',
      dedupTtlSeconds,
      'NX',
    )
    if (!isFirst) continue

    await enqueueNotification({
      companyId,
      routeId,
      passengerId: passenger.id,
      stopId: passenger.stop_id,
      stopName: passenger.stop_name,
      etaMinutes,
    })
    notified++
  }

  return { ok: true, stopCount: stops.length, notified }
}
