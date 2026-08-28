/**
 * ETA engine core (Phase 3 + Phase A trip model + Phase B cost control).
 *
 * Flow: location ingest -> eta queue -> computeEtaForRoute
 *   1. The vehicle's last location is read from Redis (skip the job if absent)
 *   2. The active trip's stops (trip_stops snapshot) are read
 *   3. Stops the vehicle has passed are marked trip_stops.state = 'passed'
 *   4. ETA is computed; adaptive throttle and a movement threshold decide
 *      whether to query Google, otherwise the previous result is reused
 *   5. For passengers whose ETA drops below the threshold and who have not yet
 *      been notified, a notification job is enqueued — dedup via the
 *      trip_notifications table (trip-scoped, persistent; survives a Redis
 *      flush, a second trip the same day notifies normally with a new trip_id)
 *
 * Dependencies are injected via parameters; tests pass fake getEta /
 * enqueueNotification, the worker passes the real ones.
 */
import { env } from '../../config/env.js'
import { getEtaSeconds, haversineMeters, fallbackEtaSeconds } from './distance.js'
import { enqueueNotificationJob } from '../../queues/index.js'
import { getCompanyAccess, canUseEtaProvider, canNotify } from '../billing.service.js'

export const locationKey = (companyId, routeId) => `loc:${companyId}:${routeId}`
export const etaKey = (companyId, routeId) => `eta:${companyId}:${routeId}`
// Phase B — per-route Google query throttle key
export const etaCalcKey = (routeId) => `etacalc:${routeId}`

// The ETA result, like the location, is deleted once it goes stale
const ETA_TTL_SECONDS = 300
// Maximum age at which a previous Google result may be reused
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
 * Decides whether to query Google again.
 * - If the vehicle has not moved meaningfully, the previous result is reused
 * - Otherwise adaptive throttle: frequent if a stop is near, sparse if not
 * @returns {Promise<boolean>}
 */
async function shouldQueryProvider(redis, routeId, { origin, previous, nearestSeconds }) {
  const fresh =
    previous &&
    previous.origin &&
    Date.now() - (previous.computedAt ?? 0) < REUSE_MAX_AGE_MS &&
    previous.source !== 'haversine'

  if (fresh && haversineMeters(origin, previous.origin) < env.ETA_MIN_MOVE_METERS) {
    return false // vehicle is barely moving — the previous ETA still holds
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

  // If tripId is not in the job payload (older jobs), find the active trip
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

  // ── Passed-stop elimination ─────────────────────────────────────────────
  // Every stop before the nearest one counts as passed; the nearest stop is
  // marked passed too if it is within the radius. This way no provider query
  // is ever sent for those stops and a late notification is avoided.
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

  // ── ETA: provider query or reuse of the previous result ─────────────────
  // Only pending stops are queried — a passed stop generates no cost.
  const pending = stops.map((stop, i) => ({ stop, i })).filter(({ stop }) => isPending(stop))
  const previous = parseJson(await redis.get(etaKey(companyId, routeId)))
  const haversine = fallbackEtaSeconds(origin, stops)
  const nearestPendingSeconds = pending.length
    ? Math.min(...pending.map(({ i }) => haversine[i]))
    : null

  const etaSeconds = [...haversine]
  let source = 'haversine'

  // Billing gate (C1): no billed provider call for an overdue company —
  // suspension must actually stop the spending
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
    // Throttle / movement threshold blocked the provider — reuse the previous
    // result as-is (no decay: it would create a risk of an early notification)
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
      // When and where the provider was last queried — for the reuse decision
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

  // No notification is produced for a suspended company; the ETA was still
  // written, so the map keeps working if the panel is open
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

    // If the vehicle has passed this stop, a notification is meaningless
    if (!isPending(stops[stopIndex])) continue

    const etaMinutes = Math.max(Math.round(seconds / 60), 1)
    if (etaMinutes > passenger.notify_before_minutes) continue

    // Trip-scoped, persistent dedup: (trip_id, passenger_id) unique
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
      // If the enqueue failed, roll back the dedup row — let the next compute retry
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
