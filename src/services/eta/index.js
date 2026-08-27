/**
 * ETA motoru çekirdeği (Faz 3 + Faz A sefer modeli + Faz B maliyet kontrolü).
 *
 * Akış: konum ingest → eta kuyruğu → computeEtaForRoute
 *   1. Aracın son konumu Redis'ten okunur (yoksa iş atlanır)
 *   2. Aktif seferin durakları (trip_stops snapshot) okunur
 *   3. Aracın geçtiği duraklar trip_stops.state = 'passed' işaretlenir
 *   4. ETA hesaplanır; Google'a sorulup sorulmayacağına adaptif throttle ve
 *      hareket eşiği karar verir, aksi halde önceki sonuç yeniden kullanılır
 *   5. ETA'sı eşiğin altına inen, henüz bildirilmemiş yolcular için bildirim
 *      job'ı kuyruğa atılır — dedup trip_notifications tablosuyla (sefere
 *      bağlı, kalıcı; Redis flush'a dayanıklı, aynı gün ikinci sefer yeni
 *      trip_id ile normal bildirir)
 *
 * Bağımlılıklar parametreyle enjekte edilir; testler sahte getEta /
 * enqueueNotification geçirir, worker gerçeklerini kullanır.
 */
import { env } from '../../config/env.js'
import { getEtaSeconds, haversineMeters, fallbackEtaSeconds } from './distance.js'
import { enqueueNotificationJob } from '../../queues/index.js'
import { getCompanyAccess, canUseEtaProvider, canNotify } from '../billing.service.js'

export const locationKey = (companyId, routeId) => `loc:${companyId}:${routeId}`
export const etaKey = (companyId, routeId) => `eta:${companyId}:${routeId}`
// Faz B — rota başına Google sorgu throttle anahtarı
export const etaCalcKey = (routeId) => `etacalc:${routeId}`

// ETA sonucu da konum gibi bayatlayınca silinsin
const ETA_TTL_SECONDS = 300
// Önceki Google sonucunun yeniden kullanılabileceği azami yaş
const REUSE_MAX_AGE_MS = 300_000

function parseJson(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Google'a yeniden sorulup sorulmayacağına karar verir.
 * - Araç kayda değer hareket etmediyse önceki sonuç yeniden kullanılır
 * - Aksi halde adaptif throttle: yakında durak varsa sık, yoksa seyrek
 * @returns {Promise<boolean>}
 */
async function shouldQueryProvider(redis, routeId, { origin, previous, nearestSeconds }) {
  const fresh =
    previous &&
    previous.origin &&
    Date.now() - (previous.computedAt ?? 0) < REUSE_MAX_AGE_MS &&
    previous.source !== 'haversine'

  if (fresh && haversineMeters(origin, previous.origin) < env.ETA_MIN_MOVE_METERS) {
    return false // araç neredeyse duruyor — önceki ETA hâlâ geçerli
  }

  const ttl =
    nearestSeconds != null && nearestSeconds <= env.ETA_TRAFFIC_AWARE_MINUTES * 60
      ? env.ETA_THROTTLE_NEAR_SECONDS
      : env.ETA_THROTTLE_FAR_SECONDS

  const claimed = await redis.set(etaCalcKey(routeId), '1', 'EX', ttl, 'NX')
  return Boolean(claimed)
}

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
  const location = parseJson(await redis.get(locationKey(companyId, routeId)))
  if (!location) return { skipped: 'no_location' }

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

  // ── Geçilen durak elemesi ────────────────────────────────────────────────
  // En yakın durağın sırasından önceki tüm duraklar geçilmiş sayılır; en yakın
  // durak da yarıçap içindeyse geçilmiş işaretlenir. Böylece bu duraklara
  // sağlayıcı sorgusu hiç gitmez ve geç kalmış bildirim önlenir.
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
  const isPending = (stop) => !passedSet.has(stop.id) && stop.state !== 'passed'

  // ── ETA: sağlayıcı sorgusu ya da önceki sonucun yeniden kullanımı ────────
  // Yalnızca geçilmemiş duraklar sorulur — geçilen durak maliyet üretmez.
  const pending = stops.map((stop, i) => ({ stop, i })).filter(({ stop }) => isPending(stop))
  const previous = parseJson(await redis.get(etaKey(companyId, routeId)))
  const haversine = fallbackEtaSeconds(origin, stops)
  const nearestPendingSeconds = pending.length
    ? Math.min(...pending.map(({ i }) => haversine[i]))
    : null

  const etaSeconds = [...haversine]
  let source = 'haversine'

  // Faturalama kapısı (C1): ödemesi gecikmiş şirket için faturalı sağlayıcı
  // çağrısı yapılmaz — askıya alma harcamayı gerçekten durdurmalı
  const access = await getCompanyAccess(companyId, redis)
  const query =
    pending.length > 0 &&
    canUseEtaProvider(access) &&
    (await shouldQueryProvider(redis, routeId, {
      origin,
      previous,
      nearestSeconds: nearestPendingSeconds,
    }))

  if (query) {
    const result = await getEta(
      origin,
      pending.map(({ stop }) => ({ lat: stop.lat, lng: stop.lng })),
      { redis },
    )
    pending.forEach(({ i }, k) => {
      if (result.seconds[k] != null) etaSeconds[i] = result.seconds[k]
    })
    source = result.source
  } else if (previous?.stops?.length) {
    // Throttle/hareket eşiği sağlayıcıyı engelledi — önceki sonucu olduğu gibi
    // kullan (çürütme yapılmaz: erken bildirim riski yaratır)
    const bySid = new Map(previous.stops.map((s) => [s.stopId, s.etaSeconds]))
    let reused = 0
    for (let i = 0; i < stops.length; i++) {
      const prev = bySid.get(stops[i].id)
      if (prev != null) {
        etaSeconds[i] = prev
        reused++
      }
    }
    if (reused) source = 'cached'
  }

  await redis.set(
    etaKey(companyId, routeId),
    JSON.stringify({
      ts: Date.now(),
      tripId,
      source,
      // Sağlayıcıya en son sorulduğu an ve konum — yeniden kullanım kararı için
      computedAt: query ? Date.now() : (previous?.computedAt ?? Date.now()),
      origin: query ? origin : (previous?.origin ?? origin),
      stops: stops.map((stop, i) => ({
        stopId: stop.id,
        name: stop.name,
        sequence: stop.sequence,
        state: passedSet.has(stop.id) ? 'passed' : stop.state,
        etaSeconds: etaSeconds[i] ?? null,
      })),
    }),
    'EX',
    ETA_TTL_SECONDS,
  )

  // Askıya alınmış şirkette bildirim üretilmez; ETA yine yazıldı, panel
  // açıksa harita çalışmaya devam eder
  if (!canNotify(access)) {
    return { ok: true, tripId, stopCount: stops.length, source, notified: 0, billingBlocked: true }
  }

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
    if (!isPending(stops[stopIndex])) continue

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

  return { ok: true, tripId, stopCount: stops.length, source, notified }
}
