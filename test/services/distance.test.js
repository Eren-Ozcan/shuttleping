import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  haversineMeters,
  fallbackEtaSeconds,
  getEtaSeconds,
  budgetKey,
} from '../../src/services/eta/distance.js'
import { env } from '../../src/config/env.js'

describe('haversineMeters', () => {
  it('aynı nokta için 0 döner', () => {
    const p = { lat: 40.99, lng: 29.02 }
    expect(haversineMeters(p, p)).toBe(0)
  })

  it('40. enlemde 0.1 derece boylam farkı ~8.5 km eder', () => {
    const a = { lat: 40, lng: 29 }
    const b = { lat: 40, lng: 29.1 }
    const meters = haversineMeters(a, b)
    expect(meters).toBeGreaterThan(8_400)
    expect(meters).toBeLessThan(8_700)
  })

  it('simetriktir', () => {
    const a = { lat: 41.01, lng: 28.97 } // Eminönü
    const b = { lat: 40.99, lng: 29.02 } // Kadıköy
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})

describe('fallbackEtaSeconds', () => {
  it('36 km/sa hızla saniye = mesafe / 10', () => {
    const origin = { lat: 40, lng: 29 }
    const stop = { lat: 40, lng: 29.05 }
    const [eta] = fallbackEtaSeconds(origin, [stop], 36) // 36 km/sa = 10 m/sn
    expect(eta).toBe(Math.round(haversineMeters(origin, stop) / 10))
  })

  it('durak sırasını korur', () => {
    const origin = { lat: 40, lng: 29 }
    const near = { lat: 40, lng: 29.01 }
    const far = { lat: 40, lng: 29.2 }
    const etas = fallbackEtaSeconds(origin, [far, near], 25)
    expect(etas).toHaveLength(2)
    expect(etas[0]).toBeGreaterThan(etas[1])
  })
})

/**
 * Faz B — Routes API çağrısı, hibrit trafik tier'ı, chunk izolasyonu ve
 * günlük bütçe sigortası. fetch sahtelenir, gerçek istek gitmez.
 */
describe('getEtaSeconds (Routes API)', () => {
  const origin = { lat: 41.0, lng: 29.0 }
  const near = { lat: 41.005, lng: 29.005 } // ~700 m → haversine ~1 dk
  const far = { lat: 41.9, lng: 29.9 } // ~120 km → eşiğin çok ötesinde

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

  /** Routes API yanıtı: her destination için "<n>s" süre. */
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

  // .env'de gerçek bir anahtar olabilir — her testte açıkça kur, sızmasın
  const realKey = env.GOOGLE_MAPS_API_KEY
  beforeEach(() => {
    env.GOOGLE_MAPS_API_KEY = null
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    env.GOOGLE_MAPS_API_KEY = realKey
  })

  it('anahtar yoksa Google\'a gitmez, haversine döner', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getEtaSeconds(origin, [near], { redis: fakeRedis() })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe('haversine')
    expect(result.elements).toBe(0)
    expect(result.seconds[0]).toBeGreaterThan(0)
  })

  it('yakın durağı TRAFFIC_AWARE ile sorar ve süreyi döner', async () => {
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

  it('eşiğin ötesindeki durağı Google\'a hiç sormaz', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    const fetchSpy = vi.fn(async () => respond([999]))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getEtaSeconds(origin, [far], { redis: fakeRedis() })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.source).toBe('haversine')
    expect(result.elements).toBe(0)
  })

  it('istek patlarsa o durak haversine\'e düşer, hata fırlatmaz', async () => {
    env.GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))

    const result = await getEtaSeconds(origin, [near], { redis: fakeRedis() })

    expect(result.source).toBe('haversine')
    expect(result.seconds[0]).toBeGreaterThan(0)
  })

  it('günlük bütçe aşılırsa Google\'a gitmez', async () => {
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
