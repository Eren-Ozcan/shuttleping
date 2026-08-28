import { Redis } from 'ioredis'
import { env } from '../config/env.js'

/**
 * Creates a dedicated Redis connection for BullMQ.
 * Workers use blocking commands, so the app client is not shared;
 * maxRetriesPerRequest: null is the setting BullMQ requires.
 */
export function createQueueConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
