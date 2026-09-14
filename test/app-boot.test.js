import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { logger } from '../src/utils/logger.js'

/**
 * Every other test file builds the app with `logger: false` and drives it
 * through app.inject(), which never touches the real logger or the HTTP
 * listener. That blind spot hid a Fastify 5 breaking change: a ready-made pino
 * instance now belongs on `loggerInstance`, not `logger`, so the suite stayed
 * green while `npm run dev` died on boot with FST_ERR_LOG_INVALID_LOGGER_CONFIG.
 *
 * This file boots the app the way src/server.js does — default options, real
 * logger, a real socket — so a regression on that path fails CI instead of
 * production.
 */
describe('server boot (real logger, real socket)', () => {
  let app
  let baseUrl

  beforeAll(async () => {
    // No opts: exercises the same default-option path as src/server.js
    app = await buildApp()
    // Port 0 lets the OS pick a free port, so the suite cannot collide with a
    // dev server running on PORT
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it('wires the shared pino instance into fastify', () => {
    // Fastify wraps the instance in a child logger, so identity does not hold;
    // a working pino API and the configured level are what matter
    expect(typeof app.log.info).toBe('function')
    expect(app.log.level).toBe(logger.level)
  })

  it('serves /health over a real socket', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })

  it('logs a request without throwing', async () => {
    // The request logger runs per request; a broken logger config surfaces as a
    // 500 here rather than at build time
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': 'boot-test' } })
    expect(res.status).toBe(200)
  })

  it('returns 404 for an unknown path', async () => {
    const res = await fetch(`${baseUrl}/definitely-not-a-route`)
    expect(res.status).toBe(404)
  })
})
