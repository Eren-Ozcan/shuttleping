import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

/**
 * ioredis options for the HTTP-path client.
 *
 * maxRetriesPerRequest: null is only correct for the BullMQ connection — on the
 * HTTP path it queues commands forever, so when Redis goes down the request
 * hangs instead of erroring and exhausts Fastify's sockets. The application
 * client must fail fast.
 *
 * enableOfflineQueue: false is the second half of the same rule. After a Redis
 * restart ioredis can be left with status 'ready' and a socket that is no
 * longer writable; with the offline queue on, every command is parked there
 * forever, requests hang in the rate-limit preHandler and the API stops
 * answering entirely (H1/H2 chaos drill). Failing fast lets the limiter skip
 * and the request go through.
 */
const CLIENT_OPTIONS = {
  maxRetriesPerRequest: 2,
  connectTimeout: 5_000,
  commandTimeout: 5_000,
  enableOfflineQueue: false,
  enableReadyCheck: false,
}

const PING_INTERVAL_MS = 10_000

function createClient() {
  const client = new Redis(env.REDIS_URL, CLIENT_OPTIONS)
  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'))
  client.on('connect', () => logger.info('Redis connected'))
  return client
}

/**
 * With the offline queue off, a command sent before the socket is up fails
 * instead of waiting, so boot has to wait for the first connection. A Redis
 * that is down at startup must not block the server, so the wait is bounded —
 * ioredis keeps retrying in the background either way.
 */
function waitUntilReady(client, timeoutMs = 5_000) {
  if (client.status === 'ready') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      client.off('ready', done)
      resolve()
    }
    const timer = setTimeout(() => {
      client.off('ready', done)
      logger.warn('Redis not ready within timeout — starting anyway')
      resolve()
    }, timeoutMs)
    timer.unref?.()
    client.once('ready', done)
  })
}

async function redisPlugin(fastify) {
  let current = createClient()
  await waitUntilReady(current)

  // Watchdog. In the wedged state above ioredis cannot be revived in place:
  // disconnect() leaves status at 'ready', so connect() rejects with "already
  // connecting/connected" and the dead socket stays. The only reliable repair
  // is to throw the client away and build a new one, so callers hold a proxy
  // rather than the instance itself.
  const watchdog = setInterval(() => {
    const client = current
    client.ping().catch((err) => {
      if (client !== current) return // already replaced by an earlier tick
      logger.warn({ err: err.message }, 'Redis ping failed — replacing client')
      current = createClient()
      client.disconnect()
    })
  }, PING_INTERVAL_MS)
  watchdog.unref()

  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const value = current[prop]
        return typeof value === 'function' ? value.bind(current) : value
      },
      set(_target, prop, value) {
        current[prop] = value
        return true
      },
      has: (_target, prop) => prop in current,
    },
  )

  fastify.decorate('redis', proxy)
  fastify.addHook('onClose', async () => {
    clearInterval(watchdog)
    // If the socket closes before quit() responds it rejects with
    // "Connection is closed" — harmless during shutdown, so drop the connection and move on.
    await current.quit().catch(() => current.disconnect())
  })
}

export default fp(redisPlugin, { name: 'redis' })
