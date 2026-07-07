import { describe, it, expect } from 'vitest'
import { haversineMeters, fallbackEtaSeconds } from '../../src/services/eta/distance.js'

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
