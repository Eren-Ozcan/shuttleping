/**
 * ETA motoru çekirdeği (Faz 3 + Faz A sefer modeli).
 *
 * Akış: konum ingest → eta kuyruğu → computeEtaForRoute
 *   1. Aracın son konumu Redis'ten okunur (yoksa iş atlanır)
 *   2. Aktif seferin durakları (trip_stops snapshot) okunur
 *   3. Duraklara ETA hesaplanır (Distance Matrix / fallback), Redis'e yazılır
 *   4. Aracın geçtiği duraklar trip_stops.state = 'passed' işaretlenir
 *   5. ETA'sı eşiğin altına inen, henüz bildirilmemiş yolcular için bildirim
 *      job'ı kuyruğa atılır — dedup artık trip_notifications tablosuyla
 *      (sefere bağlı, kalıcı; Redis flush'a dayanıklı, aynı gün ikinci sefer
 *      yeni trip_id ile normal bildirir)
 *
 * Bağımlılıklar parametreyle enjekte edilir; testler sahte getEta /
 * enqueueNotification geçirir, worker gerçeklerini kullanır.
 */
import { env } from '../../config/env.js'
import { getEtaSeconds, haversineMeters } from './distance.js'
import { enqueueNotificationJob } from '../../queues/index.js'

export const locationKey = (companyId, routeId) => `loc:${companyId}:${routeId}`
export const etaKey = (companyId, routeId) => `eta:${companyId}:${routeId}`
// Faz B — rota başına ETA hesap throttle anahtarı
export const etaCalcKey = (routeId) => `etacalc:${routeId}`

// ETA sonucu da konum gibi bayatlayınca silinsin
const ETA_TTL_SECONDS = 300

export async function computeEtaForRoute(
  {
    db,
    redis,
    getEta = getEtaSeconds,
    enqueueNotification = enqueueNotificationJob,
    passedRadiusMeters = env.ETA_PASSED_RADIUS_METERS,
  },
  { companyId, routeId, tripId },
) {
  const rawLocation = await redis.get(locationKey(companyId, routeId))
  if (!rawLocation) return { skipped: 'no_location' }
  const location = JSON.parse(rawLocation)

  // tripId job payload'ından gelmezse (eski job'lar) aktif seferi bul
  if (!tripId) {
    const { rows } = await db.query(
      `SELECT id FROM trips
       WHERE route_id = $1 AND company_id = $2 AND status = 'active'`,
      [routeId, companyId],
    )
    if (!rows[0]) return { skipped: 'no_trip' }
    tripId = rows[0].id
  }

  const { rows: stops } = await db.query(
    `SELECT ts.stop_id AS id, s.name, s.lat, s.lng, ts.sequence, ts.state
     FROM trip_stops ts
     JOIN stops s ON s.id = ts.stop_id
     WHERE ts.trip_id = $1
     ORDER BY ts.sequence`,
    [tripId],
  )
  if (!stops.length) return { skipped: 'no_stops' }

  const origin = { lat: location.lat, lng: location.lng }
  const etaSeconds = await getEta(origin, stops)

  await redis.set(
    etaKey(companyId, routeId),
    JSON.stringify({
      ts: Date.now(),
      tripId,
      stops: stops.map((stop, i) => ({
        stopId: stop.id,
        name: stop.name,
        sequence: stop.sequence,
        state: stop.state,
        etaSeconds: etaSeconds[i] ?? null,
      })),
    }),
    'EX',
    ETA_TTL_SECONDS,
  )

  // ── Geçilen durak elemesi ────────────────────────────────────────────────
  // En yakın durağın sırasından önceki tüm duraklar geçilmiş sayılır; en yakın
  // durak da yarıçap içindeyse geçilmiş işaretlenir. Böylece Faz B'de bu
  // duraklara Distance Matrix sorgusu hiç gitmez ve geç kalmış bildirim önlenir.
  const distances = stops.map((s) => haversineMeters(origin, s))
  let nearestIdx = 0
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] < distances[nearestIdx]) nearestIdx = i
  }
  const passedStopIds = []
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].state === 'passed') continue
    const isPassed =
      i < nearestIdx || (i === nearestIdx && distances[i] < passedRadiusMeters)
    if (isPassed) passedStopIds.push(stops[i].id)
  }
  if (passedStopIds.length) {
    await db.query(
      `UPDATE trip_stops SET state = 'passed', passed_at = now()
       WHERE trip_id = $1 AND stop_id = ANY($2) AND state <> 'passed'`,
      [tripId, passedStopIds],
    )
  }
  const passedSet = new Set(passedStopIds)

  const { rows: passengers } = await db.query(
    `SELECT p.id, p.stop_id, p.notify_before_minutes, s.name AS stop_name
     FROM passengers p
     JOIN stops s ON s.id = p.stop_id
     WHERE p.company_id = $1 AND p.stop_id = ANY($2) AND p.is_active = true`,
    [companyId, stops.map((s) => s.id)],
  )

  let notified = 0
  for (const passenger of passengers) {
    const stopIndex = stops.findIndex((s) => s.id === passenger.stop_id)
    const seconds = etaSeconds[stopIndex]
    if (seconds == null) continue

    // Araç bu durağı geçtiyse bildirim anlamsız
    if (passedSet.has(passenger.stop_id) || stops[stopIndex].state === 'passed') {
      continue
    }

    const etaMinutes = Math.max(Math.round(seconds / 60), 1)
    if (etaMinutes > passenger.notify_before_minutes) continue

    // Sefere bağlı, kalıcı dedup: (trip_id, passenger_id) unique
    const claim = await db.query(
      `INSERT INTO trip_notifications
         (company_id, trip_id, passenger_id, stop_id, eta_minutes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (trip_id, passenger_id) DO NOTHING`,
      [companyId, tripId, passenger.id, passenger.stop_id, etaMinutes],
    )
    if (claim.rowCount === 0) continue

    try {
      await enqueueNotification({
        companyId,
        routeId,
        tripId,
        passengerId: passenger.id,
        stopId: passenger.stop_id,
        stopName: passenger.stop_name,
        etaMinutes,
      })
    } catch (err) {
      // Kuyruğa atılamadıysa dedup kaydını geri al — sonraki hesap tekrar denesin
      await db.query(
        'DELETE FROM trip_notifications WHERE trip_id = $1 AND passenger_id = $2',
        [tripId, passenger.id],
      )
      throw err
    }

    await db.query(
      `UPDATE trip_stops SET state = 'notified', notified_at = now()
       WHERE trip_id = $1 AND stop_id = $2 AND state = 'pending'`,
      [tripId, passenger.stop_id],
    )
    notified++
  }

  return { ok: true, tripId, stopCount: stops.length, notified }
}
