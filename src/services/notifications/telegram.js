/**
 * Telegram Bot API adapter'ı — Faz 4'te gerçek entegrasyon yapılacak.
 * Arayüz: send({ passenger, message }) → { ok, error? }
 */
import { logger } from '../../utils/logger.js'

export async function send({ passenger, message }) {
  if (!passenger.telegram_chat_id) {
    return { ok: false, error: 'missing_telegram_chat_id' }
  }

  // TODO(Faz 4): Telegram Bot API sendMessage çağrısı
  logger.info(
    { passengerId: passenger.id, chatId: passenger.telegram_chat_id, message },
    'Telegram bildirimi (stub)',
  )
  return { ok: true }
}
