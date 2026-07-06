/**
 * Kanal-bağımsız bildirim dispatcher'ı.
 *
 * Her kanal aynı arayüzü uygular: send({ passenger, message }) → { ok, error? }
 * Yeni kanal eklemek (örn. mobil push/FCM) = CHANNELS map'ine adapter eklemek.
 * Gerçek API entegrasyonları Faz 4'te doldurulacak.
 */
import { logger } from '../../utils/logger.js'
import * as telegram from './telegram.js'
import * as sms from './sms.js'

const CHANNELS = {
  telegram,
  sms,
  // push: Faz 4+ — yolcu mobil uygulaması (FCM) eklendiğinde buraya bağlanır
}

/**
 * @param {object} passenger — passengers tablosu satırı (notification_channel dahil)
 * @param {string} message — gönderilecek metin
 */
export async function notify(passenger, message) {
  const channel = CHANNELS[passenger.notification_channel]
  if (!channel) {
    logger.error(
      { passengerId: passenger.id, channel: passenger.notification_channel },
      'Bilinmeyen bildirim kanalı',
    )
    return { ok: false, error: 'unknown_channel' }
  }
  return channel.send({ passenger, message })
}
