/**
 * Telegram Bot API adapter.
 * Interface: send({ passenger, message }) -> { ok, error?, retryable? }
 * retryable: true -> BullMQ retries (network, 429, 5xx)
 */
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'

export async function send({ passenger, message }) {
  if (!passenger.telegram_chat_id) {
    return { ok: false, error: 'missing_telegram_chat_id' }
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN is not set — Telegram notification not sent')
    return { ok: false, error: 'telegram_not_configured' }
  }

  let res
  try {
    res = await fetch(
      `${env.TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
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
    logger.error({ err, passengerId: passenger.id }, 'Telegram request could not be sent')
    return { ok: false, error: 'telegram_network', retryable: true }
  }

  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.ok) {
    // 429 (rate limit) and 5xx are transient; 400/403 (invalid chat, bot blocked) are permanent
    const retryable = res.status === 429 || res.status >= 500
    logger.error(
      { status: res.status, description: body?.description, passengerId: passenger.id },
      'Telegram sendMessage failed',
    )
    return { ok: false, error: `telegram_${res.status}`, retryable }
  }

  return { ok: true }
}
