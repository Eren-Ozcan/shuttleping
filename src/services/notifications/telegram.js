/**
 * Telegram Bot API adapter'ı.
 * Arayüz: send({ passenger, message }) → { ok, error?, retryable? }
 * retryable: true → BullMQ yeniden dener (network, 429, 5xx)
 */
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'

export async function send({ passenger, message }) {
  if (!passenger.telegram_chat_id) {
    return { ok: false, error: 'missing_telegram_chat_id' }
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN tanımlı değil — Telegram bildirimi gönderilemedi')
    return { ok: false, error: 'telegram_not_configured' }
  }

  let res
  try {
    res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: passenger.telegram_chat_id,
          text: message,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (err) {
    logger.error({ err, passengerId: passenger.id }, 'Telegram isteği atılamadı')
    return { ok: false, error: 'telegram_network', retryable: true }
  }

  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.ok) {
    // 429 (rate limit) ve 5xx geçici; 400/403 (geçersiz chat, bot bloklu) kalıcı
    const retryable = res.status === 429 || res.status >= 500
    logger.error(
      { status: res.status, description: body?.description, passengerId: passenger.id },
      'Telegram sendMessage başarısız',
    )
    return { ok: false, error: `telegram_${res.status}`, retryable }
  }

  return { ok: true }
}
