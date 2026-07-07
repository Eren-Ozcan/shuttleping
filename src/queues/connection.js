import { Redis } from 'ioredis'
import { env } from '../config/env.js'

/**
 * BullMQ için ayrı Redis bağlantısı üretir.
 * Worker'lar bloklayan komutlar kullandığından app client'ı paylaşılmaz;
 * maxRetriesPerRequest: null BullMQ'nun zorunlu kıldığı ayardır.
 */
export function createQueueConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
