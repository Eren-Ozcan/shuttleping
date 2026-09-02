/**
 * Regression guard for the H1 chaos-drill fix: if the Redis command the rate
 * limiter depends on starts failing, requests must still be served (fail
 * open, src/app.js `skipOnError: true`) instead of hanging or 500ing. Without
 * this test a future refactor could silently drop `skipOnError` and nothing
 * would catch it outside a manual Redis-outage drill.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestApp, closeTestApp } from '../helpers/app.js'

describe('rate limit fail-open (H1)', () => {
  let app

  beforeAll(async () => {
    app = await getTestApp()
  })

  afterAll(async () => {
    await closeTestApp()
  })

  it('serves requests normally when the Redis rate-limit command errors', async () => {
    // Prime the limiter so ioredis has already run defineCommand('rateLimit', ...)
    // on the underlying client — only then does overriding it below take effect.
    const primer = await app.inject({ method: 'GET', url: '/health' })
    expect(primer.statusCode).toBe(200)

    const original = app.redis.rateLimit
    app.redis.rateLimit = (...args) => {
      const callback = args[args.length - 1]
      callback(new Error('simulated Redis failure'))
    }

    try {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    } finally {
      app.redis.rateLimit = original
    }
  })
})
