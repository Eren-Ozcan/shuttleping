/**
 * Kanal-bağımsız bildirim dispatcher'ı.
 *
 * Her kanal aynı arayüzü uygular:
 *   send({ passenger, message }) → { ok, error?, retryable? }
 * retryable: true dönen hatalar BullMQ tarafından yeniden denenir.
 * Yeni kanal eklemek (örn. mobil push/FCM) = CHANNELS map'ine adapter eklemek.
 *
 * Dry-run (Faz F3): prova sırasında gerçek yolcuya gerçek mesaj gitmesin.
 * İki seviye vardır — global `NOTIFICATION_DRY_RUN` env bayrağı ve şirket
 * bazında `companies.dry_run`. Biri bile açıksa gönderim yapılmaz; sonuç
 * notification_logs'a `dry_run` durumuyla düşer, böylece prova akışı denetim
 * kaydında canlı gönderimden ayırt edilebilir.
 *
 * NOTIFICATION_TEST_CHAT_ID verilmişse mesaj bastırılmak yerine o tek
 * Telegram hesabına yönlendirilir: uçtan uca akış gerçekten sınanır ama
 * yolcular etkilenmez.
 */
import { env } from '../../config/env.js'
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
 * @param {{dryRun?: boolean}} [opts] — şirket bazında dry-run override'ı
 */
export async function notify(passenger, message, { dryRun = false } = {}) {
  const channel = CHANNELS[passenger.notification_channel]
  if (!channel) {
    logger.error(
      { passengerId: passenger.id, channel: passenger.notification_channel },
      'Bilinmeyen bildirim kanalı',
    )
    return { ok: false, error: 'unknown_channel' }
  }

  if (env.NOTIFICATION_DRY_RUN || dryRun) {
    // Test hedefi tanımlıysa mesajı oraya yönlendir — akış gerçekten çalışsın
    if (env.NOTIFICATION_TEST_CHAT_ID) {
      const result = await telegram.send({
        passenger: { ...passenger, telegram_chat_id: env.NOTIFICATION_TEST_CHAT_ID },
        message: `[DRY-RUN → ${passenger.full_name ?? passenger.id}] ${message}`,
      })
      return { ...result, dryRun: true }
    }

    logger.info(
      { passengerId: passenger.id, channel: passenger.notification_channel },
      'Dry-run: bildirim gönderilmedi',
    )
    return { ok: true, dryRun: true }
  }

  return channel.send({ passenger, message })
}
