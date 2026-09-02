import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  haversineMeters,
  fallbackEtaSeconds,
  getEtaSeconds,
  budgetKey,
} from '../../src/services/eta/distance.js'
import { env } from '../../src/config/env.js'

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    const p = { lat: 40.99, lng: 29.02 }
    expect(haversineMeters(p, p)).toBe(0)
  })

  it('a 0.1 degree longitude difference at latitude 40 is ~8.5 km', () => {
    const a = { lat: 40, lng: 29 }
    const b = { lat: 40, lng: 29.1 }
    const meters = haversineMeters(a, b)
    expect(meters).toBeGreaterThan(8_400)
    expect(meters).toBeLessThan(8_700)
  })

  it('is symmetric', () => {
    const a = { lat: 41.01, lng: 28.97 } // Eminönü
    const b = { lat: 40.99, lng: 29.02 } // Kadıköy
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})

describe('fallbackEtaSeconds', () => {
  it('at 36 km/h, seconds = distance / 10', () => {
    const origin = { lat: 40, lng: 29 }
    const stop = { lat: 40, lng: 29.05 }
    const [eta] = fallbackEtaSeconds(origin, [stop], 36) // 36 km/h = 10 m/s
    expect(eta).toBe(Math.round(haversineMeters(origin, stop) / 10))
  })

  it('preserves stop order', () => {
    const origin = { lat: 40, lng: 29 }
    const near = { lat: 40, lng: 29.01 }
    const far = { lat: 40, lng: 29.2 }
    const etas = fallbackEtaSeconds(origin, [far, near], 25)
    expect(etas).toHaveLength(2)
    expect(etas[0]).toBeGreaterThan(etas[1])
  })
})

/**
 * Phase B — Routes API call, hybrid traffic tier, chunk isolation and the
 * daily budget safety net. fetch is faked, no real request goes out.
 */
describe('getEtaSeconds (Routes API)', () => {
  const origin = { lat: 41.0, lng: 29.0 }
  const near = { lat: 41.005, lng: 29.005 } // ~700 m -> haversine ~1 min
  const far = { lat: 41.9, lng: 29.9 } // ~120 km -> well past the threshold

  function fakeRedis() {
    const store = new Map()
    return {
      store,
      incrby: async (key, n) => {
        const next = (store.get(key) ?? 0) + n
        store.set(key, next)
        return next
      },
      expire: async () => 1,
    }
  }

  /** Routes API response: a "<n>s" duration per destination. */
  function respond(seconds) {
    return {
      ok: true,
      json: async () =>
        seconds.map((s, i) => ({
          originIndex: 0,
          destinationIndex: i,
          duration: `${s}s`,
          condition: 'ROUTE_EXISTS',
        })),
    }
  }

  // .env may hold a real key — set it explicitly in every test so it does not leak
  const realKey = env.GOOGLE_MAPS_API_KEY
  beforeEach(() => {
    env.GOOGLE_MAPS_API_KEY = null
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    env.GOOGLE_MAPS_API_KEY = realKey
  })

  it('does not call Google without a key, returns haversine', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getEtaSeconds(origin, [near], { redis: fakeRedis() })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe('haversine')
    expect(result.elements).toBe(0)
    expect(result.seconds[0]).toBeGreaterThan(0)
  })

  it('queries a near stop with TRAFFIC_AWARE and returns the duration', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    const fetchSpy = vi.fn(async () => respond([240]))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getEtaSeconds(origin, [near], { redis: fakeRedis() })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.routingPreference).toBe('TRAFFIC_AWARE')
    expect(body.destinations).toHaveLength(1)
    expect(result).toMatchObject({ source: 'google', elements: 1 })
    expect(result.seconds[0]).toBe(240)
  })

  it('never queries Google for a stop beyond the threshold', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    const fetchSpy = vi.fn(async () => respond([999]))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getEtaSeconds(origin, [far], { redis: fakeRedis() })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe('haversine')
    expect(result.elements).toBe(0)
  })

  it('falls that stop back to haversine on a failed request, does not throw', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))

    const result = await getEtaSeconds(origin, [near], { redis: fakeRedis() })

    expect(result.source).toBe('haversine')
    expect(result.seconds[0]).toBeGreaterThan(0)
  })

  /**
   * C8 — a route longer than a single request. computeRouteMatrix is asked for
   * at most 25 destinations at a time, so 26 near stops must go out as two
   * requests, and the merged result must still line up with the input order.
   */
  it('splits a 26-stop route into chunks of 25 and keeps the order', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'

    // 26 stops in a line east of the origin, all inside the near window
    const stops = Array.from({ length: 26 }, (_, i) => ({
      lat: 41.0,
      lng: 29.0 + (i + 1) * 0.0005,
    }))

    // The fake answers with a duration derived from the coordinate it was
    // actually given, so a mixed-up merge cannot pass unnoticed.
    const durationFor = (lng) => Math.round((lng - 29.0) * 100_000)
    const chunkSizes = []
    const fetchSpy = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body)
      chunkSizes.push(body.destinations.length)
      return {
        ok: true,
        json: async () =>
          body.destinations.map((d, i) => ({
            originIndex: 0,
            destinationIndex: i,
            duration: `${durationFor(d.waypoint.location.latLng.longitude)}s`,
            condition: 'ROUTE_EXISTS',
          })),
      }
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getEtaSeconds(origin, stops, { redis: fakeRedis() })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(chunkSizes).toEqual([25, 1])
    expect(result.elements).toBe(26)
    expect(result.source).toBe('google')
    expect(result.seconds).toEqual(stops.map((s) => durationFor(s.lng)))
  })

  it('keeps the healthy chunk when only the second chunk fails', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    const stops = Array.from({ length: 26 }, (_, i) => ({
      lat: 41.0,
      lng: 29.0 + (i + 1) * 0.0005,
    }))

    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body)
        if (++call === 2) return { ok: false, status: 500 }
        return {
          ok: true,
          json: async () =>
            body.destinations.map((_d, i) => ({
              originIndex: 0,
              destinationIndex: i,
              duration: '111s',
              condition: 'ROUTE_EXISTS',
            })),
        }
      }),
    )

    const result = await getEtaSeconds(origin, stops, { redis: fakeRedis() })

    expect(result.seconds.slice(0, 25)).toEqual(new Array(25).fill(111))
    // The failed chunk's single stop falls back to haversine, it is not null
    expect(result.seconds[25]).toBeGreaterThan(0)
    expect(result.seconds[25]).not.toBe(111)
    expect(result.source).toBe('mixed')
  })

  it('does not call Google once the daily budget is exceeded', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    const fetchSpy = vi.fn(async () => respond([240]))
    vi.stubGlobal('fetch', fetchSpy)

    const redis = fakeRedis()
    redis.store.set(budgetKey(), env.GOOGLE_DAILY_ELEMENT_BUDGET)

    const result = await getEtaSeconds(origin, [near], { redis })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe('haversine')
  })
})
